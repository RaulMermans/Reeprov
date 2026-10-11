/**
 * Fork Planner — Pre-flight execution analysis and validation.
 *
 * Verifies checkpoint integrity, mutation compatibility, dependency policies,
 * and host resume requirements before fork execution commences.
 */

import type { RunArtifact } from "../contracts/runArtifact";
import type { ExperimentMutation } from "../contracts/lineage";
import { runArtifactSchema } from "../contracts/runArtifact";
import {
  type ForkPlan,
  type ForkDependencyPolicy,
  type ForkSideEffectPolicy,
  type ForkExecutionMode,
  type ForkableVerdict,
  forkDependencyPolicySchema,
  forkSideEffectPolicySchema,
} from "./contracts";
import { validateCheckpoint, validateMutation } from "./validation";

export interface BuildForkPlanOptions {
  forkId?: string;
  dependencyPolicy?: Partial<ForkDependencyPolicy>;
  sideEffectPolicy?: Partial<ForkSideEffectPolicy>;
  executionMode?: ForkExecutionMode;
  hostRequirements?: Record<string, unknown>;
}

export async function buildForkPlan(
  sourceRun: RunArtifact,
  checkpointId: string,
  mutations: ExperimentMutation[] = [],
  options: BuildForkPlanOptions = {}
): Promise<ForkPlan> {
  const reasons: string[] = [];
  const forkId =
    options.forkId ??
    `fork_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // 1. Validate source artifact schema
  const schemaResult = runArtifactSchema.safeParse(sourceRun);
  if (!schemaResult.success) {
    reasons.push(
      `SCHEMA_UNSUPPORTED: Source artifact schema validation failed: ${schemaResult.error.message}`
    );
  }

  // 2. Validate Checkpoint
  const checkpointValidation = validateCheckpoint(sourceRun, checkpointId);
  if (!checkpointValidation.valid) {
    for (const err of checkpointValidation.errors) {
      reasons.push(`${err.code}: ${err.message}`);
    }
  }

  const checkpoint = checkpointValidation.checkpoint;
  const forkStepId = checkpoint?.step_id ?? "unknown_step";
  const resumeStepIndex = checkpoint?.resume_step_index ?? 0;
  const boundaryCursor = checkpoint?.boundary_cursor ?? 0;

  // 3. Validate Mutations
  for (const mut of mutations) {
    const mutResult = validateMutation(mut);
    if (!mutResult.valid && mutResult.error) {
      reasons.push(mutResult.error);
    }
  }

  // 4. Resolve Policies
  const dependencyPolicy: ForkDependencyPolicy = forkDependencyPolicySchema.parse(
    options.dependencyPolicy ?? {}
  );
  const sideEffectPolicy: ForkSideEffectPolicy = forkSideEffectPolicySchema.parse(
    options.sideEffectPolicy ?? {}
  );

  // 5. Side-Effect Safety Checks
  if (sideEffectPolicy.allow_live_side_effects) {
    reasons.push(
      "SIDE_EFFECT_BLOCKED: Live external side-effects are denied by default under safe execution policy."
    );
  }
  if (sideEffectPolicy.destructive_allowed) {
    reasons.push(
      "SIDE_EFFECT_BLOCKED: Destructive operations are strictly denied during fork execution."
    );
  }

  // 6. Verdict Determination
  let verdict: ForkableVerdict = "FORKABLE";
  if (reasons.length > 0) {
    verdict = "NOT_FORKABLE";
  }

  const plan: ForkPlan = {
    fork_id: forkId,
    parent_run_id: sourceRun.identity.run_id,
    root_run_id: sourceRun.lineage?.root_run_id ?? sourceRun.identity.run_id,
    checkpoint_id: checkpointId,
    fork_step_id: forkStepId,
    resume_step_index: resumeStepIndex,
    boundary_cursor: boundaryCursor,
    mutations,
    dependency_policy: dependencyPolicy,
    side_effect_policy: sideEffectPolicy,
    execution_mode: options.executionMode ?? "SAFE_OFFLINE_FORK",
    host_requirements: options.hostRequirements ?? {},
    validation: {
      verdict,
      reasons,
    },
    created_at: new Date().toISOString(),
  };

  return plan;
}
