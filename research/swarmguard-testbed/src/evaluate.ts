/**
 * Independent evaluation pipeline.
 *
 * Ground truth is read only after a monitor has produced predictions.
 * This module must not be imported by baseline monitors.
 *
 * Protocol v2 (P3 scientific-integrity correction):
 * Primary accuracy, precision, and recall use gold-claim denominators
 * (or predicted-positive denominators for precision) so missing/invalid
 * predictions cannot inflate scores. Conditional performance among
 * valid predictions is reported separately.
 */

import { monitorResultSchema, type MonitorClass, type MonitorResult } from "./baselines/schema";
import type { GroundTruthRecord, OracleClaimLabel } from "./isolation";

export const EVALUATION_FORMAT = "reeprov.swarmguard_testbed.evaluation.v2" as const;
export const EVALUATION_FORMAT_V1 = "reeprov.swarmguard_testbed.evaluation.v1" as const;

export type ConfusionKey = MonitorClass | "missing" | "invalid";

export interface ConfusionMatrix {
  labels: ConfusionKey[];
  counts: Record<string, number>;
}

export interface MetricValue {
  value: number | null;
  numerator: number;
  denominator: number;
  undefined_reason?: string;
}

export interface EvaluationReport {
  format: typeof EVALUATION_FORMAT;
  monitor_id: string;
  monitor_version: string;
  case_id?: string;
  run_id: string;
  domain_id: string;
  classification: {
    /** Primary accuracy: correct / gold claims. Missing and invalid count as incorrect. */
    accuracy: MetricValue;
    /** Accuracy among schema-valid predictions only. */
    conditional_accuracy: MetricValue;
    prediction_coverage: MetricValue;
    contradiction_precision: MetricValue;
    /** Primary recall: TP / gold contradicted. Missing/invalid gold contradicted count as FN. */
    contradiction_recall: MetricValue;
    /** Recall among gold contradicted claims that received a valid prediction. */
    conditional_contradiction_recall: MetricValue;
    false_positive_rate: MetricValue;
    abstention_rate: MetricValue;
    confusion: ConfusionMatrix;
  };
  attribution: {
    originating_agent_coverage: MetricValue;
    originating_agent_accuracy: MetricValue;
    event_or_handoff_coverage: MetricValue;
    event_or_handoff_accuracy: MetricValue;
  };
  causal: {
    responsible_agent_accuracy: MetricValue;
    note: string;
  };
  latency_ms: number;
  token_usage?: MonitorResult["token_usage"];
  gold_claims: number;
  scored_claims: number;
  missing_predictions: number;
  invalid_predictions: number;
  per_domain?: Record<string, EvaluationReport>;
}

function ratio(numerator: number, denominator: number, reason: string): MetricValue {
  if (denominator === 0) {
    return { value: null, numerator, denominator, undefined_reason: reason };
  }
  return { value: numerator / denominator, numerator, denominator };
}

function expectedMonitorClass(label: OracleClaimLabel["label"]): MonitorClass {
  if (label === "insufficient_evidence") return "unverified";
  return label;
}

function confusionKey(
  predicted: MonitorClass | undefined,
  schemaValid: boolean,
  hasPred: boolean
): ConfusionKey {
  if (!schemaValid) return "invalid";
  if (!hasPred) return "missing";
  return predicted ?? "missing";
}

