/**
 * Honest execution-mode resolution.
 *
 * live_llm requires an explicit request AND a completed provider HTTP call.
 * Credential presence alone never upgrades a run to live_llm.
 * Fixtures are never relabeled as live execution.
 */

import { executionModeSchema, type ExecutionMode } from "./contracts";

export interface ModeResolution {
  mode: ExecutionMode;
  live_blocked?: string;
  credentials_present: boolean;
  requested: ExecutionMode;
}

export function credentialsPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env["OPENAI_API_KEY"] || env["ANTHROPIC_API_KEY"]);
}

export function parseRequestedMode(raw?: string | null): ExecutionMode {
  if (!raw) return "offline_fixture";
  const normalized = raw.trim().toLowerCase();
  if (normalized === "live" || normalized === "live_llm" || normalized === "live-llm") {
    return "live_llm";
  }
  if (normalized === "mock" || normalized === "mocked") {
    return "mocked";
  }
  if (
    normalized === "offline" ||
    normalized === "offline_fixture" ||
    normalized === "offline-fixture" ||
    normalized === "fixture"
  ) {
    return "offline_fixture";
  }
  return executionModeSchema.parse(normalized);
}

export function resolveExecutionMode(
  requestedRaw?: string | null,
  env: NodeJS.ProcessEnv = process.env
): ModeResolution {
  const requested = parseRequestedMode(requestedRaw);
  const present = credentialsPresent(env);

  if (requested === "live_llm" && !present) {
    return {
      mode: "offline_fixture",
      requested,
      credentials_present: false,
      live_blocked:
        "live_llm requested but OPENAI_API_KEY / ANTHROPIC_API_KEY are unset. Offline fixtures will run; live LLM verification is blocked.",
    };
  }

  return {
    mode: requested,
    requested,
    credentials_present: present,
  };
}

export function assertLiveModeNotInferred(options: {
  requested: ExecutionMode;
  credentialsPresent: boolean;
  providerHttpCompleted: boolean;
  usedFixture: boolean;
}): ExecutionMode | "not_live" {
  if (options.usedFixture) return "not_live";
  if (options.requested !== "live_llm") return "not_live";
  if (!options.providerHttpCompleted) return "not_live";
  return "live_llm";
}

export function classifyRecordedInvocations(
  invocations: Array<{
    metadata?: Record<string, unknown>;
    provider?: string;
  }>
): ExecutionMode | "mixed" | "unknown" {
  if (invocations.length === 0) return "unknown";
  const modes = new Set(
    invocations.map((invocation) => {
      const recorded = invocation.metadata?.["execution_mode"];
      return typeof recorded === "string" ? recorded : "unknown";
    })
  );
  if (modes.size === 1) {
    const only = [...modes][0];
    if (only === "live_llm" || only === "offline_fixture" || only === "mocked") return only;
  }
  if (modes.has("live_llm") && modes.size > 1) return "mixed";
  return "unknown";
}
