/**
 * Baseline B — Pooled-Event Monitor (frozen).
 *
 * Inspects combined run events with simple event/status rules.
 * May see the same raw evidence as SwarmGuard but does not build a
 * claim-to-evidence graph or cross-agent provenance verification.
 */

import type { RunArtifact } from "../../../../lib/core/contracts/runArtifact";
import { validateEvidenceIntegrity } from "../../../../lib/core/contracts/evidence";
import {
  MONITOR_RESULT_FORMAT,
  assertMonitorEvidenceAuthorized,
  extractObservableClaims,
  predictionFor,
  type MonitorResult,
} from "./schema";

export const POOLED_EVENT_MONITOR_ID = "baseline.pooled_event.v1";
export const POOLED_EVENT_MONITOR_VERSION = "1.0.0";

const LIMITATIONS = [
  "Pools all run events and applies global status rules.",
  "Does not bind a specific claim to the specific evidence that would support it.",
  "A single system-recorded failure can mark unrelated claims as contradicted.",
  "A single system-recorded pass can mark unrelated claims as supported.",
  "Does not implement claim-to-evidence graphs or cross-agent provenance verification.",
];

function isCrossRun(ref: string, runId: string): boolean {
  return ref.startsWith("run_") && !ref.startsWith(`${runId}:`) && ref.includes(":");
}

export function runPooledEventMonitor(
  artifact: RunArtifact,
  options?: { caseId?: string; domainId?: string }
): MonitorResult {
  const started = Date.now();
  assertMonitorEvidenceAuthorized(artifact);
  const runId = artifact.identity.run_id;
  const integrity = validateEvidenceIntegrity(artifact);
  const systemFailed = (artifact.evidence?.test_results ?? []).some(
    (test) => test.origin === "system_recorded" && test.status === "FAILED"
  );
  const systemPassed = (artifact.evidence?.test_results ?? []).some(
    (test) => test.origin === "system_recorded" && test.status === "PASSED"
  );
  const claims = extractObservableClaims(artifact);
  const predictions = claims.map((claim) => {
    if (claim.capture_incomplete) {
      return predictionFor(
        claim,
        "unverified",
        "Capture is incomplete; pooled-event monitor abstains rather than inventing an observation."
      );
    }
    const refs = [...claim.evidence_refs, ...claim.artifact_refs];
    if (refs.some((ref) => isCrossRun(ref, runId))) {
      return predictionFor(claim, "contradicted", "Pooled integrity rule: a ref is scoped to another run.");
    }
    if (integrity.references.some((ref) => ref.status === "CROSS_RUN" && refs.includes(ref.ref))) {
      return predictionFor(claim, "contradicted", "Pooled integrity report marked a cited ref CROSS_RUN.");
    }
    if (refs.length === 0) {
      return predictionFor(claim, "unverified", "Pooled rule: event or handoff carries no evidence refs.");
    }
    if (systemFailed) {
      return predictionFor(
        claim,
        "contradicted",
        "Pooled rule: a system-recorded test failed somewhere in the run."
      );
    }
    if (systemPassed) {
      return predictionFor(
        claim,
        "supported",
        "Pooled rule: a system-recorded test passed somewhere in the run."
      );
    }
    const anyCompletedTool = artifact.tools.some((tool) => tool.status === "completed");
    if (anyCompletedTool) {
      return predictionFor(
        claim,
        "supported",
        "Pooled rule: some tool in the run completed; claims are not individually bound to that tool."
      );
    }
    return predictionFor(claim, "unverified", "Pooled events did not yield a status rule match.");
  });

  return {
    format: MONITOR_RESULT_FORMAT,
    monitor_id: POOLED_EVENT_MONITOR_ID,
    monitor_version: POOLED_EVENT_MONITOR_VERSION,
    case_id: options?.caseId,
    run_id: runId,
    domain_id: options?.domainId ?? artifact.identity.project_id,
    predictions,
    latency_ms: Date.now() - started,
    limitations: LIMITATIONS,
  };
}
