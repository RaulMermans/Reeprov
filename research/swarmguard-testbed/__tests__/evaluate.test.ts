import { describe, expect, it } from "vitest";
import { evaluateMonitor, aggregateEvaluations } from "../src/evaluate";
import { createGroundTruth, type OracleClaimLabel } from "../src/isolation";
import { MONITOR_RESULT_FORMAT, type MonitorResult } from "../src/baselines/schema";

function labels(items: Array<Partial<OracleClaimLabel> & Pick<OracleClaimLabel, "claim_id" | "label">>): OracleClaimLabel[] {
  return items.map((item) => ({
    agent_id: item.agent_id ?? "coder",
    event_kind: item.event_kind ?? "assertion",
    originating_agent_id: item.originating_agent_id ?? "coder",
    responsible_agent_id: item.responsible_agent_id ?? "coder",
    justification: item.justification ?? "fixture",
    ...item,
  }));
}

function prediction(overrides: Partial<MonitorResult> & Pick<MonitorResult, "predictions">): MonitorResult {
  return {
    format: MONITOR_RESULT_FORMAT,
    monitor_id: "baseline.per_agent.v1",
    monitor_version: "1.0.0",
    run_id: "run_eval",
    domain_id: "software-engineering",
    latency_ms: 4,
    limitations: ["fixture"],
    ...overrides,
  };
}

function pred(
  claim_id: string,
  classification: "supported" | "contradicted" | "unverified",
  extra?: Record<string, unknown>
) {
  return {
    claim_id,
    agent_id: "coder",
    event_kind: "assertion" as const,
    classification,
    originating_agent_id: "coder",
    event_or_handoff_id: `evt_${claim_id}`,
    abstained: classification === "unverified",
    rationale: "fixture",
    confidence: classification === "unverified" ? ("low" as const) : ("medium" as const),
    capture_incomplete: false,
    ...extra,
  };
}

describe("P3 evaluation: independent scoring fixtures", () => {
  it("reproduces known precision, recall, accuracy, and confusion counts", () => {
    const groundTruth = createGroundTruth({
      scenarioId: "s",
      runId: "run_eval",
      domainId: "software-engineering",
      seed: "eval",
      plan: { enabled: false, config: {} },
      oracleLabels: labels([
        { claim_id: "c1", label: "supported", event_or_handoff_id: "evt_c1" },
        { claim_id: "c2", label: "contradicted", event_or_handoff_id: "evt_c2" },
        { claim_id: "c3", label: "insufficient_evidence", event_or_handoff_id: "evt_c3" },
        { claim_id: "c4", label: "contradicted", event_or_handoff_id: "evt_c4" },
      ]),
    });
    const report = evaluateMonitor({
      groundTruth,
      prediction: prediction({
        predictions: [
          pred("c1", "supported"),
          pred("c2", "contradicted"),
          pred("c3", "unverified"),
          pred("c4", "supported"),
        ],
      }),
    });
    expect(report.classification.accuracy).toEqual({ value: 0.75, numerator: 3, denominator: 4 });
    expect(report.classification.contradiction_precision).toEqual({
      value: 1,
      numerator: 1,
      denominator: 1,
    });
    expect(report.classification.contradiction_recall).toEqual({
      value: 0.5,
      numerator: 1,
      denominator: 2,
    });
    expect(report.classification.false_positive_rate.value).toBe(0);
    expect(report.classification.confusion.counts["contradicted->supported"]).toBe(1);
    expect(report.attribution.originating_agent_accuracy.value).toBe(1);
    expect(report.causal.responsible_agent_accuracy.value).toBeNull();
    expect(report.causal.responsible_agent_accuracy.undefined_reason).toMatch(/not_attempted/i);
  });

  it("handles missing predictions, invalid output, and empty oracles", () => {
    const groundTruth = createGroundTruth({
      scenarioId: "s",
      runId: "run_eval_empty",
      domainId: "investigation",
      seed: "eval",
      plan: { enabled: false, config: {} },
      oracleLabels: labels([{ claim_id: "c1", label: "supported" }]),
    });
    const missing = evaluateMonitor({
      groundTruth,
      prediction: prediction({ predictions: [] }),
    });
    expect(missing.missing_predictions).toBe(1);
    expect(missing.classification.accuracy.value).toBeNull();
    const invalid = evaluateMonitor({
      groundTruth,
      prediction: { not: "valid" },
    });
    expect(invalid.invalid_predictions).toBe(1);
    const empty = evaluateMonitor({
      groundTruth: createGroundTruth({
        scenarioId: "s",
        runId: "r",
        domainId: "investigation",
        seed: "x",
        plan: { enabled: false, config: {} },
      }),
      prediction: prediction({ predictions: [] }),
    });
    expect(empty.classification.contradiction_precision.value).toBeNull();
    const aggregated = aggregateEvaluations([missing, invalid]);
    expect(aggregated.missing_predictions).toBeGreaterThan(0);
  });
});
