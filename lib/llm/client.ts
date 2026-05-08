import { featureFlags, providerFromEnv } from "@/lib/config/featureFlags";
import type { LLMClientResult, LLMGenerateInput, LLMMessage } from "./types";

const OPENAI_MODEL = "gpt-4o-mini";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const LLM_TIMEOUT_MS = 20_000;

export async function generateLLM(input: LLMGenerateInput): Promise<LLMClientResult> {
  if (!featureFlags.llmAuditorsEnabled) {
    return {
      ok: false,
      provider: null,
      disabled: true,
      error: "LLM auditors are disabled.",
    };
  }

  const provider = providerFromEnv();

  if (!provider) {
    return {
      ok: false,
      provider: null,
      disabled: true,
      error: "Unsupported LLM_PROVIDER.",
    };
  }

  if (provider === "anthropic") {
    return {
      ok: false,
      provider,
      disabled: true,
      error: "Anthropic provider support is reserved for a future commit.",
    };
  }

  return generateOpenAI(input);
}

async function generateOpenAI(input: LLMGenerateInput): Promise<LLMClientResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      provider: "openai",
      model: OPENAI_MODEL,
      disabled: true,
      error: "OPENAI_API_KEY is not configured.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: input.messages.map(toOpenAIMessage),
        temperature: input.temperature ?? 0.1,
        max_tokens: input.maxTokens ?? 1200,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        provider: "openai",
        model: OPENAI_MODEL,
        disabled: false,
        error: `OpenAI request failed with status ${response.status}.`,
      };
    }

    const body = await response.json() as OpenAIChatCompletionResponse;
    const text = body.choices?.[0]?.message?.content;

    if (!text) {
      return {
        ok: false,
        provider: "openai",
        model: OPENAI_MODEL,
        disabled: false,
        error: "OpenAI response did not include text output.",
      };
    }

    return {
      ok: true,
      result: {
        text,
        provider: "openai",
        model: body.model ?? OPENAI_MODEL,
        usage: {
          inputTokens: body.usage?.prompt_tokens,
          outputTokens: body.usage?.completion_tokens,
          totalTokens: body.usage?.total_tokens,
        },
      },
    };
  } catch (error) {
    return {
      ok: false,
      provider: "openai",
      model: OPENAI_MODEL,
      disabled: false,
      error: error instanceof Error ? error.message : "OpenAI request failed.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function toOpenAIMessage(message: LLMMessage) {
  return {
    role: message.role,
    content: message.content,
  };
}

interface OpenAIChatCompletionResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}
