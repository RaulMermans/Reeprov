/**
 * Main Run Comparison Orchestrator.
 *
 * Coordinates execution alignment, structural diffs across all dimensions,
 * divergence classification, optional Layer 2 semantic evaluation, and policy verdict.
 *
 * Guarantees:
 * - Baseline and candidate RunArtifacts are never mutated.
 * - Structural Layer 1 facts execute deterministically with zero LLM dependency.
 * - Cross-project isolation is enforced when configured.
 */

import { randomUUID } from "node:crypto";
import type { RunArtifact } from "../contracts/runArtifact";
import { diffConfiguration, buildAgentConfigurationSnapshot } from "../contracts/configuration";
import {
  runComparisonSchema,
  RUN_COMPARISON_SCHEMA_VERSION,
  type RunComparison,
  type ComparisonPolicy,
  type SemanticComparator,
  type SemanticComparisonResult,
  type ComparisonFinding,
} from "../contracts/comparison";
import { detectRunRelationship } from "./lineageMaterializer";
import { alignRuns } from "./alignment";
import { diffStateSnapshots } from "./stateDiff";
import { diffContextSnapshots } from "./contextDiff";
import { diffRetrievalOperations } from "./retrievalDiff";
import { diffMemoryOperations } from "./memoryDiff";
import { diffToolInvocations } from "./toolDiff";
import { diffModelInvocations } from "./modelDiff";
import { diffEvidencePlane, diffRunOutcomes } from "./evidenceDiff";
import { diffMetrics } from "./metricsDiff";
import { detectDivergences } from "./divergenceDetector";
import { DefaultSemanticComparator, safeSemanticCompare } from "./semanticComparator";
import { evaluateComparisonVerdict } from "./verdictPolicy";

export interface CompareRunsOptions {
  enableSemantic?: boolean;
  semanticComparator?: SemanticComparator;
  policy?: ComparisonPolicy;
  projectId?: string;
}

export class ProjectIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectIsolationError";
  }
}

