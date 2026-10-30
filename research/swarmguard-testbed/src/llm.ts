/**
 * Provider-backed model invocation with honest mode labeling.
 *
 * live_llm: an outbound HTTP request completed and a model response was parsed.
 * offline_fixture: deterministic recorded JSON. Never labeled live.
 * mocked: unit-test substitute.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentTurnSchema, type AgentTurn, type ExecutionMode } from "./contracts";
import { estimateCostUsd } from "./budget";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(ROOT, "..", "fixtures");

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelCallRequest {
  mode: ExecutionMode;
  agentId: string;
  domainId: string;
  scenarioId: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens: number;
  timeoutMs: number;
  mockTurn?: AgentTurn;
  fixtureOverride?: AgentTurn;
}

export interface ModelCallResult {
  mode: ExecutionMode;
  provider: string;
  model: string;
  turn: AgentTurn;
  text: string;
  duration_ms: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost_usd?: number;
  finish_reason?: string;
  provider_http_completed: boolean;
  attempts: number;
}

export class ModelInvocationError extends Error {
  constructor(
    message: string,
    readonly code: "provider_error" | "schema_invalid" | "timeout" | "live_blocked",
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "ModelInvocationError";
  }
}

interface FixtureFile {
  domain: string;
  scenario_id: string;
  model_name?: string;
  agents: Record<string, AgentTurn>;
}

const fixtureCache = new Map<string, FixtureFile>();

export async function loadFixtureFile(domainId: string): Promise<FixtureFile> {
  const cached = fixtureCache.get(domainId);
  if (cached) return cached;
  const path = join(FIXTURE_DIR, `${domainId}.json`);
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as FixtureFile;
  fixtureCache.set(domainId, parsed);
  return parsed;
}

export function parseAgentTurn(text: string): AgentTurn {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced ? fenced[1]!.trim() : trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      parsed = JSON.parse(candidate.slice(start, end + 1));
    } else {
      throw new ModelInvocationError("Model output was not valid JSON.", "schema_invalid", true);
    }
  }
  const result = agentTurnSchema.safeParse(parsed);
  if (!result.success) {
    throw new ModelInvocationError(
      `Model output failed schema validation: ${result.error.issues.map((issue) => issue.message).join("; ")}`,
      "schema_invalid",
      true
    );
  }
  return result.data;
}

export async function invokeModel(request: ModelCallRequest, retries = 2): Promise<ModelCallResult> {
  if (request.mode === "mocked") {
    if (!request.mockTurn) {
      throw new ModelInvocationError("mocked mode requires mockTurn.", "schema_invalid", false);
    }
    let turn: AgentTurn;
    try {
      turn = agentTurnSchema.parse(request.mockTurn);
    } catch (error) {
      throw new ModelInvocationError(
        error instanceof Error ? error.message : "mocked turn failed schema validation.",
        "schema_invalid",
        false
      );
    }
    return {
      mode: "mocked",
      provider: "mock",
      model: "mock",
      turn,
      text: JSON.stringify(turn),
      duration_ms: 0,
      provider_http_completed: false,
      attempts: 1,
    };
  }

  if (request.mode === "offline_fixture") {
    const turn =
      request.fixtureOverride ??
      request.mockTurn ??
      (await loadFixtureTurn(request.domainId, request.agentId));
    return {
      mode: "offline_fixture",
      provider: "fixture",
      model: "recorded-fixture",
      turn: agentTurnSchema.parse(turn),
      text: JSON.stringify(turn),
      duration_ms: 0,
      provider_http_completed: false,
      attempts: 1,
    };
  }

  return invokeLive(request, retries);
}

async function loadFixtureTurn(domainId: string, agentId: string): Promise<AgentTurn> {
  const file = await loadFixtureFile(domainId);
  const turn = file.agents[agentId];
  if (!turn) {
    throw new ModelInvocationError(
      `No offline fixture for agent "${agentId}" in domain "${domainId}".`,
      "schema_invalid",
      false
    );
  }
  return agentTurnSchema.parse(turn);
}

async function invokeLive(request: ModelCallRequest, retries: number): Promise<ModelCallResult> {
  const openai = process.env["OPENAI_API_KEY"];
  const anthropic = process.env["ANTHROPIC_API_KEY"];
  if (!openai && !anthropic) {
    throw new ModelInvocationError(
      "live_llm requested but no provider key is configured.",
      "live_blocked",
      false
    );
  }

  const provider = openai ? "openai" : "anthropic";
  let lastError: ModelInvocationError | undefined;
  const messages = [...request.messages];

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const started = Date.now();
    try {
      const raw = provider === "openai"
        ? await callOpenAI(openai!, messages, request)
        : await callAnthropic(anthropic!, messages, request);
      const turn = parseAgentTurn(raw.text);
      const cost = estimateCostUsd(
        raw.model,
        raw.prompt_tokens ?? 0,
        raw.completion_tokens ?? 0
      );
      return {
        mode: "live_llm",
        provider: raw.provider,
        model: raw.model,
        turn,
        text: raw.text,
        duration_ms: Date.now() - started,
        prompt_tokens: raw.prompt_tokens,
        completion_tokens: raw.completion_tokens,
        total_tokens: raw.total_tokens,
        cost_usd: cost,
        finish_reason: raw.finish_reason,
        provider_http_completed: true,
        attempts: attempt,
      };
    } catch (error) {
      const invocationError =
        error instanceof ModelInvocationError
          ? error
          : new ModelInvocationError(
              error instanceof Error ? error.message : String(error),
              "provider_error",
              true
            );
      lastError = invocationError;
      if (!invocationError.retryable || attempt > retries) {
        throw invocationError;
      }
      messages.push({
        role: "user",
        content:
          "Your previous reply was not valid JSON for the required schema. Reply with a single JSON object only.",
      });
    }
  }

  throw lastError ?? new ModelInvocationError("Live model call failed.", "provider_error", false);
}

interface RawProviderResponse {
  provider: string;
  model: string;
  text: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  finish_reason?: string;
}

async function callOpenAI(
  apiKey: string,
  messages: ChatMessage[],
  request: ModelCallRequest
): Promise<RawProviderResponse> {
  const model = process.env["REEPROV_P2_MODEL"] || "gpt-4o-mini";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: request.temperature ?? 0.1,
        max_tokens: request.maxTokens,
        response_format: { type: "json_object" },
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new ModelInvocationError(
        `OpenAI request failed with status ${response.status}.`,
        "provider_error",
        retryable
      );
    }
    const body = (await response.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const text = body.choices?.[0]?.message?.content;
    if (!text) {
      throw new ModelInvocationError("OpenAI response did not include text output.", "provider_error", true);
    }
    return {
      provider: "openai",
      model: body.model ?? model,
      text,
      prompt_tokens: body.usage?.prompt_tokens,
      completion_tokens: body.usage?.completion_tokens,
      total_tokens: body.usage?.total_tokens,
      finish_reason: body.choices?.[0]?.finish_reason,
    };
  } catch (error) {
    if (error instanceof ModelInvocationError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ModelInvocationError("OpenAI request timed out.", "timeout", true);
    }
    throw new ModelInvocationError(
      error instanceof Error ? error.message : "OpenAI request failed.",
      "provider_error",
      true
    );
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic(
  apiKey: string,
  messages: ChatMessage[],
  request: ModelCallRequest
): Promise<RawProviderResponse> {
  const model = process.env["REEPROV_P2_MODEL"] || "claude-3-5-haiku-latest";
  const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const turns = messages.filter((message) => message.role !== "system");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: request.maxTokens,
        temperature: request.temperature ?? 0.1,
        system: system || undefined,
        messages: turns.map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content,
        })),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new ModelInvocationError(
        `Anthropic request failed with status ${response.status}.`,
        "provider_error",
        retryable
      );
    }
    const body = (await response.json()) as {
      model?: string;
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string;
    };
    const text = body.content?.find((block) => block.type === "text")?.text;
    if (!text) {
      throw new ModelInvocationError("Anthropic response did not include text output.", "provider_error", true);
    }
    return {
      provider: "anthropic",
      model: body.model ?? model,
      text,
      prompt_tokens: body.usage?.input_tokens,
      completion_tokens: body.usage?.output_tokens,
      total_tokens: (body.usage?.input_tokens ?? 0) + (body.usage?.output_tokens ?? 0),
      finish_reason: body.stop_reason,
    };
  } catch (error) {
    if (error instanceof ModelInvocationError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ModelInvocationError("Anthropic request timed out.", "timeout", true);
    }
    throw new ModelInvocationError(
      error instanceof Error ? error.message : "Anthropic request failed.",
      "provider_error",
      true
    );
  } finally {
    clearTimeout(timer);
  }
}
