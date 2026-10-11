/**
 * Execution Fork Runtime.
 *
 * Coordinates:
 * 1. Pre-flight fork plan creation and checkpoint validation.
 * 2. Immutable state snapshot restoration via StateRestorer.
 * 3. Deterministic mutation application via MutationApplier.
 * 4. BoundaryResolver initialization starting strictly at boundary_cursor.
 * 5. SAFE_OFFLINE Network Kill Switch enforcement.
 * 6. Resumable host execution from resume_step_index.
 * 7. Observable fork event streaming.
 * 8. Canonical child RunArtifact generation (without duplicating historical prefix).
 * 9. Lineage binding and dual persistence.
 *
 * Invariant:
 * The source/parent RunArtifact is NEVER modified.
 */

import type { RunArtifact } from "../contracts/runArtifact";
import { CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION } from "../contracts/runArtifact";
import type { CheckpointReference, ExperimentMutation } from "../contracts/lineage";
import {
  type AgentConfigurationSnapshot,
  buildAgentConfigurationSnapshot,
} from "../contracts/configuration";
import { hashPayload } from "../capture/hashing";
import { StateRestorer } from "../replay/stateRestorer";
import { BoundaryResolver } from "../replay/resolver";
import { NetworkKillSwitch } from "../replay/networkGuard";
import { saveCanonicalRun } from "../capture/persistence";
import {
  type ForkPlan,
  type ForkResult,
  type ForkEvent,
  type ForkEventType,
  type ForkStatus,
  type ForkExecutionMode,
  type ForkDependencyPolicy,
  type ForkSideEffectPolicy,
  type AppliedMutationRecord,
} from "./contracts";
import { buildForkPlan } from "./planner";
import { MutationApplier } from "./mutationApplier";
import {
  type ResumableHostAdapter,
  CustomerSupportResumableHostAdapter,
} from "./hostAdapter";
import type { ExecutionStep, StateSnapshot } from "../contracts/execution";
import type { ExecutionBoundary } from "../contracts/replay";

export interface ForkRuntimeOptions {
  forkId?: string;
  mutations?: ExperimentMutation[];
  hostAdapter?: ResumableHostAdapter;
  executeLogic?: (
    adapter: ResumableHostAdapter,
    params: {
      stepIndex: number;
      state: Record<string, unknown>;
      dependencies: any;
      toolOverrides?: Map<string, unknown>;
    }
  ) => Promise<unknown>;
  dependencyPolicy?: Partial<ForkDependencyPolicy>;
  sideEffectPolicy?: Partial<ForkSideEffectPolicy>;
  executionMode?: ForkExecutionMode;
  persist?: boolean;
}

export class ForkRuntime {
  private readonly networkGuard = new NetworkKillSwitch();

  constructor(
    private readonly sourceRun: RunArtifact,
    private readonly checkpointId: string,
    private readonly options: ForkRuntimeOptions = {}
  ) {}

