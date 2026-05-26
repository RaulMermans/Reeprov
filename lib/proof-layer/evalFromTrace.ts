/**
 * lib/proof-layer/evalFromTrace.ts
 *
 * Shared helper that converts an `eval_completed` TraceEvent into an EvalResult
 * record. Used by the trace ingestion route (`POST /api/traces/events`) and by
 * tests — so tests exercise the production code path, not a parallel copy.
 *
 * Returns null when:
 *   - the event is not of type `eval_completed`
 *   - the event has no `metadata`
 *   - required fields (`eval_id`, `eval_name`) are missing or malformed
 *   - the resulting object fails `evalResultSchema` validation
 *
 * Never throws — malformed metadata simply produces null so ingestion remains
 * robust and individual bad events do not crash the pipeline.
 */

import { evalResultSchema, type EvalResult, type TraceEvent } from "./schemas";

const VALID_EVAL_TYPES = [
  "schema_validity",
  "tool_call_assertion",
  "output_quality",
  "safety",
  "source_grounding",
  "trace_contract",
  "approval_gate",
  "model_benchmark",
] as const;

type EvalType = (typeof VALID_EVAL_TYPES)[number];

const VALID_SEVERITIES = ["info", "warning", "fail", "critical"] as const;

type EvalSeverity = (typeof VALID_SEVERITIES)[number];

/**
 * Attempt to build an EvalResult record from an `eval_completed` TraceEvent.
 *
 * Returns null when the event is the wrong type, lacks metadata, or has
 * insufficient information to form a valid EvalResult. Never throws.
 */
export function tryBuildEvalResultFromTraceEvent(event: TraceEvent): EvalResult | null {
  if (event.event_type !== "eval_completed") return null;

  const meta = event.metadata;
  if (!meta || typeof meta !== "object") return null;

  const eval_id = typeof meta["eval_id"] === "string" ? meta["eval_id"] : null;
  const name = typeof meta["eval_name"] === "string" ? meta["eval_name"] : null;
  if (!eval_id || !name) return null;

  const passed = typeof meta["passed"] === "boolean" ? meta["passed"] : true;
  const score = typeof meta["score"] === "number" ? meta["score"] : undefined;
  const rawFindings: unknown[] = Array.isArray(meta["findings"]) ? (meta["findings"] as unknown[]) : [];
  const findings: string[] = rawFindings.filter((f): f is string => typeof f === "string");
  const recommendation =
    typeof meta["recommendation"] === "string" ? meta["recommendation"] : undefined;

  const rawSeverity = typeof meta["severity"] === "string" ? meta["severity"] : null;
  const severity: EvalSeverity =
    rawSeverity && (VALID_SEVERITIES as readonly string[]).includes(rawSeverity)
      ? (rawSeverity as EvalSeverity)
      : passed
        ? "info"
        : "fail";

  const rawType = typeof meta["type"] === "string" ? meta["type"] : null;
  const evalType: EvalType =
    rawType && (VALID_EVAL_TYPES as readonly string[]).includes(rawType)
      ? (rawType as EvalType)
      : "output_quality";

  const candidate = {
    eval_id,
    run_id: event.run_id,
    node_id: event.node_id,
    name,
    type: evalType,
    score,
    passed,
    severity,
    findings,
    recommendation,
  };

  const result = evalResultSchema.safeParse(candidate);
  return result.success ? result.data : null;
}
