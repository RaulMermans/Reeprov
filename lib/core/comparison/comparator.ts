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
  const maxStates = Math.max(baseline.state?.length ?? 0, candidate.state?.length ?? 0);
  for (let i = 0; i < maxStates; i++) {
    const bState = baseline.state?.[i];
    const cState = candidate.state?.[i];
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

  // 7. Tools & Models Diffs
  const toolChanges = diffToolInvocations(
    baseline.tools,
    candidate.tools,
    baseline.boundaries,
    candidate.boundaries
  );
  const modelChanges = diffModelInvocations(
    baseline.models,
    candidate.models,
    baseline.boundaries,
    candidate.boundaries
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
