/**
 * Regression Baseline Management & Immutability Engine.
 *
 * Enforces explicit, auditable baseline selection and strict immutability:
 * - Never implicitly treat "latest run" as baseline.
 * - Once approved, baseline evidence is immutable.
 * - Superseding produces baseline_v2, never mutating baseline_v1.
 * - Supports bridge re-evaluation: historical baseline + new EvalSuite/Dataset
 *   produces a new EvaluationRun without mutating historical records.
 */

import {
  type RegressionBaseline,
  regressionBaselineSchema,
  computeBaselineEvidenceHash,
} from "../contracts/regression";
import { type RunArtifact } from "../contracts/runArtifact";
import { type EvalSuite, type EvalDataset, type EvaluationRun } from "../contracts/evalDefinitions";
import { evaluateRun, evaluateDataset } from "../evals/runner";
import { getCanonicalRun } from "../capture/persistence";
import { saveRegressionBaseline, getRegressionBaseline } from "./persistence";

export interface CreateBaselineOptions {
  baselineId?: string;
  projectId: string;
  agentId?: string;
  runId?: string;
  configurationHash: string;
  evalSuiteId: string;
  evalSuiteVersion: number;
  datasetId?: string;
  datasetVersion?: number;
  approvedBy?: string;
  label?: string;
  releaseVersion?: string;
  metadata?: Record<string, unknown>;
  persist?: boolean;
}

export class BaselineManager {
  /**
   * Creates and approves an explicit, immutable RegressionBaseline.
   */
  static async createBaseline(options: CreateBaselineOptions): Promise<RegressionBaseline> {
    const approvedAt = new Date().toISOString();
    const baselineId =
      options.baselineId ??
      `base_${options.projectId}_${options.agentId ?? "agent"}_${Date.now()}`;

    const partialBaseline = {
      baseline_id: baselineId,
      project_id: options.projectId,
      agent_id: options.agentId,
      run_id: options.runId,
      configuration_hash: options.configurationHash,
      eval_suite_id: options.evalSuiteId,
      eval_suite_version: options.evalSuiteVersion,
      dataset_id: options.datasetId,
      dataset_version: options.datasetVersion,
      approved_at: approvedAt,
      approved_by: options.approvedBy,
      label: options.label,
      release_version: options.releaseVersion,
      metadata: options.metadata ?? {},
    };

    const evidenceHash = computeBaselineEvidenceHash(partialBaseline);

    const baseline: RegressionBaseline = regressionBaselineSchema.parse({
      ...partialBaseline,
      evidence_hash: evidenceHash,
      status: "ACTIVE",
    });

    if (options.persist !== false) {
      await saveRegressionBaseline(baseline);
    }

    return baseline;
  }

  /**
   * Supersedes an existing baseline by creating a new version.
   * Invariant: Does not delete or mutate historical baseline decisions.
   */
  static async supersedeBaseline(
    previousBaselineId: string,
    newBaselineOptions: Omit<CreateBaselineOptions, "baselineId">,
    reason?: string
  ): Promise<{ previous: RegressionBaseline; next: RegressionBaseline }> {
    const existing = await getRegressionBaseline(previousBaselineId);
    if (!existing) {
      throw new Error(`Baseline "${previousBaselineId}" not found; cannot supersede.`);
    }

    // Mark previous as SUPERSEDED
    const updatedPrevious: RegressionBaseline = {
      ...existing,
      status: "SUPERSEDED",
      metadata: {
        ...existing.metadata,
        superseded_at: new Date().toISOString(),
        superseded_reason: reason ?? "New baseline approved",
      },
    };
    await saveRegressionBaseline(updatedPrevious);

    // Create next baseline version
    const versionMatch = previousBaselineId.match(/_v(\d+)$/);
    const nextVersion = versionMatch ? parseInt(versionMatch[1]!, 10) + 1 : 2;
    const nextId = versionMatch
      ? previousBaselineId.replace(/_v\d+$/, `_v${nextVersion}`)
      : `${previousBaselineId}_v${nextVersion}`;

    const nextBaseline = await this.createBaseline({
      ...newBaselineOptions,
      baselineId: nextId,
    });

    return { previous: updatedPrevious, next: nextBaseline };
  }

  /**
   * Revokes an existing baseline with auditable rationale.
   */
  static async revokeBaseline(
    baselineId: string,
    revokedBy: string,
    reason: string
  ): Promise<RegressionBaseline> {
    const existing = await getRegressionBaseline(baselineId);
    if (!existing) {
      throw new Error(`Baseline "${baselineId}" not found; cannot revoke.`);
    }

    const revoked: RegressionBaseline = {
      ...existing,
      status: "REVOKED",
      metadata: {
        ...existing.metadata,
        revoked_at: new Date().toISOString(),
        revoked_by: revokedBy,
        revoke_reason: reason,
      },
    };

    await saveRegressionBaseline(revoked);
    return revoked;
  }

  /**
   * Controlled Bridge Workflow:
   * Historical baseline run + new EvalSuite/Dataset -> re-evaluation.
   *
   * Enables valid longitudinal comparisons under current evaluation semantics
   * without rewriting original historical evals.
   */
  static async bridgeReevaluateBaseline(
    baseline: RegressionBaseline,
    newSuite: EvalSuite,
    newDataset?: EvalDataset,
    options: {
      runnerFn?: (caseItem: any) => Promise<RunArtifact>;
      judgeHandler?: any;
      persist?: boolean;
    } = {}
  ): Promise<EvaluationRun> {
    if (!baseline.run_id) {
      throw new Error(`Baseline "${baseline.baseline_id}" has no run_id; cannot bridge re-evaluate.`);
    }

    const baselineArtifact = await getCanonicalRun(baseline.run_id);
    if (!baselineArtifact) {
      throw new Error(`Historical run artifact "${baseline.run_id}" for baseline not found.`);
    }

    const bridgeRunId = `evrun_bridge_${baseline.baseline_id}_${newSuite.suite_id}@${newSuite.version}_${Date.now()}`;

    if (newDataset && options.runnerFn) {
      return await evaluateDataset(newDataset, newSuite, options.runnerFn, {
        evaluationRunId: bridgeRunId,
        persist: options.persist !== false,
        judgeHandler: options.judgeHandler,
      });
    }

    return await evaluateRun(baselineArtifact, newSuite, {
      evaluationRunId: bridgeRunId,
      datasetId: newDataset?.dataset_id,
      datasetVersion: newDataset?.version,
      enrichArtifact: false, // Never mutate historical baseline run artifact
      persist: options.persist !== false,
      judgeHandler: options.judgeHandler,
    });
  }
}