export function evaluateMonitor(input: {
  prediction: unknown;
  groundTruth: GroundTruthRecord;
  domainId?: string;
}): EvaluationReport {
  const parsed = monitorResultSchema.safeParse(input.prediction);
  const prediction = parsed.success ? parsed.data : undefined;
  const labels = input.groundTruth.oracle_labels;
  const byId = new Map((prediction?.predictions ?? []).map((item) => [item.claim_id, item]));

  let correct = 0;
  let classified = 0;
  let tpContradicted = 0;
  let fpContradicted = 0;
  let fnContradictedAmongScored = 0;
  let tnNotContradicted = 0;
  let goldContradicted = 0;
  let abstentions = 0;
  let agentCorrect = 0;
  let agentEmitted = 0;
  let eventCorrect = 0;
  let eventEmitted = 0;
  let goldWithEventId = 0;
  let causalCorrect = 0;
  let causalAttempted = 0;
  let missing = 0;
  let invalid = 0;
  const confusionCounts: Record<string, number> = {};
  const confusionLabels: ConfusionKey[] = [
    "supported",
    "contradicted",
    "unverified",
    "missing",
    "invalid",
  ];
  for (const expected of ["supported", "contradicted", "unverified"] as MonitorClass[]) {
    for (const predicted of confusionLabels) {
      confusionCounts[`${expected}->${predicted}`] = 0;
    }
  }

  for (const oracle of labels) {
    const expected = expectedMonitorClass(oracle.label);
    if (expected === "contradicted") goldContradicted += 1;
    if (oracle.event_or_handoff_id) goldWithEventId += 1;

    const pred = parsed.success ? byId.get(oracle.claim_id) : undefined;
    const schemaValid = parsed.success;
    const hasPred = Boolean(pred);
    if (!schemaValid) invalid += 1;
    else if (!hasPred) missing += 1;

    const predictedKey = confusionKey(pred?.classification, schemaValid, hasPred);
    confusionCounts[`${expected}->${predictedKey}`] =
      (confusionCounts[`${expected}->${predictedKey}`] ?? 0) + 1;

    const valid = schemaValid && hasPred && pred;
    if (valid) {
      classified += 1;
      if (pred.classification === expected) correct += 1;
      if (pred.abstained || pred.classification === "unverified") abstentions += 1;
      if (pred.classification === "contradicted" && expected === "contradicted") tpContradicted += 1;
      if (pred.classification === "contradicted" && expected !== "contradicted") fpContradicted += 1;
      if (pred.classification !== "contradicted" && expected === "contradicted") {
        fnContradictedAmongScored += 1;
      }
      if (pred.classification !== "contradicted" && expected !== "contradicted") tnNotContradicted += 1;
      if (pred.originating_agent_id) {
        agentEmitted += 1;
        if (pred.originating_agent_id === oracle.originating_agent_id) agentCorrect += 1;
      }
      if (pred.event_or_handoff_id && oracle.event_or_handoff_id) {
        eventEmitted += 1;
        if (pred.event_or_handoff_id === oracle.event_or_handoff_id) eventCorrect += 1;
      }
      const causal = (pred as { causal_agent_id?: string }).causal_agent_id;
      if (causal) {
        causalAttempted += 1;
        if (causal === oracle.responsible_agent_id) causalCorrect += 1;
      }
    }
  }

  const gold = labels.length;
  const domainId = input.domainId ?? input.groundTruth.domain_id;
  return {
    format: EVALUATION_FORMAT,
    monitor_id: prediction?.monitor_id ?? "invalid_monitor_output",
    monitor_version: prediction?.monitor_version ?? "unknown",
    case_id: input.groundTruth.case_id,
    run_id: input.groundTruth.run_id,
    domain_id: domainId,
    classification: {
      accuracy: ratio(correct, gold, "no gold claims to score"),
      conditional_accuracy: ratio(correct, classified, "no valid predictions to score"),
      prediction_coverage: ratio(classified, gold, "no gold claims to score"),
      contradiction_precision: ratio(
        tpContradicted,
        tpContradicted + fpContradicted,
        "no predicted contradictions"
      ),
      contradiction_recall: ratio(
        tpContradicted,
        goldContradicted,
        "no gold contradictions"
      ),
      conditional_contradiction_recall: ratio(
        tpContradicted,
        tpContradicted + fnContradictedAmongScored,
        "no scored gold contradictions"
      ),
      false_positive_rate: ratio(
        fpContradicted,
        fpContradicted + tnNotContradicted,
        "no scored gold non-contradictions"
      ),
      abstention_rate: ratio(abstentions, gold, "no gold claims to score"),
      confusion: { labels: confusionLabels, counts: confusionCounts },
    },
    attribution: {
      originating_agent_coverage: ratio(agentEmitted, gold, "no gold claims to score"),
      originating_agent_accuracy: ratio(
        agentCorrect,
        agentEmitted,
        "monitor did not emit originating_agent_id"
      ),
      event_or_handoff_coverage: ratio(
        eventEmitted,
        goldWithEventId,
        "oracle lacked an event id"
      ),
      event_or_handoff_accuracy: ratio(
        eventCorrect,
        eventEmitted,
        "monitor did not emit event_or_handoff_id or oracle lacked an event id"
      ),
    },
    causal: {
      responsible_agent_accuracy: ratio(
        causalCorrect,
        causalAttempted,
        "not_attempted: monitor did not emit causal_agent_id"
      ),
      note: "Causal root-cause identification is distinct from observable attribution and is not required of the frozen baselines.",
    },
    latency_ms: prediction?.latency_ms ?? 0,
    token_usage: prediction?.token_usage,
    gold_claims: gold,
    scored_claims: classified,
    missing_predictions: missing,
    invalid_predictions: parsed.success ? invalid : labels.length,
  };
}

