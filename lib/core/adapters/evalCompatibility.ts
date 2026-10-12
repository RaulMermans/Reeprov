/**
 * Canonical ↔ Legacy Eval Compatibility Adapter.
 *
 * Implements bidirectional projection between canonical EvalResult (lib/core/contracts/evals.ts)
 * and legacy proof-layer EvalResult (lib/proof-layer/schemas.ts).
 *
 * Invariants:
 * - Canonical EvalResult is authoritative.
 * - Projection to legacy must preserve the canonical eval family via canonical_family.
 * - Never silently relabels non-schema evals as "schema_validity".
 * - Round-trip preservation: canonical → legacy → canonical preserves the original EvalFamily.
 */

import type { EvalResult as CanonicalEvalResult, EvalFamily } from "../contracts/evals";
import type { EvalResult as LegacyEvalResult, evalTypeSchema } from "@/lib/proof-layer/schemas";
import { z } from "zod";

type LegacyEvalType = z.infer<typeof evalTypeSchema>;

/**
 * Projects a canonical EvalFamily to the nearest legacy EvalType.
 */
export function canonicalFamilyToLegacyType(family: EvalFamily): LegacyEvalType {
  switch (family) {
    case "schema_validity":
      return "schema_validity";
    case "tool_selection":
    case "argument_validity":
      return "tool_call_assertion";
    case "output_validity":
    case "task_success":
      return "output_quality";
    case "safety":
      return "safety";
    case "retrieval":
    case "context":
    case "memory":
      return "source_grounding";
    case "trajectory":
    case "regression":
    case "cost":
    case "latency":
      return "trace_contract";
    case "approval_compliance":
      return "approval_gate";
    case "model_benchmark":
      return "model_benchmark";
    default: {
      const _exhaustive: never = family;
      return "output_quality";
    }
  }
}

/**
 * Maps a legacy EvalType to the canonical EvalFamily.
 */
export function legacyTypeToCanonicalFamily(legacyType: LegacyEvalType): EvalFamily {
  switch (legacyType) {
    case "schema_validity":
      return "schema_validity";
    case "tool_call_assertion":
      return "tool_selection";
    case "output_quality":
      return "output_validity";
    case "safety":
      return "safety";
    case "source_grounding":
      return "retrieval";
    case "trace_contract":
      return "trajectory";
    case "approval_gate":
      return "approval_compliance";
    case "model_benchmark":
      return "model_benchmark";
    default:
      return "output_validity";
  }
}

/**
 * Converts a canonical EvalResult to a backward-compatible legacy EvalResult.
 * Preserves the canonical family in canonical_family and metadata.
 */
export function canonicalToLegacyEvalResult(canonical: CanonicalEvalResult): LegacyEvalResult {
  const legacyType = canonicalFamilyToLegacyType(canonical.eval_type);

  return {
    eval_id: canonical.eval_id,
    run_id: canonical.target_run_id,
    node_id: canonical.target_node_id,
    name: canonical.name,
    type: legacyType,
    score: canonical.score,
    passed: canonical.passed,
    severity: canonical.severity,
    findings: canonical.findings,
    recommendation: canonical.recommendation,
    canonical_family: canonical.eval_type,
    metadata: {
      ...(canonical.metadata ?? {}),
      canonical_family: canonical.eval_type,
      grader_type: canonical.grader_type,
      evaluator_id: canonical.evaluator_id,
      threshold: canonical.threshold,
      metric: canonical.metric,
    },
  };
}

/**
 * Converts a legacy EvalResult back to a canonical EvalResult.
 * Restores original canonical_family if preserved in compatibility fields.
 */
export function legacyToCanonicalEvalResult(legacy: LegacyEvalResult): CanonicalEvalResult {
  const preservedFamily =
    (legacy.canonical_family as EvalFamily | undefined) ??
    (legacy.metadata?.["canonical_family"] as EvalFamily | undefined);

  const evalFamily: EvalFamily =
    preservedFamily && isValidEvalFamily(preservedFamily)
      ? preservedFamily
      : legacyTypeToCanonicalFamily(legacy.type);

  return {
    eval_id: legacy.eval_id,
    eval_type: evalFamily,
    evaluator_id:
      (legacy.metadata?.["evaluator_id"] as string | undefined) ??
      `legacy_evaluator_${legacy.type}`,
    target_run_id: legacy.run_id,
    target_node_id: legacy.node_id,
    name: legacy.name,
    score: legacy.score,
    passed: legacy.passed,
    severity: legacy.severity,
    evidence_references: (legacy.metadata?.["evidence_references"] as string[]) ?? [],
    findings: legacy.findings,
    recommendation: legacy.recommendation,
    timestamp: new Date().toISOString(),
    grader_type: (legacy.metadata?.["grader_type"] as any) ?? "deterministic",
    threshold: legacy.metadata?.["threshold"] as number | undefined,
    metric: legacy.metadata?.["metric"] as string | undefined,
    metadata: legacy.metadata,
  };
}

const ALL_CANONICAL_FAMILIES = new Set<string>([
  "task_success",
  "output_validity",
  "schema_validity",
  "tool_selection",
  "argument_validity",
  "retrieval",
  "context",
  "memory",
  "trajectory",
  "safety",
  "approval_compliance",
  "regression",
  "cost",
  "latency",
  "model_benchmark",
]);

function isValidEvalFamily(family: string): family is EvalFamily {
  return ALL_CANONICAL_FAMILIES.has(family);
}