  async fork(): Promise<ForkResult> {
    const startedAt = new Date().toISOString();
    const forkId =
      this.options.forkId ??
      `run_fork_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sourceRunId = this.sourceRun.identity.run_id;
    const persist = this.options.persist !== false;

    const events: ForkEvent[] = [];
    const emitEvent = (eventType: ForkEventType, data?: Record<string, unknown>) => {
      events.push({
        event_id: `fevt_${forkId}_${events.length}`,
        fork_id: forkId,
        derived_run_id: forkId,
        parent_run_id: sourceRunId,
        event_type: eventType,
        timestamp: new Date().toISOString(),
        data,
      });
    };

    emitEvent("fork.start", { sourceRunId, checkpointId: this.checkpointId });

    // 1. Build Pre-flight Fork Plan
    const plan = await buildForkPlan(
      this.sourceRun,
      this.checkpointId,
      this.options.mutations ?? [],
      {
        forkId,
        dependencyPolicy: this.options.dependencyPolicy,
        sideEffectPolicy: this.options.sideEffectPolicy,
        executionMode: this.options.executionMode,
      }
    );

    emitEvent("fork.plan.created", {
      verdict: plan.validation.verdict,
      reasons: plan.validation.reasons,
    });

    if (plan.validation.verdict === "NOT_FORKABLE") {
      const completedAt = new Date().toISOString();
      emitEvent("fork.fail", { reasons: plan.validation.reasons });

      let status: ForkStatus = "UNSUPPORTED";
      if (plan.validation.reasons.some((r) => r.startsWith("CHECKPOINT_CORRUPT") || r.startsWith("INVALID_CHECKPOINT"))) {
        status = "FAILED";
      }

      return {
        fork_id: forkId,
        derived_run_id: forkId,
        parent_run_id: sourceRunId,
        root_run_id: plan.root_run_id,
        checkpoint_id: this.checkpointId,
        status,
        restored_state_hash: "none",
        mutations_applied: [],
        steps_executed: 0,
        boundaries_recorded: 0,
        blocked_actions: 0,
        errors: plan.validation.reasons,
        created_at: startedAt,
        completed_at: completedAt,
        fork_events: events,
      };
    }

    emitEvent("fork.checkpoint.validated", { checkpointId: this.checkpointId });

    // 2. Restore State Snapshot via StateRestorer
    const restorer = new StateRestorer(this.sourceRun);
    let restoredStateResult;
    try {
      restoredStateResult = restorer.restoreCheckpoint(this.checkpointId);
    } catch (err: any) {
      const completedAt = new Date().toISOString();
      emitEvent("fork.fail", { error: err.message });
      return {
        fork_id: forkId,
        derived_run_id: forkId,
        parent_run_id: sourceRunId,
        root_run_id: plan.root_run_id,
        checkpoint_id: this.checkpointId,
        status: "FAILED",
        restored_state_hash: "failed",
        mutations_applied: [],
        steps_executed: 0,
        boundaries_recorded: 0,
        blocked_actions: 0,
        errors: [err.message],
        created_at: startedAt,
        completed_at: completedAt,
        fork_events: events,
      };
    }

    emitEvent("fork.state.restored", {
      snapshotId: restoredStateResult.snapshotId,
      stateHash: restoredStateResult.hash,
    });

    // 3. Apply Mutations via MutationApplier
    const applier = new MutationApplier();
    let appliedMutationResult;
    try {
      appliedMutationResult = applier.apply(
        restoredStateResult.state,
        this.options.mutations ?? []
      );
    } catch (err: any) {
      const completedAt = new Date().toISOString();
      emitEvent("fork.fail", { error: err.message });
      return {
        fork_id: forkId,
        derived_run_id: forkId,
        parent_run_id: sourceRunId,
        root_run_id: plan.root_run_id,
        checkpoint_id: this.checkpointId,
        status: "FAILED",
        restored_state_hash: restoredStateResult.hash,
        mutations_applied: [],
        steps_executed: 0,
        boundaries_recorded: 0,
        blocked_actions: 0,
        errors: [err.message],
        created_at: startedAt,
        completed_at: completedAt,
        fork_events: events,
      };
    }

    for (const record of appliedMutationResult.appliedRecords) {
      emitEvent("fork.mutation.applied", {
        mutationId: record.mutation_id,
        type: record.mutation_type,
        target: record.target_identifier,
        status: record.status,
      });
    }

    // 4. Initialize Boundary Resolver with startCursor
    const resolver = new BoundaryResolver(this.sourceRun, {
      strict: plan.execution_mode === "SAFE_OFFLINE_FORK",
      startCursor: plan.boundary_cursor,
    });

    // 5. Mount Resumable Host Adapter
    const hostAdapter: ResumableHostAdapter =
      this.options.hostAdapter ?? new CustomerSupportResumableHostAdapter();

    if (!hostAdapter.supportsResume(plan.resume_step_index)) {
      const completedAt = new Date().toISOString();
      const errMsg = `HOST_NOT_RESUMABLE: Host does not support resuming at step index ${plan.resume_step_index}.`;
      emitEvent("fork.fail", { error: errMsg });
      return {
        fork_id: forkId,
        derived_run_id: forkId,
        parent_run_id: sourceRunId,
        root_run_id: plan.root_run_id,
        checkpoint_id: this.checkpointId,
        status: "UNSUPPORTED",
        restored_state_hash: restoredStateResult.hash,
        mutations_applied: appliedMutationResult.appliedRecords,
        steps_executed: 0,
        boundaries_recorded: 0,
        blocked_actions: 0,
        errors: [errMsg],
        created_at: startedAt,
        completed_at: completedAt,
        fork_events: events,
      };
    }

    const fallbackCheckpoint: CheckpointReference = {
      checkpoint_id: this.checkpointId,
      step_id: plan.fork_step_id,
      position: "AFTER_STEP",
      boundary_cursor: plan.boundary_cursor,
      schema_version: "1.0.0-alpha",
      restorable: true,
      created_at: startedAt,
    };

    const checkpointRef: CheckpointReference =
      this.sourceRun.checkpoints?.find((c) => c.checkpoint_id === this.checkpointId) ??
      (this.sourceRun.lineage?.checkpoint_reference as CheckpointReference | undefined) ??
      fallbackCheckpoint;

    await hostAdapter.initializeFromCheckpoint({
      state: appliedMutationResult.mutatedState,
      checkpoint: checkpointRef,
      resumeStepIndex: plan.resume_step_index,
      boundaryCursor: plan.boundary_cursor,
    });

    // 6. Execute From Checkpoint under Network Guard
    let finalOutput: unknown;
    let status: ForkStatus = "COMPLETED";
    let blockedActions = 0;
    const errors: string[] = [];
    const childSteps: ExecutionStep[] = [];
    const childBoundaries: ExecutionBoundary[] = [];
    const childSnapshots: StateSnapshot[] = [];

    // Snapshot 0 of child run: Restored State (potentially mutated)
    const initialChildSnapshot: StateSnapshot = {
      snapshot_id: `state_${forkId}_0`,
      step_id: `step_${forkId}_start`,
      snapshot_type: "INITIAL_STATE",
      timestamp: startedAt,
      state_scope: "workflow",
      state_data: appliedMutationResult.mutatedState,
      captured: true,
      hash: hashPayload(appliedMutationResult.mutatedState),
    };
    childSnapshots.push(initialChildSnapshot);

    const dependencies = {
      callModel: async <R = unknown>(input: {
        model: string;
        provider?: string;
        prompt: string;
        tools?: unknown[];
        [key: string]: unknown;
      }): Promise<R> => {
        const provider = input.provider ?? "anthropic";
        const dependencyIdentity = `${provider}:${input.model}`;
        const boundaryInput = {
          model: input.model,
          provider,
          prompt: input.prompt,
          tools: input.tools,
        };

        const res = await resolver.resolve({
          expectedType: "model_call",
          name: `${provider}/${input.model}`,
          dependencyIdentity,
          input: boundaryInput,
        });

        emitEvent("fork.boundary.recorded", { boundaryId: res.boundary.boundary_id, name: res.boundary.name });
        childBoundaries.push(res.boundary);
        return res.output as R;
      },

      callTool: async <R = unknown>(input: {
        name: string;
        args: unknown;
        sideEffectIntent?: "substitute_recorded" | "execute_live";
      }): Promise<R> => {
        // Safe side effect policy check
        if (input.sideEffectIntent === "execute_live" || input.name === "send_refund_email") {
          blockedActions++;
          emitEvent("fork.side_effect.blocked", { toolName: input.name });
          throw new Error(`SIDE_EFFECT_BLOCKED: Tool '${input.name}' attempted live external execution.`);
        }

        const res = await resolver.resolve({
          expectedType: "tool_call",
          name: input.name,
          dependencyIdentity: `tool:${input.name}`,
          input: input.args,
          sideEffectIntent: input.sideEffectIntent ?? "substitute_recorded",
        });

        emitEvent("fork.boundary.recorded", { boundaryId: res.boundary.boundary_id, name: res.boundary.name });
        childBoundaries.push(res.boundary);
        return res.output as R;
      },

      callRetrieval: async <R = unknown>(input: {
        service: string;
        query: string;
        [key: string]: unknown;
      }): Promise<R> => {
        const res = await resolver.resolve({
          expectedType: "retrieval_call",
          name: `${input.service}:search`,
          dependencyIdentity: `retrieval:${input.service}`,
          input: { query: input.query },
        });

        emitEvent("fork.boundary.recorded", { boundaryId: res.boundary.boundary_id, name: res.boundary.name });
        childBoundaries.push(res.boundary);
        const outputAny = res.output as { results?: R } | R;
        if (outputAny && typeof outputAny === "object" && "results" in outputAny) {
          return outputAny.results as R;
        }
        return res.output as R;
      },
    };

    try {
      if (plan.execution_mode === "SAFE_OFFLINE_FORK") {
        this.networkGuard.activate();
      }

      emitEvent("fork.step.start", { stepIndex: plan.resume_step_index });

      if (this.options.executeLogic) {
        finalOutput = await this.options.executeLogic(hostAdapter, {
          stepIndex: plan.resume_step_index,
          state: appliedMutationResult.mutatedState,
          dependencies,
          toolOverrides: appliedMutationResult.toolOverrides,
        });
      } else {
        finalOutput = await hostAdapter.executeFrom({
          stepIndex: plan.resume_step_index,
          state: appliedMutationResult.mutatedState,
          dependencies,
          toolOverrides: appliedMutationResult.toolOverrides,
          modelOverrides: appliedMutationResult.modelOverrides,
          promptOverrides: appliedMutationResult.promptOverrides,
        });
      }

      // Record child suffix step
      const finalState = hostAdapter.getState();
      const finalStateSnapshot: StateSnapshot = {
        snapshot_id: `state_${forkId}_final`,
        step_id: `step_${forkId}_completed`,
        snapshot_type: "FINAL_STATE",
        timestamp: new Date().toISOString(),
        state_scope: "workflow",
        state_data: finalState,
        captured: true,
        hash: hashPayload(finalState),
      };
      childSnapshots.push(finalStateSnapshot);

      childSteps.push({
        step_id: `step_${forkId}_0`,
        step_index: 0,
        step_type: "node",
        name: "resumed_fork_suffix",
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        status: "completed",
        state_snapshot_id: finalStateSnapshot.snapshot_id,
        boundary_ids: childBoundaries.map((b) => b.boundary_id),
        tool_invocation_ids: [],
        model_invocation_ids: [],
        memory_operation_ids: [],
        retrieval_operation_ids: [],
        eval_result_ids: [],
        artifact_ids: [],
        output_summary: typeof finalOutput === "string" ? finalOutput : JSON.stringify(finalOutput),
      });

      emitEvent("fork.complete", { finalOutput });
    } catch (err: any) {
      if (err.message?.includes("SIDE_EFFECT_BLOCKED")) {
        status = "BLOCKED";
      } else {
        status = "FAILED";
      }
      errors.push(err.message);
      emitEvent("fork.fail", { error: err.message, status });
    } finally {
      this.networkGuard.deactivate();
    }

    const completedAt = new Date().toISOString();

    // 7. Inherit Configuration Snapshot & Apply Mutations
    let childConfigSnapshot: AgentConfigurationSnapshot | undefined;
    if (this.sourceRun.configuration_snapshot) {
      const parentConfig = structuredClone(this.sourceRun.configuration_snapshot);
      const childPrompts = [...(parentConfig.prompts ?? [])];
      const childSkills = [...(parentConfig.skills ?? [])];
      const childTools = [...(parentConfig.tools ?? [])];
      let childModel = { ...parentConfig.model };
      const childAgent = { ...parentConfig.agent };
      const childPermissions = { ...parentConfig.permissions };

      for (const mut of plan.mutations) {
        if (mut.mutation_type === "prompt") {
          const idx = childPrompts.findIndex(
            (p) => p.id === mut.target_identifier || p.name === mut.target_identifier
          );
          const mutVal = mut.mutated_value as Record<string, unknown> | string | undefined;
          const version =
            typeof mutVal === "object" && mutVal && "version" in mutVal
              ? String(mutVal.version)
              : typeof mutVal === "string"
                ? mutVal
                : "mutated";
          const contentHash =
            typeof mutVal === "object" && mutVal && "content_hash" in mutVal
              ? String(mutVal.content_hash)
              : undefined;

          if (idx >= 0) {
            childPrompts[idx] = {
              ...childPrompts[idx]!,
              version,
              content_hash: contentHash ?? childPrompts[idx]!.content_hash,
            };
          } else {
            childPrompts.push({
              id: mut.target_identifier,
              version,
              content_hash: contentHash,
            });
          }
        } else if (mut.mutation_type === "model_parameters") {
          if (typeof mut.mutated_value === "object" && mut.mutated_value !== null) {
            childModel = {
              ...childModel,
              parameters: {
                ...childModel.parameters,
                ...(mut.mutated_value as Record<string, unknown>),
              },
            };
          }
        } else if (mut.mutation_type === "model") {
          if (typeof mut.mutated_value === "string") {
            childModel = {
              ...childModel,
              model_id: mut.mutated_value,
            };
          }
        } else if (mut.mutation_type === "tool_exposure") {
          const idx = childTools.findIndex((t) => t.id === mut.target_identifier);
          const mutVal = mut.mutated_value as Record<string, unknown> | string | undefined;
          const version =
            typeof mutVal === "object" && mutVal && "version" in mutVal
              ? String(mutVal.version)
              : typeof mutVal === "string"
                ? mutVal
                : "mutated";
          if (idx >= 0) {
            childTools[idx] = {
              ...childTools[idx]!,
              version,
            };
          } else {
            childTools.push({
              id: mut.target_identifier,
              version,
            });
          }
        } else if (mut.mutation_type === "agent_configuration") {
          const mutVal = mut.mutated_value as Record<string, unknown> | undefined;
          if (typeof mutVal === "object" && mutVal !== null) {
            if ("skill_id" in mutVal && "version" in mutVal) {
              const skillId = String(mutVal.skill_id);
              const sIdx = childSkills.findIndex((s) => s.id === skillId);
              if (sIdx >= 0) {
                childSkills[sIdx] = {
                  ...childSkills[sIdx]!,
                  version: String(mutVal.version),
                };
              } else {
                childSkills.push({
                  id: skillId,
                  version: String(mutVal.version),
                });
              }
            }
          }
        }
      }

      childConfigSnapshot = buildAgentConfigurationSnapshot({
        snapshot_id: `cfg_${forkId}_inherited`,
        run_id: forkId,
        captured_at: startedAt,
        declaration_type: "EFFECTIVE",
        agent: childAgent,
        model: childModel,
        prompts: childPrompts,
        skills: childSkills,
        tools: childTools,
        permissions: childPermissions,
        workflow: parentConfig.workflow,
        runtime: parentConfig.runtime,
      });
    }

    // 8. Assemble Canonical Child RunArtifact
    const childArtifact: RunArtifact = {
      schema_version: CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION,
      identity: {
        run_id: forkId,
        project_id: this.sourceRun.identity.project_id,
        project_name: this.sourceRun.identity.project_name,
        workflow_id: this.sourceRun.identity.workflow_id,
        created_at: startedAt,
      },
      execution: {
        status: status === "COMPLETED" ? "completed" : "failed",
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
        summary: `Forked from run ${sourceRunId} at checkpoint ${this.checkpointId}`,
      },
      environment: this.sourceRun.environment,
      trajectory: childSteps,
      boundaries: childBoundaries,
      external_calls: [],
      state: childSnapshots,
      checkpoints: [],
      context: [],
      memory: { operations: [], references: [] },
      tools: [],
      retrieval: [],
      models: [],
      artifacts: [],
      evals: [],
      lineage: {
        parent_run_id: sourceRunId,
        root_run_id: plan.root_run_id,
        fork_checkpoint_id: this.checkpointId,
        fork_step_id: plan.fork_step_id,
        baseline_run_id: plan.root_run_id,
        checkpoint_reference: checkpointRef,
        mutations: plan.mutations,
      },
      provenance: {
        capture_method: "sdk_trace",
        adapter_version: "1.0.0-fork",
        captured_by: "AgentPulseForkRuntime",
        redaction_verified: true,
      },
      safety: this.sourceRun.safety,
      observability: {
        total_duration_ms: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
        model_calls_count: childBoundaries.filter((b) => b.boundary_type === "model_call").length,
        tool_calls_count: childBoundaries.filter((b) => b.boundary_type === "tool_call").length,
        evals_passed: 0,
        evals_failed: 0,
        trace_event_count: childSteps.length,
        context_snapshot_count: 0,
        memory_operations_count: 0,
        retrieval_operations_count: 0,
      },
      replay: {
        overall_replayability: "REPLAYABLE_RECORDED",
        unsupported_boundaries_count: 0,
        side_effect_gated_count: blockedActions,
        deterministic: true,
        sandboxed_available: true,
        missing_recordings: [],
        notes: [`Derived fork run with ${appliedMutationResult?.appliedRecords.length ?? 0} mutations applied.`],
      },
      configuration_snapshot: childConfigSnapshot,
      evidence: {
        verification_events: [],
        test_results: [],
        review_results: [],
        approval_events: [],
        security_events: [],
        final_outcome: {
          status: status === "COMPLETED" ? "SUCCESS" : "FAILURE",
          verification_status: "NOT_RUN",
          completed_at: completedAt,
        },
      },
    };

    if (persist && status === "COMPLETED") {
      await saveCanonicalRun(childArtifact);
    }

    return {
      fork_id: forkId,
      derived_run_id: forkId,
      parent_run_id: sourceRunId,
      root_run_id: plan.root_run_id,
      checkpoint_id: this.checkpointId,
      status,
      restored_state_hash: restoredStateResult.hash,
      mutations_applied: appliedMutationResult?.appliedRecords ?? [],
      steps_executed: childSteps.length,
      boundaries_recorded: childBoundaries.length,
      blocked_actions: blockedActions,
      final_output: finalOutput,
      child_artifact: childArtifact,
      errors,
      created_at: startedAt,
      completed_at: completedAt,
      fork_events: events,
    };
  }
}
