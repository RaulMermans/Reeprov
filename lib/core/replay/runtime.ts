/**
 * Deterministic Offline Replay Runtime.
 *
 * Coordinates:
 * - Pre-execution ReplayPlan generation.
 * - STRICT_OFFLINE Network Kill Switch.
 * - Point-in-time state mounting via StateRestorer.
 * - Authoritative boundary substitution via BoundaryResolver.
 * - Strict divergence detection.
 * - Observable replay event streaming.
 * - ReplayResult generation and persistence.
 *
 * Invariant: Source RunArtifact is NEVER mutated. Replay has its own identity.
 */

import type { RunArtifact } from "../contracts/runArtifact";
import { hashPayload } from "../capture/hashing";
import {
  type ReplayResult,
  type ReplayPlan,
  type ReplayEvent,
  type ReplayMode,
  type ReplayStatus,
  type ReplayEventType,
} from "./contracts";
import { buildReplayPlan } from "./planner";
import { StateRestorer } from "./stateRestorer";
import { BoundaryResolver, BoundaryResolutionError } from "./resolver";
import { DivergenceDetector } from "./divergenceDetector";
import { NetworkKillSwitch, NetworkAccessDeniedError } from "./networkGuard";
import { ReferenceReplayHostAdapter, type ReplayHostAdapter } from "./hostAdapter";
import { saveReplayResult } from "./persistence";

export interface ReplayRuntimeOptions {
  mode?: ReplayMode;
  replayId?: string;
  verifyBlobs?: boolean;
  adapter?: ReplayHostAdapter;
  persist?: boolean;
}

export class ReplayRuntime {
  private readonly networkGuard = new NetworkKillSwitch();
  private readonly defaultSource?: RunArtifact;
  private readonly defaultOptions: ReplayRuntimeOptions;

  constructor(source?: RunArtifact, options: ReplayRuntimeOptions = {}) {
    this.defaultSource = source;
    this.defaultOptions = options;
  }