export async function compareRuns(
  baseline: RunArtifact,
  candidate: RunArtifact,
  options: CompareRunsOptions = {}
): Promise<RunComparison> {
  // 1. Cross-Project Isolation Enforcement
  if (options.projectId) {
    if (
      (baseline.identity.project_id && baseline.identity.project_id !== options.projectId) ||
      (candidate.identity.project_id && candidate.identity.project_id !== options.projectId)
    ) {
      throw new ProjectIsolationError(
        `Cross-project comparison unauthorized: baseline project '${baseline.identity.project_id}' or candidate project '${candidate.identity.project_id}' does not match expected project '${options.projectId}'.`
      );
    }
  }

  const comparisonId = `cmp_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = new Date().toISOString();

  // 2. Relationship Detection
  const relationship = detectRunRelationship(baseline, candidate);

  // 3. Configuration Diff (reused from Sprint 5)
  const baseConfig = baseline.configuration_snapshot ??
    buildAgentConfigurationSnapshot({
      run_id: baseline.identity.run_id,
      agent: { id: baseline.identity.project_id || "agent", version: "1" },
      model: { provider: "unknown", model_id: "unknown", parameters: {} },
    });

  const candConfig = candidate.configuration_snapshot ??
    buildAgentConfigurationSnapshot({
      run_id: candidate.identity.run_id,
      agent: { id: candidate.identity.project_id || "agent", version: "1" },
      model: { provider: "unknown", model_id: "unknown", parameters: {} },
    });

  const configurationDiff = diffConfiguration(baseConfig, candConfig);

  // 4. Execution Step & Boundary Alignment
  const executionAlignment = alignRuns(baseline, candidate);

  // 5. State Diffs
  const stateDiffs = [];
  for (const [bState, cState] of comparableStatePairs(baseline, candidate)) {
    const sDiff = diffStateSnapshots(bState, cState);
    if (sDiff.changes.length > 0) {
      stateDiffs.push(sDiff);
    }
  }

  // 6. Context, Retrieval, Memory Diffs
  const contextDiff = diffContextSnapshots(baseline.context, candidate.context);
  const retrievalDiff = diffRetrievalOperations(baseline.retrieval, candidate.retrieval);
  const memoryDiff = diffMemoryOperations(
    baseline.memory?.operations,
    candidate.memory?.operations,
    baseline.memory?.references,
    candidate.memory?.references
  );

  // 7. Tools & Models Diffs. A resumed fork records only its suffix; compare
  // it as parent prefix (up to the checkpoint cursor) + child suffix so the
  // divergence is located where execution actually branched.
  const candidateBoundaries = forkComparableBoundaries(baseline, candidate);
  const toolChanges = diffToolInvocations(
    baseline.tools,
    candidate.tools,
    baseline.boundaries,
    candidateBoundaries
  );
  const modelChanges = diffModelInvocations(
    baseline.models,
    candidate.models,
    baseline.boundaries,
    candidateBoundaries
  );

  // 8. Evidence & Outcome Diffs
  const evidenceDiff = diffEvidencePlane(
    baseline.evidence,
    candidate.evidence,
    baseline.artifacts,
    candidate.artifacts
  );
  const outcomeDiff = diffRunOutcomes(
    baseline.evidence?.final_outcome,
    candidate.evidence?.final_outcome
  );

  // 9. Metrics Diff
  const metricsDiff = diffMetrics(baseline, candidate);

  // 10. Divergence Detection & Causal Attribution
  const { divergences, first_structural_divergence, first_meaningful_divergence } = detectDivergences({
    baseline,
    candidate,
    configurationDiff,
    alignment: executionAlignment,
    toolChanges,
    modelChanges,
    stateDiffs,
    contextDiff,
    retrievalDiff,
    memoryDiff,
    evidenceDiff,
    metricsDiff,
    outcomeDiff,
  });

  // 11. Optional Semantic Text Comparison
  const semanticComparisons: Record<string, SemanticComparisonResult> = {};
  if (options.enableSemantic) {
    const comparator = options.semanticComparator ?? new DefaultSemanticComparator();

    // Final answer / summary semantic comparison
    const baseSummary = baseline.execution.summary || baseline.evidence?.final_outcome?.summary || "";
    const candSummary = candidate.execution.summary || candidate.evidence?.final_outcome?.summary || "";
    if (baseSummary || candSummary) {
      semanticComparisons["execution_summary"] = await safeSemanticCompare(comparator, {
        text_a: baseSummary,
        text_b: candSummary,
        context_type: "final_answer",
      });
    }

    // Plan goal semantic comparison
    const basePlanGoal = baseline.evidence?.plan?.goal ?? "";
    const candPlanGoal = candidate.evidence?.plan?.goal ?? "";
    if (basePlanGoal && candPlanGoal && basePlanGoal !== candPlanGoal) {
      semanticComparisons["plan_goal"] = await safeSemanticCompare(comparator, {
        text_a: basePlanGoal,
        text_b: candPlanGoal,
        context_type: "plan_description",
      });
    }
  }

  // 12. Verdict Policy Evaluation
  const verdict = evaluateComparisonVerdict({
    outcomeDiff,
    evidenceDiff,
    metricsDiff,
    divergences,
    policy: options.policy,
  });

  // 13. Summary Findings
  const findings: ComparisonFinding[] = [];
  if (first_meaningful_divergence) {
    findings.push({
      finding_id: `fnd_first_div`,
      category: "DIVERGENCE",
      severity: first_meaningful_divergence.severity ?? "info",
      title: `First meaningful divergence: ${first_meaningful_divergence.dimension}`,
      description: first_meaningful_divergence.description,
      causal_status: first_meaningful_divergence.causal_status ?? "OBSERVED_DIFFERENCE",
      evidence_refs: first_meaningful_divergence.evidence_refs ?? [],
    });
  }

  if (outcomeDiff.status_changed) {
    findings.push({
      finding_id: `fnd_outcome`,
      category: "OUTCOME",
      severity: outcomeDiff.candidate_status === "SUCCESS" ? "info" : "critical",
      title: `Outcome changed: ${outcomeDiff.baseline_status} → ${outcomeDiff.candidate_status}`,
      description: `Task result transitioned from ${outcomeDiff.baseline_status} to ${outcomeDiff.candidate_status}.`,
      causal_status: first_meaningful_divergence?.causal_status ?? "OBSERVED_DIFFERENCE",
      evidence_refs: ["evidence.final_outcome"],
    });
  }

  const comparison: RunComparison = {
    comparison_id: comparisonId,
    schema_version: RUN_COMPARISON_SCHEMA_VERSION,
    baseline_run_id: baseline.identity.run_id,
    candidate_run_id: candidate.identity.run_id,
    project_id: baseline.identity.project_id ?? candidate.identity.project_id,
    relationship,
    created_at: now,
    configuration_diff: configurationDiff,
    execution_alignment: executionAlignment,
    divergences,
    state_diffs: stateDiffs,
    context_diff: contextDiff.unavailable ? undefined : contextDiff,
    memory_diff: memoryDiff.changes.length > 0 ? memoryDiff : undefined,
    retrieval_diff: retrievalDiff.changes.length > 0 ? retrievalDiff : undefined,
    evidence_diff: evidenceDiff,
    metrics_diff: metricsDiff,
    outcome_diff: outcomeDiff,
    first_structural_divergence,
    first_meaningful_divergence,
    semantic_comparisons: semanticComparisons,
    findings,
    verdict,
  };

  return runComparisonSchema.parse(comparison);
}

/**
 * For a resumed fork of `baseline`, returns the parent's boundaries before the
 * checkpoint cursor followed by the child's boundaries (re-sequenced). Other
 * candidates are returned unchanged. Nothing is persisted.
 */
export function forkComparableBoundaries(baseline: RunArtifact, candidate: RunArtifact): RunArtifact["boundaries"] {
  const checkpointId = candidate.lineage?.fork_checkpoint_id;
  if (candidate.lineage?.parent_run_id !== baseline.identity.run_id || !checkpointId) return candidate.boundaries;
  const checkpoint = baseline.checkpoints.find((c) => c.checkpoint_id === checkpointId);
  const cursor = checkpoint?.boundary_cursor ?? 0;
  if (cursor === 0) return candidate.boundaries;
  const prefix = [...baseline.boundaries]
    .sort((a, b) => (a.sequence_index ?? 0) - (b.sequence_index ?? 0))
    .slice(0, cursor);
  const suffix = [...candidate.boundaries]
    .sort((a, b) => (a.sequence_index ?? 0) - (b.sequence_index ?? 0))
    .map((b, i) => ({ ...b, sequence_index: cursor + i }));
  return [...prefix, ...suffix];
}

/**
 * State snapshot pairs to diff. Runs are paired by index, except a resumed
 * fork: its restored state is compared with the parent's checkpoint snapshot
 * (showing exactly the controlled mutations). Index pairing would compare
 * unrelated snapshots and report changes that never happened.
 */
export function comparableStatePairs(
  baseline: RunArtifact,
  candidate: RunArtifact,
): Array<[RunArtifact["state"][number] | undefined, RunArtifact["state"][number] | undefined]> {
  const checkpointId = candidate.lineage?.fork_checkpoint_id;
  if (candidate.lineage?.parent_run_id === baseline.identity.run_id && checkpointId) {
    const checkpoint = baseline.checkpoints.find((c) => c.checkpoint_id === checkpointId);
    const parentSnapshot = baseline.state.find((s) => s.snapshot_id === checkpoint?.state_snapshot_id);
    const restored = candidate.state.find((s) => s.snapshot_type === "INITIAL_STATE");
    return parentSnapshot && restored ? [[parentSnapshot, restored]] : [];
  }
  const max = Math.max(baseline.state?.length ?? 0, candidate.state?.length ?? 0);
  return Array.from({ length: max }, (_, i) => [baseline.state?.[i], candidate.state?.[i]]);
}
