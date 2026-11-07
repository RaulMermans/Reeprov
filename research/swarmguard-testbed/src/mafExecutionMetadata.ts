/**
 * Honest execution metadata for the external Microsoft Agent Framework adapter.
 *
 * `live_llm` is accepted only when every recorded model call completed a real
 * provider HTTP response. Offline H2 observations stay `offline_fixture`.
 * Missing token counts stay unavailable; they are not rewritten as zero.
 */

export type CanonicalExecutionMode = "live_llm" | "offline_fixture" | "mocked";

export interface ExternalHttpProof {
  method?: string;
  url?: string;
  status_code?: number;
}

export interface ExternalUsage {
  usage_status?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  source?: string;
}

export interface ExternalModelCallMetadata {
  provider_http_completed?: boolean;
  execution_mode?: string;
  http?: ExternalHttpProof | null;
  usage?: ExternalUsage | null;
  model?: string;
}

export interface ExternalEpisodeMetadata {
  execution_mode?: string;
  transport_label?: string;
  provider_http_completed?: boolean;
  model_calls?: ExternalModelCallMetadata[];
}

export interface ResolvedExternalExecution {
  canonical_mode: CanonicalExecutionMode;
  recorded_mode: string;
  transport_label: string;
  provider_http_completed: boolean;
  is_live_llm: boolean;
  requested_mode: CanonicalExecutionMode;
  live_blocked?: string;
  disclosure: string;
  usage_status: "provider_reported" | "unavailable" | "not_applicable_offline" | "mixed";
  actual_tokens: number | null;
  actual_cost_usd: number | null;
  cost_status: "not_applicable_offline" | "unmetered_local" | "provider_reported";
}

const H2_OFFLINE_BLOCK =
  "FOUNDRY_PROJECT_ENDPOINT / FOUNDRY_MODEL / AzureCliCredential absent; executed upstream MAF HandoffBuilder with offline deterministic BaseChatClient (provider_http_completed=false).";

export function isLoopbackOllamaChat(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    return (host === "127.0.0.1" || host === "localhost" || host === "::1") && parsed.pathname === "/api/chat";
  } catch {
    return false;
  }
}

export function modelCallHttpVerified(call: ExternalModelCallMetadata): boolean {
  return (
    call.provider_http_completed === true &&
    call.execution_mode === "live_llm" &&
    call.http?.method === "POST" &&
    call.http.status_code === 200 &&
    isLoopbackOllamaChat(call.http.url) &&
    typeof call.model === "string" &&
    call.model.trim().length > 0
  );
}

function reportedTotal(call: ExternalModelCallMetadata): number | null {
  const usage = call.usage;
  if (!usage || usage.usage_status !== "provider_reported") return null;
  if (!Number.isInteger(usage.total_tokens)) return null;
  return usage.total_tokens as number;
}

export function resolveExternalExecution(episode: ExternalEpisodeMetadata): ResolvedExternalExecution {
  const calls = episode.model_calls ?? [];
  const recordedMode = episode.execution_mode ?? "offline";
  const transport = episode.transport_label ?? "offline_mocked_chat_client";
  const claimedLive = recordedMode === "live_llm" && episode.provider_http_completed === true;
  const verifiedCalls = calls.length > 0 && calls.every(modelCallHttpVerified);

  if (claimedLive && verifiedCalls) {
    const totals = calls.map(reportedTotal);
    const reported = totals.filter((value): value is number => value !== null);
    const unavailable = totals.some((value) => value === null);
    const usageStatus = unavailable || reported.length === 0
      ? reported.length > 0
        ? "mixed"
        : "unavailable"
      : "provider_reported";
    return {
      canonical_mode: "live_llm",
      recorded_mode: recordedMode,
      transport_label: transport,
      provider_http_completed: true,
      is_live_llm: true,
      requested_mode: "live_llm",
      disclosure:
        "Each captured model call completed a loopback POST /api/chat against the local Ollama daemon. Agent text and tool selections are the model's responses, not the offline script.",
      usage_status: usageStatus,
      actual_tokens: usageStatus === "provider_reported" ? reported.reduce((sum, value) => sum + value, 0) : null,
      actual_cost_usd: null,
      cost_status: "unmetered_local",
    };
  }

  if (claimedLive || calls.some((call) => call.provider_http_completed === true || call.execution_mode === "live_llm")) {
    return {
      canonical_mode: "mocked",
      recorded_mode: recordedMode,
      transport_label: transport,
      provider_http_completed: false,
      is_live_llm: false,
      requested_mode: "live_llm",
      live_blocked:
        "A live_llm label was present, but at least one model call lacked a completed loopback Ollama HTTP 200 response. The run is not recorded as live_llm.",
      disclosure:
        "Incomplete or inconsistent provider evidence. No live_llm classification was granted.",
      usage_status: "unavailable",
      actual_tokens: null,
      actual_cost_usd: null,
      cost_status: "unmetered_local",
    };
  }

  return {
    canonical_mode: "offline_fixture",
    recorded_mode: recordedMode,
    transport_label: transport,
    provider_http_completed: false,
    is_live_llm: false,
    requested_mode: "live_llm",
    live_blocked: H2_OFFLINE_BLOCK,
    disclosure:
      "No live provider HTTP completion occurred. Upstream Microsoft Agent Framework agents, tools, and HandoffBuilder executed against the deterministic offline BaseChatClient.",
    usage_status: "not_applicable_offline",
    actual_tokens: 0,
    actual_cost_usd: 0,
    cost_status: "not_applicable_offline",
  };
}

export interface ModelCaptureUsage {
  usage_status: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export function modelCaptureUsage(call: ExternalModelCallMetadata, resolved: ResolvedExternalExecution): ModelCaptureUsage {
  if (resolved.canonical_mode !== "live_llm") {
    return {
      usage_status: resolved.usage_status,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
  }
  const usage = call.usage;
  if (
    usage?.usage_status === "provider_reported" &&
    Number.isInteger(usage.prompt_tokens) &&
    Number.isInteger(usage.completion_tokens)
  ) {
    return {
      usage_status: "provider_reported",
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      costUsd: undefined,
    };
  }
  return { usage_status: "unavailable" };
}
