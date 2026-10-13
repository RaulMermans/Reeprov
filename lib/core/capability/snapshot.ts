/**
 * Capability Snapshot Derivation Engine.
 *
 * Derives evidence-based CapabilitySnapshots from named EvaluationRuns:
 * - Maps eval families to standard CapabilityDimensionTypes.
 * - Computes multi-dimensional pass rates and scores without collapsing
 *   into an arbitrary single "agent IQ" score.
 */

import {
  type CapabilitySnapshot,
  type CapabilityDimensionScore,
  type CapabilityDimensionType,
  capabilitySnapshotSchema,
} from "../contracts/capability";
import type { EvaluationRun } from "../contracts/evalDefinitions";
import type { EvalResult } from "../contracts/evals";
import type { RunArtifact } from "../contracts/runArtifact";
import { saveCapabilitySnapshot } from "./persistence";

const FAMILY_TO_DIMENSION: Record<string, CapabilityDimensionType> = {
  task_completion: "TASK_SUCCESS",
  behavioral: "TASK_SUCCESS",
  tool_use: "TOOL_USE",
  tool_selection: "TOOL_USE",
  tool_argument_quality: "TOOL_USE",
  retrieval: "RETRIEVAL",
  groundedness: "RETRIEVAL",
  citation_precision: "RETRIEVAL",
  context: "CONTEXT",
  context_relevance: "CONTEXT",
  context_faithfulness: "CONTEXT",
  memory: "MEMORY",
  state_consistency: "MEMORY",
  cross_step_coherence: "MEMORY",
  safety: "SAFETY",
  approval_compliance: "APPROVAL_COMPLIANCE",
  cost: "COST_EFFICIENCY",
  cost_threshold: "COST_EFFICIENCY",
  latency: "LATENCY",
  latency_budget: "LATENCY",
  trajectory: "TRAJECTORY",
  trajectory_efficiency: "TRAJECTORY",
};

export interface CreateCapabilitySnapshotOptions {
  snapshotId?: string;
  projectId: string;
  agentId: string;
  agentVersion: string;
  configurationHash: string;
  evalRuns: EvaluationRun[];
  suiteId: string;
  suiteVersion: number;
  datasetId?: string;
  datasetVersion?: number;
  runArtifact?: RunArtifact;
  metadata?: Record<string, unknown>;
  persist?: boolean;
}

export class CapabilitySnapshotEngine {
  /**
   * Derives a CapabilitySnapshot from one or more EvaluationRuns.
   */
  static async createSnapshot(
    options: CreateCapabilitySnapshotOptions
  ): Promise<CapabilitySnapshot> {
    const snapshotId =
      options.snapshotId ??
      `capsnap_${options.agentId}_${options.agentVersion}_${Date.now()}`;

    // Collect all eval results across runs
    const allResults: EvalResult[] = options.evalRuns.flatMap((r) => r.results);

    // Group by capability dimension
    const dimensionBuckets = new Map<CapabilityDimensionType, EvalResult[]>();

    for (const res of allResults) {
      const rawFamily = (res.eval_type ?? (res as any).eval_family ?? "task_completion") as string | undefined;
      const family = typeof rawFamily === "string" && rawFamily.length > 0 ? rawFamily : "task_completion";
      const dim: CapabilityDimensionType =
        FAMILY_TO_DIMENSION[family] ??
        (family.toLowerCase().includes("tool")
          ? "TOOL_USE"
          : family.toLowerCase().includes("safety")
            ? "SAFETY"
            : family.toLowerCase().includes("approval")
              ? "APPROVAL_COMPLIANCE"
              : family.toLowerCase().includes("cost")
                ? "COST_EFFICIENCY"
                : family.toLowerCase().includes("latency")
                  ? "LATENCY"
                  : family.toLowerCase().includes("retriev")
                    ? "RETRIEVAL"
                    : family.toLowerCase().includes("context")
                      ? "CONTEXT"
                      : family.toLowerCase().includes("memory")
                        ? "MEMORY"
                        : "TASK_SUCCESS");

      const list = dimensionBuckets.get(dim) ?? [];
      list.push(res);
      dimensionBuckets.set(dim, list);
    }

    // Default required dimensions to track
    const standardDimensions: CapabilityDimensionType[] = [
      "TASK_SUCCESS",
      "SAFETY",
      "APPROVAL_COMPLIANCE",
      "TOOL_USE",
      "COST_EFFICIENCY",
      "LATENCY",
    ];

    const dimensions: CapabilityDimensionScore[] = [];

    for (const dim of standardDimensions) {
      const results = dimensionBuckets.get(dim) ?? [];
      if (results.length === 0) {
        // Observability fallback if RunArtifact metrics exist
        let defaultScore = 1.0;
        let defaultPassRate = 1.0;

        if (dim === "COST_EFFICIENCY" && options.runArtifact) {
          const cost = options.runArtifact.observability.total_cost_usd ?? 0;
          defaultScore = cost < 0.5 ? 1.0 : Math.max(0, 1 - cost / 2);
          defaultPassRate = cost < 1.0 ? 1.0 : 0.0;
        } else if (dim === "LATENCY" && options.runArtifact) {
          const lat = options.runArtifact.observability.total_duration_ms ?? 0;
          defaultScore = lat < 5000 ? 1.0 : Math.max(0, 1 - lat / 30000);
          defaultPassRate = lat < 10000 ? 1.0 : 0.0;
        }

        dimensions.push({
          dimension: dim,
          score: defaultScore,
          pass_rate: defaultPassRate,
          case_count: options.runArtifact ? 1 : 0,
          trial_count: options.evalRuns.length,
          eval_definition_ids: [],
          evidence_quality: results.length > 0 ? "HIGH" : "MEDIUM",
        });
        continue;
      }

      const passed = results.filter((r) => r.passed && r.grader_status !== "EVALUATOR_ERROR" && r.grader_status !== "MISSING_EVIDENCE").length;
      const passRate = results.length > 0 ? passed / results.length : 0;
      const scores = results.map((r) => (typeof r.score === "number" ? r.score : r.passed ? 1 : 0));
      const meanScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

      const caseIds = new Set(results.map((r) => r.eval_case_id).filter(Boolean));
      const defIds = Array.from(new Set(results.map((r) => r.eval_definition_id).filter(Boolean) as string[]));

      dimensions.push({
        dimension: dim,
        score: meanScore,
        pass_rate: passRate,
        case_count: Math.max(1, caseIds.size),
        trial_count: options.evalRuns.length,
        eval_definition_ids: defIds,
        evidence_quality: "HIGH",
      });
    }

    const safetyDim = dimensions.find((d) => d.dimension === "SAFETY");
    const overallStatus =
      safetyDim && safetyDim.pass_rate < 1.0 ? "DEGRADED" : "ACCEPTABLE";

    const snapshot: CapabilitySnapshot = capabilitySnapshotSchema.parse({
      capability_snapshot_id: snapshotId,
      project_id: options.projectId,
      agent_id: options.agentId,
      agent_version: options.agentVersion,
      configuration_hash: options.configurationHash,
      evaluation_run_ids: options.evalRuns.map((r) => r.evaluation_run_id),
      suite_id: options.suiteId,
      suite_version: options.suiteVersion,
      dataset_id: options.datasetId,
      dataset_version: options.datasetVersion,
      captured_at: new Date().toISOString(),
      dimensions,
      overall_status: overallStatus,
      evidence_quality: "HIGH",
      metadata: options.metadata ?? {},
    });

    if (options.persist !== false) {
      await saveCapabilitySnapshot(snapshot);
    }

    return snapshot;
  }
}
