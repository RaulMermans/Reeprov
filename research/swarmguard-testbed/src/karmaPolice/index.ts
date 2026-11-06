/**
 * KARMA POLICE — Cross-Agent Evidence Verification Engine.
 *
 * Implements deterministic cross-agent evidence-verification for multi-agent workflows.
 * Analyzes the relationships between claims, evidence, tool executions, artifacts,
 * versions, and inter-agent handoffs.
 *
 * Identity:
 *   monitor_id: karma_police.cross_agent.v1
 *   monitor_version: 1.0.0
 *   format: reeprov.swarmguard_testbed.monitor_result.v1
 */

import type { RunArtifact } from "../../../../lib/core/contracts/runArtifact";
import type { DetectorEvidence } from "../detector";
import {
  MONITOR_RESULT_FORMAT,
  assertMonitorEvidenceAuthorized,
  extractObservableClaims,
  monitorResultSchema,
  type MonitorResult,
} from "../baselines/schema";
import {
  KARMA_POLICE_FINDINGS_FORMAT,
  KARMA_POLICE_MONITOR_ID,
  KARMA_POLICE_MONITOR_VERSION,
  karmaPoliceFindingsReportSchema,
  type KarmaPoliceExecutionOutput,
  type KarmaPoliceFindingsReport,
  type KarmaPoliceOptions,
} from "./types";
import { buildEvidenceIndex } from "./evidenceIndex";
import { resolveObservableClaim } from "./claimResolver";

export * from "./types";
export { buildEvidenceIndex, isCrossRun } from "./evidenceIndex";
export { resolveObservableClaim } from "./claimResolver";

const LIMITATIONS = [
  "Requires canonical Reeprov execution evidence and observable claim extraction.",
  "Deterministic predicates verify structured outcomes, artifacts, and documentary records.",
  "Language-only claims with no recorded documentary or tool evidence default to unverified abstention.",
  "Cross-run and stale references are flagged as provenance anomalies rather than assumed false.",
];

function isDetectorEvidence(input: DetectorEvidence | RunArtifact): input is DetectorEvidence {
  return "artifact" in input && "detector_dir" in input;
}

export function runKarmaPoliceWithFindings(
  input: DetectorEvidence | RunArtifact,
  options?: KarmaPoliceOptions
): KarmaPoliceExecutionOutput {
  const started = Date.now();

  // Enforce detector role mode
  process.env["REEPROV_P3_DETECTOR_ROLE"] = "1";

  const artifact: RunArtifact = isDetectorEvidence(input) ? input.artifact : input;
  const bundle = isDetectorEvidence(input) ? input.bundle : undefined;

  assertMonitorEvidenceAuthorized(artifact);

  const runId = artifact.identity.run_id;
  const index = buildEvidenceIndex(artifact, bundle);
  const observableClaims = extractObservableClaims(artifact);

  const predictions = [];
  const findings = [];

  let supportedCount = 0;
  let contradictedCount = 0;
  let unverifiedCount = 0;
  let anomalyCount = 0;

  for (const claim of observableClaims) {
    const { prediction, finding } = resolveObservableClaim(claim, index);
    predictions.push(prediction);
    findings.push(finding);

    if (prediction.classification === "supported") supportedCount++;
    else if (prediction.classification === "contradicted") contradictedCount++;
    else unverifiedCount++;

    if (
      finding.provenance_anomalies.length > 0 &&
      !finding.provenance_anomalies.includes("none")
    ) {
      anomalyCount += finding.provenance_anomalies.length;
    }
  }

  const latencyMs = Math.max(1, Date.now() - started);

  const monitorResult: MonitorResult = monitorResultSchema.parse({
    format: MONITOR_RESULT_FORMAT,
    monitor_id: KARMA_POLICE_MONITOR_ID,
    monitor_version: KARMA_POLICE_MONITOR_VERSION,
    case_id: options?.caseId,
    run_id: runId,
    domain_id: options?.domainId ?? artifact.identity.project_id,
    predictions,
    latency_ms: latencyMs,
    limitations: LIMITATIONS,
  });

  const findingsReport: KarmaPoliceFindingsReport = karmaPoliceFindingsReportSchema.parse({
    format: KARMA_POLICE_FINDINGS_FORMAT,
    monitor_id: KARMA_POLICE_MONITOR_ID,
    monitor_version: KARMA_POLICE_MONITOR_VERSION,
    run_id: runId,
    case_id: options?.caseId,
    domain_id: options?.domainId ?? artifact.identity.project_id,
    findings,
    summary: {
      total_claims: observableClaims.length,
      supported_claims: supportedCount,
      contradicted_claims: contradictedCount,
      unverified_claims: unverifiedCount,
      provenance_anomalies_detected: anomalyCount,
    },
  });

  return { result: monitorResult, findings: findingsReport };
}

export function runKarmaPolice(
  input: DetectorEvidence | RunArtifact,
  options?: KarmaPoliceOptions
): MonitorResult {
  return runKarmaPoliceWithFindings(input, options).result;
}