  /**
   * Executes a deterministic offline replay for a supported application execution path.
   */
  async replay<TOutput = unknown>(
    sourceOrLogic?: RunArtifact | ((adapter: ReplayHostAdapter) => Promise<TOutput>),
    executeLogicOrOptions?: ((adapter: ReplayHostAdapter) => Promise<TOutput>) | ReplayRuntimeOptions,
    options?: ReplayRuntimeOptions
  ): Promise<ReplayResult> {
    let source: RunArtifact;
    let executeLogic: ((adapter: ReplayHostAdapter) => Promise<TOutput>) | undefined;
    let runtimeOptions: ReplayRuntimeOptions;

    if (sourceOrLogic && typeof sourceOrLogic === "object" && "identity" in sourceOrLogic) {
      source = sourceOrLogic as RunArtifact;
      if (typeof executeLogicOrOptions === "function") {
        executeLogic = executeLogicOrOptions;
        runtimeOptions = options ?? this.defaultOptions;
      } else {
        executeLogic = undefined;
        runtimeOptions = (executeLogicOrOptions as ReplayRuntimeOptions) ?? options ?? this.defaultOptions;
      }
    } else if (typeof sourceOrLogic === "function") {
      if (!this.defaultSource) {
        throw new Error("No RunArtifact provided to ReplayRuntime constructor or replay() method.");
      }
      source = this.defaultSource;
      executeLogic = sourceOrLogic;
      runtimeOptions = (executeLogicOrOptions as ReplayRuntimeOptions) ?? options ?? this.defaultOptions;
    } else {
      if (!this.defaultSource) {
        throw new Error("No RunArtifact provided to ReplayRuntime constructor or replay() method.");
      }
      source = this.defaultSource;
      executeLogic = typeof executeLogicOrOptions === "function" ? executeLogicOrOptions : undefined;
      runtimeOptions = (typeof executeLogicOrOptions === "object" ? executeLogicOrOptions : options) ?? this.defaultOptions;
    }

    const startedAt = new Date().toISOString();
    const mode: ReplayMode = runtimeOptions.mode ?? "STRICT_OFFLINE";
    const replayId =
      runtimeOptions.replayId ??
      `replay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sourceRunId = source.identity.run_id;
    const persist = runtimeOptions.persist !== false;

    const events: ReplayEvent[] = [];
    const emitEvent = (
      eventType: ReplayEventType,
      data?: Record<string, unknown>,
      stepId?: string,
      boundaryId?: string
    ) => {
      events.push({
        event_id: `revt_${replayId}_${events.length}`,
        replay_id: replayId,
        source_run_id: sourceRunId,
        event_type: eventType,
        timestamp: new Date().toISOString(),
        step_id: stepId,
        boundary_id: boundaryId,
        data,
      });
    };

    emitEvent("replay.start", { mode, sourceRunId });

    // 1. Build ReplayPlan
    const plan = await buildReplayPlan(source, {
      mode,
      replayId,
      verifyBlobs: runtimeOptions.verifyBlobs,
    });
    emitEvent("replay.plan.created", {
      verdict: plan.replayability_verdict,
      unsupported: plan.unsupported_features,
      missing: plan.missing_evidence,
    });

    if (mode === "STRICT_OFFLINE" && plan.replayability_verdict !== "REPLAYABLE") {
      const completedAt = new Date().toISOString();
      emitEvent("replay.fail", { reason: `Plan marked ${plan.replayability_verdict}` });

      const detector = new DivergenceDetector(replayId, sourceRunId);
      for (const missing of plan.missing_evidence) {
        detector.recordDivergence({
          type: "MISSING_PAYLOAD",
          message: missing,
          severity: "critical",
        });
      }
      for (const unsup of plan.unsupported_features) {
        detector.recordDivergence({
          type: "UNSUPPORTED_BOUNDARY",
          message: unsup,
          severity: "critical",
        });
      }

      const result: ReplayResult = {
        replay_id: replayId,
        source_run_id: sourceRunId,
        replay_of: sourceRunId,
        status: "UNSUPPORTED",
        mode,
        started_at: startedAt,
        completed_at: completedAt,
        steps_expected: plan.expected_steps.length,
        steps_executed: 0,
        boundaries_expected: plan.expected_boundaries.length,
        boundaries_substituted: 0,
        live_calls_attempted: 0,
        live_calls_blocked: 0,
        divergences: detector.getDivergences(),
        deterministic_match: false,
        limitations: [...plan.unsupported_features, ...plan.missing_evidence],
        replay_events: events,
      };

      if (persist) await saveReplayResult(result, plan);
      return result;
    }

    // 2. Initialize Restorer, Resolver, DivergenceDetector
    const restorer = new StateRestorer(source);
    const restoredState = restorer.restoreInitialState();
    emitEvent("replay.state.restored", {
      snapshotId: restoredState.snapshotId,
      hash: restoredState.hash,
    });

    const resolver = new BoundaryResolver(source, {
      strict: mode === "STRICT_OFFLINE",
      requireExactInputVerification: mode === "STRICT_OFFLINE",
    });
    const divergenceDetector = new DivergenceDetector(replayId, sourceRunId);

    // 3. Mount Adapter
    const adapter =
      runtimeOptions.adapter ??
      new ReferenceReplayHostAdapter({
        resolver,
        divergenceDetector,
        onBoundarySubstituted: (sub) => {
          emitEvent(
            "replay.boundary.substituted",
            {
              boundaryId: sub.boundary.boundary_id,
              name: sub.boundary.name,
              type: sub.boundary.boundary_type,
            },
            sub.boundary.step_id,
            sub.boundary.boundary_id
          );
          if (sub.sideEffectSubstituted) {
            emitEvent("replay.side_effect_substituted", {
              boundaryId: sub.boundary.boundary_id,
              name: sub.boundary.name,
            });
          }
        },
      });

    let status: ReplayStatus = "MATCHED";
    let finalOutput: unknown;
    let liveCallsAttempted = 0;
    let liveCallsBlocked = 0;
    let lastSuccessfulStepId: string | undefined;
    let lastSubstitutedBoundaryId: string | undefined;

    // 4. Execute Logic within Network Guard
    try {
      if (mode === "STRICT_OFFLINE") {
        this.networkGuard.activate();
      }

      await adapter.initialize(restoredState.state);

      const effectiveExecuteLogic = executeLogic ?? (async (hostAdapter: ReplayHostAdapter) => {
        const deps = hostAdapter.getDependencies();
        let lastOutput: unknown = undefined;
        for (const step of source.trajectory) {
          await hostAdapter.onStepStart(step.step_index, step.name);
          const stepBoundaries = source.boundaries.filter((b) => b.step_id === step.step_id);
          for (const b of stepBoundaries) {
            if (b.boundary_type === "model_call") {
              const inputContent = (b.input?.content as Record<string, unknown>) ?? {};
              lastOutput = await deps.callModel({
                model: (inputContent["model"] as string) ?? b.dependency_identity?.split(":")[1] ?? "claude-3-5-sonnet",
                provider: (inputContent["provider"] as string) ?? b.dependency_identity?.split(":")[0] ?? "anthropic",
                prompt: (inputContent["prompt"] as string) ?? b.input?.summary ?? "",
                tools: inputContent["tools"] as unknown[],
              });
            } else if (b.boundary_type === "tool_call") {
              lastOutput = await deps.callTool({
                name: b.name,
                args: b.input?.content ?? {},
              });
            } else if (b.boundary_type === "retrieval_call" || b.boundary_type === "retrieval_service") {
              const inputContent = (b.input?.content as Record<string, unknown>) ?? {};
              lastOutput = await deps.callRetrieval({
                service: b.dependency_identity?.replace(/^retrieval:/, "") ?? b.name.split(":")[0],
                query: (inputContent["query"] as string) ?? b.input?.summary ?? "",
              });
            }
          }
          await hostAdapter.onStepComplete(step.step_index, step.name);
        }
        return lastOutput;
      });

      finalOutput = await effectiveExecuteLogic(adapter);
      await adapter.finalize(finalOutput);

      // Verify that all expected boundaries were consumed
      if (resolver.hasRemaining()) {
        const next = resolver.peekNext();
        divergenceDetector.recordDivergence({
          type: "MISSING_BOUNDARY",
          message: `Replay finished without executing recorded boundary '${next?.name}' at sequence index ${resolver.getCursor()}.`,
          boundarySequence: resolver.getCursor(),
          expected: { boundary: next?.name, type: next?.boundary_type },
        });
        status = "DIVERGED";
      }

      // Check final output divergence against recorded final step or output summary
      const lastStep = source.trajectory?.[source.trajectory.length - 1];
      if (lastStep?.output_summary && typeof finalOutput === "string") {
        divergenceDetector.checkFinalOutput(lastStep.output_summary, finalOutput);
      }
    } catch (err) {
      if (err instanceof BoundaryResolutionError) {
        divergenceDetector.recordDivergence({
          type: err.divergenceType,
          message: err.message,
          actual: err.details,
          boundarySequence: resolver.getCursor(),
        });
        emitEvent("replay.divergence", {
          divergenceType: err.divergenceType,
          message: err.message,
        });

        if (err.divergenceType === "SIDE_EFFECT_ATTEMPT_BLOCKED") {
          liveCallsAttempted++;
          liveCallsBlocked++;
          emitEvent("replay.live_side_effect_blocked", err.details);
          status = "BLOCKED";
        } else {
          status = err.divergenceType === "INPUT_UNVERIFIABLE" ? "UNSUPPORTED" : "DIVERGED";
        }
      } else if (err instanceof NetworkAccessDeniedError) {
        // The guard records this call; finally transfers its count once.
        divergenceDetector.recordDivergence({
          type: "NETWORK_ATTEMPT_BLOCKED",
          message: err.message,
          actual: { target: err.target },
        });
        emitEvent("replay.network_blocked", { target: err.target });
        status = "BLOCKED";
      } else {
        divergenceDetector.recordDivergence({
          type: "OUTPUT_MISMATCH",
          message: err instanceof Error ? err.message : String(err),
        });
        emitEvent("replay.fail", { error: String(err) });
        status = "FAILED";
      }
    } finally {
      if (mode === "STRICT_OFFLINE") {
        liveCallsAttempted += this.networkGuard.getAttemptCount();
        liveCallsBlocked += this.networkGuard.getAttemptCount();
        this.networkGuard.deactivate();
        this.networkGuard.reset();
      }
    }

    const completedAt = new Date().toISOString();
    const divergences = divergenceDetector.getDivergences();
    if (divergences.length > 0 && status === "MATCHED") {
      status = "DIVERGED";
    }

    if (status === "MATCHED") {
      emitEvent("replay.complete", {
        substitutedCount: resolver.getSubstitutedCount(),
      });
    } else {
      emitEvent("replay.fail", { status, divergenceCount: divergences.length });
    }

    // Determine last successful step/boundary
    const lastBoundary = source.boundaries?.[Math.max(0, resolver.getSubstitutedCount() - 1)];
    lastSubstitutedBoundaryId = lastBoundary?.boundary_id;
    lastSuccessfulStepId = lastBoundary?.step_id;

    const finalOutputHash = finalOutput !== undefined ? hashPayload(finalOutput) : undefined;

    const result: ReplayResult = {
      replay_id: replayId,
      source_run_id: sourceRunId,
      replay_of: sourceRunId,
      status,
      mode,
      started_at: startedAt,
      completed_at: completedAt,
      steps_expected: plan.expected_steps.length,
      steps_executed: plan.expected_steps.length,
      boundaries_expected: plan.expected_boundaries.length,
      boundaries_substituted: resolver.getSubstitutedCount(),
      live_calls_attempted: liveCallsAttempted,
      live_calls_blocked: liveCallsBlocked,
      divergences,
      final_output: finalOutput,
      final_output_hash: finalOutputHash,
      deterministic_match: status === "MATCHED" && resolver.getPartiallyVerifiedCount() === 0,
      limitations: [
        ...plan.unsupported_features,
        ...(mode === "STRICT_OFFLINE"
          ? ["Network and subprocess interception is application-level; process or container isolation is required for untrusted host code and a zero-egress guarantee."]
          : []),
        ...(resolver.getPartiallyVerifiedCount() > 0
          ? [`${resolver.getPartiallyVerifiedCount()} input(s) matched only after redaction; exact equality is unverified.`]
          : []),
      ],
      replay_events: events,
      last_successful_step_id: lastSuccessfulStepId,
      last_substituted_boundary_id: lastSubstitutedBoundaryId,
    };

    if (persist) {
      await saveReplayResult(result, plan);
    }

    return result;
  }
}

export const replayRuntime = new ReplayRuntime();