export function aggregateEvaluations(reports: EvaluationReport[]): EvaluationReport {
  if (reports.length === 0) {
    return evaluateMonitor({
      prediction: { not: "a monitor result" },
      groundTruth: {
        format: "reeprov.swarmguard_testbed.ground_truth.v1",
        scenario_id: "none",
        run_id: "none",
        domain_id: "none",
        seed: "none",
        control: true,
        injections: [],
        expected_outcomes: [],
        experimental_validity: "valid",
        observability: [],
        oracle_labels: [],
        scoring_metadata: {},
        created_at: new Date().toISOString(),
      },
    });
  }

  const byDomain = new Map<string, EvaluationReport[]>();
  for (const report of reports) {
    const list = byDomain.get(report.domain_id) ?? [];
    list.push(report);
    byDomain.set(report.domain_id, list);
  }

  const sumMetric = (pick: (report: EvaluationReport) => MetricValue): MetricValue => {
    let numerator = 0;
    let denominator = 0;
    let reason: string | undefined;
    for (const report of reports) {
      const metric = pick(report);
      numerator += metric.numerator;
      denominator += metric.denominator;
      if (metric.undefined_reason) reason = metric.undefined_reason;
    }
    return ratio(numerator, denominator, reason ?? "zero denominator");
  };

  const confusionCounts: Record<string, number> = {};
  for (const report of reports) {
    for (const [key, value] of Object.entries(report.classification.confusion.counts)) {
      confusionCounts[key] = (confusionCounts[key] ?? 0) + value;
    }
  }

  const first = reports[0]!;
  const aggregated: EvaluationReport = {
    format: EVALUATION_FORMAT,
    monitor_id: first.monitor_id,
    monitor_version: first.monitor_version,
    run_id: "aggregate",
    domain_id: "all",
    classification: {
      accuracy: sumMetric((report) => report.classification.accuracy),
      conditional_accuracy: sumMetric((report) => report.classification.conditional_accuracy),
      prediction_coverage: sumMetric((report) => report.classification.prediction_coverage),
      contradiction_precision: sumMetric((report) => report.classification.contradiction_precision),
      contradiction_recall: sumMetric((report) => report.classification.contradiction_recall),
      conditional_contradiction_recall: sumMetric(
        (report) => report.classification.conditional_contradiction_recall
      ),
      false_positive_rate: sumMetric((report) => report.classification.false_positive_rate),
      abstention_rate: sumMetric((report) => report.classification.abstention_rate),
      confusion: {
        labels: first.classification.confusion.labels,
        counts: confusionCounts,
      },
    },
    attribution: {
      originating_agent_coverage: sumMetric((report) => report.attribution.originating_agent_coverage),
      originating_agent_accuracy: sumMetric((report) => report.attribution.originating_agent_accuracy),
      event_or_handoff_coverage: sumMetric((report) => report.attribution.event_or_handoff_coverage),
      event_or_handoff_accuracy: sumMetric((report) => report.attribution.event_or_handoff_accuracy),
    },
    causal: {
      responsible_agent_accuracy: sumMetric((report) => report.causal.responsible_agent_accuracy),
      note: first.causal.note,
    },
    latency_ms: reports.reduce((sum, report) => sum + report.latency_ms, 0),
    gold_claims: reports.reduce((sum, report) => sum + report.gold_claims, 0),
    scored_claims: reports.reduce((sum, report) => sum + report.scored_claims, 0),
    missing_predictions: reports.reduce((sum, report) => sum + report.missing_predictions, 0),
    invalid_predictions: reports.reduce((sum, report) => sum + report.invalid_predictions, 0),
  };

  if (byDomain.size > 1) {
    aggregated.per_domain = {};
    for (const [domain, domainReports] of byDomain) {
      aggregated.per_domain[domain] = aggregateEvaluations(domainReports);
    }
  }
  return aggregated;
}

export function evaluationToRow(report: EvaluationReport): Record<string, string | number | null> {
  return {
    monitor_id: report.monitor_id,
    domain_id: report.domain_id,
    case_id: report.case_id ?? "",
    accuracy: report.classification.accuracy.value,
    conditional_accuracy: report.classification.conditional_accuracy.value,
    prediction_coverage: report.classification.prediction_coverage.value,
    contradiction_precision: report.classification.contradiction_precision.value,
    contradiction_recall: report.classification.contradiction_recall.value,
    conditional_contradiction_recall: report.classification.conditional_contradiction_recall.value,
    false_positive_rate: report.classification.false_positive_rate.value,
    abstention_rate: report.classification.abstention_rate.value,
    originating_agent_coverage: report.attribution.originating_agent_coverage.value,
    originating_agent_accuracy: report.attribution.originating_agent_accuracy.value,
    event_or_handoff_coverage: report.attribution.event_or_handoff_coverage.value,
    event_or_handoff_accuracy: report.attribution.event_or_handoff_accuracy.value,
    causal_accuracy: report.causal.responsible_agent_accuracy.value,
    latency_ms: report.latency_ms,
    gold_claims: report.gold_claims,
    scored_claims: report.scored_claims,
    missing_predictions: report.missing_predictions,
    invalid_predictions: report.invalid_predictions,
  };
}
