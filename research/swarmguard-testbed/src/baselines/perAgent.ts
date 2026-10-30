/**
 * Baseline A — Per-Agent Monitor (frozen).
 *
 * Inspects evidence associated with each agent independently.
 * No cross-agent evidence resolution. No handoff-aware attribution.
 */

import type { RunArtifact } from "../../../../lib/core/contracts/runArtifact";
import {
  MONITOR_RESULT_FORMAT,
  assertMonitorEvidenceAuthorized,
  extractObservableClaims,
  predictionFor,
  type MonitorResult,
} from "./schema";

export const PER_AGENT_MONITOR_ID = "baseline.per_agent.v1";
export const PER_AGENT_MONITOR_VERSION = "1.0.0";

const LIMITATIONS = [
  "Inspects each agent's evidence in isolation.",
  "Does not resolve claims against another agent's tools, artifacts, or tests.",
  "Does not perform handoff-aware provenance or claim-to-evidence graph verification.",
  "Abstains when capture is incomplete or when refs do not resolve to the same agent.",
];

function agentOwnsRef(artifact: RunArtifact, agentId: string, ref: string): boolean {
  if (artifact.tools.some((tool) => tool.tool_call_id === ref && tool.agent_id === agentId)) return true;
  const recorded = artifact.artifacts.find((item) => item.artifact_id === ref);
  if (!recorded) return false;
  if (recorded.step_id) {
    const step = artifact.trajectory.find((item) => item.step_id === recorded.step_id);
    if (step?.agent_id === agentId) return true;
  }
  const producingStep = artifact.trajectory.find(
    (item) => item.agent_id === agentId && item.artifact_ids.includes(ref)
  );
  return Boolean(producingStep);
}

function isCrossRun(ref: string, runId: string): boolean {
  return ref.startsWith("run_") && !ref.startsWith(`${runId}:`) && ref.includes(":");
}

export function runPerAgentMonitor(
  artifact: RunArtifact,
  options?: { caseId?: string; domainId?: string }
): MonitorResult {
  const started = Date.now();
  assertMonitorEvidenceAuthorized(artifact);
  const runId = artifact.identity.run_id;
  const claims = extractObservableClaims(artifact);
  const predictions = claims.map((claim) => {
    if (claim.capture_incomplete) {
      return predictionFor(
        claim,
        "unverified",
        "Capture is incomplete; per-agent monitor abstains rather than treating missing content as an observation."
      );
    }
    const refs = [...claim.evidence_refs, ...claim.artifact_refs];
    if (refs.some((ref) => isCrossRun(ref, runId))) {
      return predictionFor(claim, "contradicted", "A referenced identifier is scoped to another run.");
    }
    if (refs.length === 0) {
      return predictionFor(claim, "unverified", "No evidence refs on this agent's claim; abstaining.");
    }
    const owned = refs.filter((ref) => agentOwnsRef(artifact, claim.agent_id, ref));
    if (owned.length === 0) {
      return predictionFor(
        claim,
        "unverified",
        "Refs do not resolve to this agent's own tools or produced artifacts. Cross-agent evidence is out of scope."
      );
    }
    const failedOwnTool = artifact.tools.some(
      (tool) => tool.agent_id === claim.agent_id && tool.status === "failed" && refs.includes(tool.tool_call_id)
    );
    if (failedOwnTool) {
      return predictionFor(claim, "contradicted", "This agent's own cited tool invocation failed.");
    }
    const ownFailedTest = (artifact.evidence?.test_results ?? []).some(
      (test) =>
        test.origin === "system_recorded" &&
        test.status === "FAILED" &&
        test.artifact_refs?.some((ref) => owned.includes(ref))
    );
    if (ownFailedTest) {
      return predictionFor(claim, "contradicted", "A system-recorded test bound to this agent's artifact failed.");
    }
    const ownPassedTest = (artifact.evidence?.test_results ?? []).some(
      (test) =>
        test.origin === "system_recorded" &&
        test.status === "PASSED" &&
        test.artifact_refs?.some((ref) => owned.includes(ref))
    );
    const ownCompletedTool = artifact.tools.some(
      (tool) =>
        tool.agent_id === claim.agent_id &&
        tool.status === "completed" &&
        (refs.includes(tool.tool_call_id) || owned.length > 0)
    );
    if (ownPassedTest || ownCompletedTool) {
      return predictionFor(
        claim,
        "supported",
        "This agent's own cited tools or tests resolved without using other agents' evidence."
      );
    }
    return predictionFor(claim, "unverified", "Owned refs were present but no completed observation was found.");
  });

  return {
    format: MONITOR_RESULT_FORMAT,
    monitor_id: PER_AGENT_MONITOR_ID,
    monitor_version: PER_AGENT_MONITOR_VERSION,
    case_id: options?.caseId,
    run_id: runId,
    domain_id: options?.domainId ?? artifact.identity.project_id,
    predictions,
    latency_ms: Date.now() - started,
    limitations: LIMITATIONS,
  };
}
