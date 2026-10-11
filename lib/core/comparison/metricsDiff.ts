/**
 * Normalized Metrics Diff Engine with Directional Semantics.
 *
 * Computes absolute and safe percentage deltas across execution metrics,
 * guarding against zero-division errors and classifying changes as
 * IMPROVED, REGRESSED, NEUTRAL, or CONTEXT_DEPENDENT.
 */

import type { RunArtifact } from "../contracts/runArtifact";
import type {
  MetricsDiff,
  MetricDelta,
  MetricDirection,
  MetricEvaluation,
} from "../contracts/comparison";

interface MetricRule {
  key: string;
  direction: MetricDirection;
  extract: (run: RunArtifact) => number;
}

const METRIC_RULES: MetricRule[] = [
  {
    key: "cost_usd",
    direction: "LOWER_IS_BETTER",
    extract: (r) => r.observability?.total_cost_usd ?? (r as any).metrics?.cost_usd ?? 0,
  },
  {
    key: "duration_ms",
    direction: "LOWER_IS_BETTER",
    extract: (r) =>
      r.observability?.total_duration_ms ??
      r.execution?.duration_ms ??
      (r as any).metrics?.latency_ms ??
      0,
  },
  {
    key: "tests_passed",
    direction: "HIGHER_IS_BETTER",
    extract: (r) => (r.evidence?.test_results ?? []).filter((t) => t.status === "PASSED").length,
  },
  {
    key: "tests_failed",
    direction: "LOWER_IS_BETTER",
    extract: (r) => (r.evidence?.test_results ?? []).filter((t) => t.status === "FAILED" || t.status === "ERROR").length,
  },
  {
    key: "reviews_passed",
    direction: "HIGHER_IS_BETTER",
    extract: (r) => (r.evidence?.review_results ?? []).filter((rv) => rv.status === "PASSED").length,
  },
  {
    key: "security_violations",
    direction: "LOWER_IS_BETTER",
    extract: (r) =>
      (r.evidence?.security_events ?? []).filter((s) => s.decision === "DENY" || s.decision === "BLOCKED").length,
  },
  {
    key: "blocked_actions",
    direction: "LOWER_IS_BETTER",
    extract: (r) =>
      (r.evidence?.security_events ?? []).filter((s) => s.decision === "BLOCKED").length,
  },
  {
    key: "evals_passed",
    direction: "HIGHER_IS_BETTER",
    extract: (r) => r.observability?.evals_passed ?? 0,
  },
  {
    key: "evals_failed",
    direction: "LOWER_IS_BETTER",
    extract: (r) => r.observability?.evals_failed ?? 0,
  },
  {
    key: "retries",
    direction: "LOWER_IS_BETTER",
    extract: (r) =>
      (r.tools ?? []).reduce((acc, t) => acc + ((t.metadata?.["retry_count"] as number) ?? 0), 0),
  },
  {
    key: "total_tokens",
    direction: "CONTEXT_DEPENDENT",
    extract: (r) => r.observability?.total_tokens ?? 0,
  },
  {
    key: "steps_count",
    direction: "CONTEXT_DEPENDENT",
    extract: (r) => r.trajectory?.length ?? 0,
  },
  {
    key: "model_calls_count",
    direction: "CONTEXT_DEPENDENT",
    extract: (r) => r.observability?.model_calls_count ?? 0,
  },
  {
    key: "tool_calls_count",
    direction: "CONTEXT_DEPENDENT",
    extract: (r) => r.observability?.tool_calls_count ?? 0,
  },
  {
    key: "retrieval_calls_count",
    direction: "CONTEXT_DEPENDENT",
    extract: (r) => r.observability?.retrieval_operations_count ?? 0,
  },
  {
    key: "memory_operations_count",
    direction: "CONTEXT_DEPENDENT",
    extract: (r) => r.observability?.memory_operations_count ?? 0,
  },
];

export function computeMetricDelta(
  key: string,
  direction: MetricDirection,
  baseline: number,
  candidate: number
): MetricDelta {
  const absoluteDelta = Math.round((candidate - baseline) * 1000000) / 1000000;

  let percentDelta: number | null = null;
  if (baseline === 0) {
    if (candidate === 0) {
      percentDelta = 0;
    } else {
      percentDelta = null; // Infinite / newly introduced, avoid dividing by zero
    }
  } else {
    percentDelta = Math.round(((candidate - baseline) / Math.abs(baseline)) * 10000) / 100;
  }

  let evaluation: MetricEvaluation = "NEUTRAL";

  if (direction === "CONTEXT_DEPENDENT") {
    evaluation = "CONTEXT_DEPENDENT";
  } else if (absoluteDelta === 0) {
    evaluation = "NEUTRAL";
  } else if (direction === "LOWER_IS_BETTER") {
    evaluation = absoluteDelta < 0 ? "IMPROVED" : "REGRESSED";
  } else if (direction === "HIGHER_IS_BETTER") {
    evaluation = absoluteDelta > 0 ? "IMPROVED" : "REGRESSED";
  }

  return {
    key,
    direction,
    baseline,
    candidate,
    absolute_delta: absoluteDelta,
    percent_delta: percentDelta,
    evaluation,
  };
}

export function diffMetrics(baseline: RunArtifact, candidate: RunArtifact): MetricsDiff {
  const deltas: Record<string, MetricDelta> = {};

  for (const rule of METRIC_RULES) {
    const baseVal = rule.extract(baseline);
    const candVal = rule.extract(candidate);
    deltas[rule.key] = computeMetricDelta(rule.key, rule.direction, baseVal, candVal);
  }

  const costDelta = deltas["cost_usd"]?.absolute_delta ?? 0;
  const latencyDelta = deltas["duration_ms"]?.absolute_delta ?? 0;
  const tokensDelta = deltas["total_tokens"]?.absolute_delta ?? 0;

  return {
    deltas,
    cost_delta_usd: costDelta,
    latency_delta_ms: latencyDelta,
    tokens_delta: tokensDelta,
  };
}
