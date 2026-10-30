import { describe, expect, it } from "vitest";
import { aggregateEvaluations, evaluateMonitor } from "../src/evaluate";
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
    expect(report.classification.conditional_accuracy).toEqual({ value: 0.75, numerator: 3, denominator: 4 });
    expect(report.classification.prediction_coverage).toEqual({ value: 1, numerator: 4, denominator: 4 });
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

  it("does not let missing predictions inflate primary accuracy or recall", () => {
    const groundTruth = createGroundTruth({
      scenarioId: "s",
      runId: "run_eval_missing_mix",
      domainId: "software-engineering",
      seed: "eval",
      plan: { enabled: false, config: {} },
      oracleLabels: labels([
        { claim_id: "easy", label: "supported", event_or_handoff_id: "evt_easy" },
        { claim_id: "hard", label: "contradicted", event_or_handoff_id: "evt_hard" },
      ]),
    });
    const report = evaluateMonitor({
      groundTruth,
      prediction: prediction({
        predictions: [pred("easy", "supported")],
      }),
    });
    expect(report.missing_predictions).toBe(1);
    expect(report.gold_claims).toBe(2);
    expect(report.classification.conditional_accuracy).toEqual({ value: 1, numerator: 1, denominator: 1 });
    expect(report.classification.accuracy).toEqual({ value: 0.5, numerator: 1, denominator: 2 });
    expect(report.classification.prediction_coverage).toEqual({ value: 0.5, numerator: 1, denominator: 2 });
    expect(report.classification.contradiction_recall).toEqual({ value: 0, numerator: 0, denominator: 1 });
    expect(report.classification.conditional_contradiction_recall.value).toBeNull();
    expect(report.classification.confusion.counts["contradicted->missing"]).toBe(1);
  });

  it("treats invalid monitor output as coverage zero rather than undefined-as-perfect", () => {
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
    expect(missing.classification.accuracy).toEqual({ value: 0, numerator: 0, denominator: 1 });
    expect(missing.classification.conditional_accuracy.value).toBeNull();
    expect(missing.classification.prediction_coverage).toEqual({ value: 0, numerator: 0, denominator: 1 });
    const invalid = evaluateMonitor({
      groundTruth,
      prediction: { not: "valid" },
    });
    expect(invalid.invalid_predictions).toBe(1);
    expect(invalid.missing_predictions).toBe(0);
    expect(invalid.classification.accuracy).toEqual({ value: 0, numerator: 0, denominator: 1 });
    expect(invalid.classification.confusion.counts["supported->invalid"]).toBe(1);
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
    expect(aggregated.classification.accuracy).toEqual({ value: 0, numerator: 0, denominator: 2 });
  });

  it("aggregates coverage and primary metrics from independent fixtures", () => {
    const gt = (id: string, label: OracleClaimLabel["label"]) =>
      createGroundTruth({
        scenarioId: "s",
        runId: id,
        domainId: id.startsWith("se") ? "software-engineering" : "investigation",
        seed: "x",
        plan: { enabled: false, config: {} },
        oracleLabels: labels([{ claim_id: "c1", label, event_or_handoff_id: "evt_c1" }]),
      });
    const a = evaluateMonitor({
      groundTruth: gt("se1", "contradicted"),
      prediction: prediction({ predictions: [pred("c1", "contradicted")] }),
    });
    const b = evaluateMonitor({
      groundTruth: gt("inv1", "contradicted"),
      prediction: prediction({ predictions: [] }),
    });
    const aggregated = aggregateEvaluations([a, b]);
    expect(aggregated.classification.contradiction_precision).toEqual({ value: 1, numerator: 1, denominator: 1 });
    expect(aggregated.classification.contradiction_recall).toEqual({ value: 0.5, numerator: 1, denominator: 2 });
    expect(aggregated.classification.prediction_coverage).toEqual({ value: 0.5, numerator: 1, denominator: 2 });
    expect(aggregated.per_domain).toBeDefined();
  });
});
