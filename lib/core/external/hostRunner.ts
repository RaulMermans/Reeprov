/**
 * Developer-side Host Replay & Fork Runner.
 *
 * Runs in the developer's process (CLI), never in the Reeprov server. It
 * re-executes a supported external agent's own step logic through an
 * explicit `ReeprovHostAdapter`, resolving every model/tool call from
 * captured evidence with the canonical BoundaryResolver.
 *
 * Replay: restore a registered checkpoint (normally the start checkpoint),
 *   re-execute host steps, substitute recorded responses, reject missing or
 *   divergent dependencies, never execute live side effects, and verify
 *   intermediate state and final output against the recording.
 *
 * Fork: restore a registered mid-run checkpoint, apply a controlled
 *   mutation, resume the host strictly after the checkpoint (the prefix is
 *   never re-executed), reuse recorded responses while inputs still match,
 *   simulate (never execute) side effects once execution diverges, and emit
 *   a child RunArtifact with lineage and a resume proof.
 *
 * Isolation: the network guard intercepts known Node network/subprocess
 * APIs in-process. It is not OS or container isolation; run untrusted host
 * code in a separately isolated process.
 */

import type { RunArtifact } from "../contracts/runArtifact";
import { runArtifactSchema, CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION } from "../contracts/runArtifact";
import type { CheckpointReference, ExperimentMutation, ResumeAdapterIdentity } from "../contracts/lineage";
import type { ExecutionBoundary } from "../contracts/replay";
import type { ExecutionStep, StateSnapshot } from "../contracts/execution";
import type { ToolInvocation } from "../contracts/tools";
import {
  type ReplayResult,
  type ReplayDivergence,
  type ReplayEvent,
  type ReplayEventType,
  replayResultSchema,
} from "../replay/contracts";
import { buildReplayPlan } from "../replay/planner";
import { StateRestorer } from "../replay/stateRestorer";
import { BoundaryResolver, BoundaryResolutionError } from "../replay/resolver";
import { DivergenceDetector } from "../replay/divergenceDetector";
import { NetworkKillSwitch, NetworkAccessDeniedError } from "../replay/networkGuard";
import { MutationApplier } from "../fork/mutationApplier";
import { assessCheckpoint, type CheckpointAssessment } from "../fork/restorability";
import { hashPayload } from "../capture/hashing";
import { normalizeBoundary } from "../capture/normalizeBoundary";
import { sanitizeCanonicalRecord, sanitizePayload } from "../capture/redaction";
import { capturePolicyForRun } from "../capture/runPolicy";
import {
  modelBoundaryIdentity,
  toolBoundaryIdentity,
  type HostDependencies,
  type HostModelRequest,
  type HostToolRequest,
  type ReeprovHostAdapter,
} from "../../../packages/client-typescript/src/host";

export const HOST_RUNNER_ID = "reeprov-host-runner@1.0.0";

const ISOLATION_LIMITATION =
  "Network and subprocess interception is application-level; it is not OS or container isolation. Untrusted host code needs separate process isolation for a zero-egress guarantee.";

type AnyHost = ReeprovHostAdapter<unknown, Record<string, unknown>, unknown>;

export class HostRunnerError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "HostRunnerError";
  }
}

// ── Shared preflight ─────────────────────────────────────────────────────────

interface Preflight {
  checkpoint: CheckpointReference;
  assessment: CheckpointAssessment;
  restoredState: Record<string, unknown>;
  restoredHash: string;
}

function findCheckpoint(source: RunArtifact, checkpointId?: string): CheckpointReference | undefined {
  const registered = source.checkpoints.filter((c) => c.capture_kind === "REGISTERED");
  if (checkpointId) return source.checkpoints.find((c) => c.checkpoint_id === checkpointId);
  return registered.find((c) => (c.resume_step_index ?? 0) === 0 && (c.boundary_cursor ?? 0) === 0);
}

function preflight(source: RunArtifact, adapter: AnyHost, checkpointId?: string): Preflight | { unsupported: string[] } {
  const checkpoint = findCheckpoint(source, checkpointId);
  if (!checkpoint) {
    const observed = (source.checkpoint_observations ?? []).some((o) => o.checkpoint_id === checkpointId);
    return {
      unsupported: [
        checkpointId
          ? observed
            ? `CHECKPOINT_OBSERVATION_ONLY: '${checkpointId}' was only observed (no restorable state); it cannot be replayed or forked.`
            : `CHECKPOINT_NOT_FOUND: checkpoint '${checkpointId}' does not exist in run '${source.identity.run_id}'.`
          : "START_CHECKPOINT_MISSING: replay needs a registered checkpoint at step 0 (cursor 0) holding the run's initial state.",
      ],
    };
  }
  const assessment = assessCheckpoint(source, checkpoint, {
    host: { identity: adapter.identity, supportsResume: (p) => adapter.supportsResume(p) },
  });
  if (!assessment.advertised_restorable) return { unsupported: assessment.reasons };
  try {
    const restored = new StateRestorer(source).restoreCheckpoint(checkpoint.checkpoint_id);
    return { checkpoint, assessment, restoredState: restored.state, restoredHash: restored.hash };
  } catch (err) {
    return { unsupported: [err instanceof Error ? err.message : String(err)] };
  }
}

function eventLog(id: string, sourceRunId: string) {
  const events: ReplayEvent[] = [];
  const emit = (event_type: ReplayEventType, data?: Record<string, unknown>, boundaryId?: string) => {
    events.push({
      event_id: `revt_${id}_${events.length}`,
      replay_id: id,
      source_run_id: sourceRunId,
      event_type,
      timestamp: new Date().toISOString(),
      boundary_id: boundaryId,
      data,
    });
  };
  return { events, emit };
}

// ── Replay ───────────────────────────────────────────────────────────────────

export interface HostReplayOptions {
  source: RunArtifact;
  adapter: AnyHost;
  /** Registered checkpoint to start from; default is the run's start checkpoint. */
  checkpointId?: string;
  /** EXACT rejects inputs whose recording was redacted; ALLOW_PARTIAL accepts them as partially verified. */
  verification?: "EXACT" | "ALLOW_PARTIAL";
  /** Controlled input changes (state_patch) to demonstrate divergence detection. */
  inputMutations?: ExperimentMutation[];
  replayId?: string;
}

export async function runHostReplay(options: HostReplayOptions): Promise<ReplayResult> {
  const { source, adapter } = options;
  const verificationMode = options.verification ?? "EXACT";
  const replayId = options.replayId ?? `replay_host_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const sourceRunId = source.identity.run_id;
  const startedAt = new Date().toISOString();
  const { events, emit } = eventLog(replayId, sourceRunId);
  const detector = new DivergenceDetector(replayId, sourceRunId);
  const policy = capturePolicyForRun(source);
  emit("replay.start", { mode: "STRICT_OFFLINE", runner: HOST_RUNNER_ID, adapter: adapter.identity });

  const base = (status: ReplayResult["status"], extra: Partial<ReplayResult>): ReplayResult =>
    replayResultSchema.parse({
      replay_id: replayId,
      source_run_id: sourceRunId,
      replay_of: sourceRunId,
      status,
      mode: "STRICT_OFFLINE",
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      steps_expected: adapter.steps.length,
      steps_executed: 0,
      boundaries_expected: source.boundaries.length,
      boundaries_substituted: 0,
      live_calls_attempted: 0,
      live_calls_blocked: 0,
      divergences: detector.getDivergences(),
      deterministic_match: false,
      limitations: [ISOLATION_LIMITATION],
      replay_events: events,
      host_execution: {
        kind: "HOST_REEXECUTED",
        runner: HOST_RUNNER_ID,
        adapter: adapter.identity,
        checkpoint_id: options.checkpointId,
        input_mutations: (options.inputMutations ?? []).map((m) => m.mutation_id),
      },
      verification: "UNVERIFIED",
      boundary_matches: [],
      state_checks: [],
      ...extra,
    });

  // 1-2. Load evidence, validate integrity and replayability.
  const plan = await buildReplayPlan(source, { mode: "STRICT_OFFLINE", replayId });
  emit("replay.plan.created", { verdict: plan.replayability_verdict });
  if (plan.replayability_verdict !== "REPLAYABLE") {
    for (const reason of [...plan.unsupported_features, ...plan.missing_evidence]) {
      detector.recordDivergence({ type: "UNSUPPORTED_BOUNDARY", message: reason, severity: "critical" });
    }
    emit("replay.fail", { reason: "evidence not replayable" });
    return base("UNSUPPORTED", { limitations: [ISOLATION_LIMITATION, ...plan.unsupported_features, ...plan.missing_evidence] });
  }
  const pre = preflight(source, adapter, options.checkpointId);
  if ("unsupported" in pre) {
    for (const reason of pre.unsupported) detector.recordDivergence({ type: "UNSUPPORTED_BOUNDARY", message: reason });
    emit("replay.fail", { reasons: pre.unsupported });
    return base("UNSUPPORTED", { limitations: [ISOLATION_LIMITATION, ...pre.unsupported] });
  }

  let state = pre.restoredState;
  if (options.inputMutations?.length) {
    state = new MutationApplier().apply(state, options.inputMutations).mutatedState;
  }
  emit("replay.state.restored", { checkpointId: pre.checkpoint.checkpoint_id, hash: pre.restoredHash });

  const resolver = new BoundaryResolver(source, {
    strict: true,
    requireExactInputVerification: verificationMode === "EXACT",
    startCursor: pre.checkpoint.boundary_cursor ?? 0,
  });
  const matches: NonNullable<ReplayResult["boundary_matches"]> = [];
  const resolve = async (request: Parameters<BoundaryResolver["resolve"]>[0]) => {
    const res = await resolver.resolve(request);
    matches.push({
      sequence_index: res.boundary.sequence_index ?? 0,
      boundary_id: res.boundary.boundary_id,
      name: res.boundary.name,
      boundary_type: res.boundary.boundary_type,
      input_verification: res.inputVerification,
      side_effect_substituted: res.sideEffectSubstituted,
    });
    emit("replay.boundary.substituted", { name: res.boundary.name, verification: res.inputVerification }, res.boundary.boundary_id);
    if (res.sideEffectSubstituted) emit("replay.side_effect_substituted", { name: res.boundary.name }, res.boundary.boundary_id);
    return res.output;
  };
  const deps: HostDependencies = {
    callModel: (req: HostModelRequest) => resolve({ expectedType: "model_call", ...modelBoundaryIdentity(req), input: req }),
    callTool: (req: HostToolRequest) =>
      resolve({ expectedType: "tool_call", ...toolBoundaryIdentity(req), input: req.args, sideEffectIntent: "substitute_recorded" }),
  };

  const stateChecks: NonNullable<ReplayResult["state_checks"]> = [];
  const checkpointsAfter = new Map(
    source.checkpoints
      .filter((c) => c.capture_kind === "REGISTERED" && c.host_step_index !== undefined && c.position === "AFTER_STEP")
      .map((c) => [c.host_step_index as number, c]),
  );
  let stepsExecuted = 0;
  let liveBlocked = 0;
  let status: ReplayResult["status"] = "MATCHED";
  let output: unknown;
  const guard = new NetworkKillSwitch();
  try {
    guard.activate();
    const result = await adapter.run({
      state: structuredClone(state),
      fromStepIndex: pre.checkpoint.resume_step_index ?? 0,
      deps,
      hooks: {
        onStepStart: (stepIndex, stepId) => emit("replay.step.start", { stepIndex, stepId }),
        onStepComplete: (stepIndex, stepId, stepState) => {
          stepsExecuted++;
          emit("replay.step.complete", { stepIndex, stepId });
          const recorded = checkpointsAfter.get(stepIndex);
          if (recorded?.state_hash) {
            const actual = sanitizePayload(stepState, { policy }).persisted_hash;
            const ok = actual === recorded.state_hash;
            stateChecks.push({
              checkpoint_id: recorded.checkpoint_id, step_index: stepIndex,
              status: ok ? "MATCHED" : "MISMATCHED", expected_hash: recorded.state_hash, actual_hash: actual,
            });
            if (!ok) {
              detector.recordDivergence({
                type: "STATE_HASH_MISMATCH", stepIndex,
                message: `State after step ${stepIndex} (${stepId}) differs from checkpoint '${recorded.checkpoint_id}'.`,
                expected: { hash: recorded.state_hash }, actual: { hash: actual },
              });
            }
          }
        },
      },
    });
    output = result.output;
    if (resolver.hasRemaining()) {
      const next = resolver.peekNext();
      detector.recordDivergence({
        type: "MISSING_BOUNDARY",
        message: `Host finished without making recorded call '${next?.name}' (sequence ${resolver.getCursor()}).`,
        boundarySequence: resolver.getCursor(),
        expected: { boundary: next?.name, type: next?.boundary_type },
      });
    }
  } catch (err) {
    if (err instanceof BoundaryResolutionError) {
      detector.recordDivergence({ type: err.divergenceType, message: err.message, actual: err.details, boundarySequence: resolver.getCursor() });
      emit("replay.divergence", { divergenceType: err.divergenceType, message: err.message });
      status = err.divergenceType === "INPUT_UNVERIFIABLE" ? "UNSUPPORTED" : err.divergenceType === "SIDE_EFFECT_ATTEMPT_BLOCKED" ? "BLOCKED" : "DIVERGED";
    } else if (err instanceof NetworkAccessDeniedError) {
      detector.recordDivergence({ type: "NETWORK_ATTEMPT_BLOCKED", message: err.message, actual: { target: err.target } });
      emit("replay.network_blocked", { target: err.target });
      status = "BLOCKED";
    } else {
      detector.recordDivergence({ type: "OUTPUT_MISMATCH", message: err instanceof Error ? err.message : String(err) });
      status = "FAILED";
    }
  } finally {
    liveBlocked = guard.getAttemptCount();
    guard.deactivate();
    if (liveBlocked > 0 && status === "MATCHED") status = "BLOCKED";
    if (liveBlocked > 0) emit("replay.live_side_effect_blocked", { attempts: liveBlocked });
  }

  // Output verification against the recorded final outcome.
  const recordedOutput = source.evidence?.final_outcome?.payload;
  let outputCheck: NonNullable<ReplayResult["output_check"]>;
  if (output === undefined) {
    outputCheck = { status: "UNVERIFIABLE", reason: "Host produced no output." };
  } else if (recordedOutput === undefined) {
    outputCheck = { status: "UNVERIFIABLE", reason: "The run did not record a final output (or content capture omitted it)." };
  } else {
    const replayed = sanitizePayload(output, { policy });
    const recordedHash = hashPayload(recordedOutput);
    outputCheck = {
      status: replayed.persisted_hash === recordedHash ? "MATCHED" : "MISMATCHED",
      recorded_hash: recordedHash,
      replayed_hash: replayed.persisted_hash,
      reason: replayed.redacted ? "Compared after redaction; exact equality of removed values is unverified." : undefined,
    };
    if (outputCheck.status === "MISMATCHED") {
      detector.recordDivergence({ type: "OUTPUT_MISMATCH", message: "Re-executed final output differs from the recorded output.", expected: { hash: recordedHash }, actual: { hash: replayed.persisted_hash } });
    }
  }

  const divergences = detector.getDivergences();
  if (status === "MATCHED" && divergences.length > 0) status = "DIVERGED";
  const partial = matches.filter((m) => m.input_verification === "PARTIAL").length;
  const outputPartial = outputCheck.status !== "MATCHED" || Boolean(outputCheck.reason);
  const verification =
    status !== "MATCHED" ? "UNVERIFIED" : partial === 0 && !outputPartial ? "VERIFIED" : "PARTIALLY_VERIFIED";
  emit(status === "MATCHED" ? "replay.complete" : "replay.fail", { status, verification });

  return base(status, {
    steps_executed: stepsExecuted,
    boundaries_substituted: matches.length,
    live_calls_attempted: liveBlocked,
    live_calls_blocked: liveBlocked,
    divergences,
    final_output: output === undefined ? undefined : sanitizePayload(output, { policy }).value,
    final_output_hash: output === undefined ? undefined : sanitizePayload(output, { policy }).persisted_hash,
    deterministic_match: verification === "VERIFIED",
    verification,
    boundary_matches: matches,
    output_check: outputCheck,
    state_checks: stateChecks,
    host_execution: {
      kind: "HOST_REEXECUTED",
      runner: HOST_RUNNER_ID,
      adapter: adapter.identity,
      checkpoint_id: pre.checkpoint.checkpoint_id,
      input_mutations: (options.inputMutations ?? []).map((m) => m.mutation_id),
    },
    limitations: [
      ISOLATION_LIMITATION,
      ...(partial > 0 ? [`${partial} input(s) matched only after redaction; exact equality is unverified.`] : []),
      ...(outputCheck.status === "UNVERIFIABLE" ? [`Output not verified: ${outputCheck.reason}`] : []),
    ],
    last_substituted_boundary_id: matches[matches.length - 1]?.boundary_id,
  });
}

// ── Fork ─────────────────────────────────────────────────────────────────────

export type ForkCallDisposition = "RECORDED_REUSED" | "OVERRIDDEN" | "BLOCKED_SIMULATED" | "CANDIDATE_EXECUTED";

export interface ResumeProof {
  checkpoint_id: string;
  checkpoint_cursor: number;
  resume_step_index: number;
  resume_step_id?: string;
  first_executed_step_index: number | null;
  executed_step_indices: number[];
  prefix_steps_executed: number;
  parent_prefix_boundary_ids: string[];
  restored_state_hash: string;
  mutated_state_hash: string;
}

export interface HostForkResult {
  fork_id: string;
  parent_run_id: string;
  root_run_id: string;
  checkpoint_id: string;
  status: "COMPLETED" | "FAILED" | "UNSUPPORTED";
  adapter: ResumeAdapterIdentity;
  errors: string[];
  resume_proof?: ResumeProof;
  call_dispositions: Array<{ sequence_index: number; name: string; boundary_type: string; disposition: ForkCallDisposition; side_effect_class: string }>;
  blocked_side_effects: number;
  live_side_effects_executed: 0;
  final_output?: unknown;
  child_artifact?: RunArtifact;
  limitations: string[];
}

export interface HostForkOptions {
  source: RunArtifact;
  adapter: AnyHost;
  checkpointId: string;
  mutations: ExperimentMutation[];
  forkId?: string;
  /** Sandboxed candidate model for divergent model calls; without it a divergent model call fails the fork. */
  candidateModel?: (request: HostModelRequest) => Promise<unknown>;
}

const FORK_MUTATION_TYPES = new Set(["state_patch", "tool_result_override"]);

export async function runHostFork(options: HostForkOptions): Promise<HostForkResult> {
  const { source, adapter } = options;
  const forkId = options.forkId ?? `fork_${source.identity.run_id}_${Date.now().toString(36)}`;
  const rootRunId = source.lineage?.root_run_id ?? source.identity.run_id;
  const policy = capturePolicyForRun(source);
  const startedAt = new Date().toISOString();
  const result = (status: HostForkResult["status"], extra: Partial<HostForkResult>): HostForkResult => ({
    fork_id: forkId,
    parent_run_id: source.identity.run_id,
    root_run_id: rootRunId,
    checkpoint_id: options.checkpointId,
    status,
    adapter: adapter.identity,
    errors: [],
    call_dispositions: [],
    blocked_side_effects: 0,
    live_side_effects_executed: 0,
    limitations: [ISOLATION_LIMITATION],
    ...extra,
  });

  const unsupportedMutation = options.mutations.find((m) => !FORK_MUTATION_TYPES.has(m.mutation_type));
  if (unsupportedMutation) {
    return result("UNSUPPORTED", {
      errors: [`UNSUPPORTED_MUTATION: host forks support ${[...FORK_MUTATION_TYPES].join(", ")}; got '${unsupportedMutation.mutation_type}'.`],
    });
  }
  const pre = preflight(source, adapter, options.checkpointId);
  if ("unsupported" in pre) return result("UNSUPPORTED", { errors: pre.unsupported });

  const applied = new MutationApplier().apply(pre.restoredState, options.mutations);
  const rejected = applied.appliedRecords.filter((r) => r.status !== "APPLIED");
  if (rejected.length > 0) {
    return result("FAILED", { errors: rejected.map((r) => `MUTATION_${r.status}: ${r.mutation_id} ${r.error ?? ""}`.trim()) });
  }
  const mutatedState = applied.mutatedState;
  const cursor = pre.checkpoint.boundary_cursor ?? 0;
  const resumeIndex = pre.checkpoint.resume_step_index ?? 0;
  const sortedParent = [...source.boundaries].sort((a, b) => (a.sequence_index ?? 0) - (b.sequence_index ?? 0));
  const resolver = new BoundaryResolver(source, { strict: true, requireExactInputVerification: false, startCursor: cursor });

  const childBoundaries: ExecutionBoundary[] = [];
  const childTools: ToolInvocation[] = [];
  const dispositions: HostForkResult["call_dispositions"] = [];
  const executedSteps: number[] = [];
  const stepRecords: ExecutionStep[] = [];
  const snapshots: StateSnapshot[] = [];
  let currentStep: { index: number; id: string; startedAt: string } | undefined;
  let diverged = false;
  let blocked = 0;

  const record = async (
    type: "model_call" | "tool_call",
    identity: { name: string; dependencyIdentity: string },
    input: unknown,
    output: unknown,
    disposition: ForkCallDisposition,
    sideEffect: string,
  ) => {
    const seq = childBoundaries.length;
    const boundary = await normalizeBoundary(
      {
        runId: forkId,
        boundaryId: `bnd:${forkId}:${seq}`,
        sequenceIndex: seq,
        boundaryType: type,
        ...identity,
        stepId: currentStep ? `${forkId}::step::${currentStep.index}` : undefined,
        input,
        output,
        status: disposition === "BLOCKED_SIMULATED" ? "skipped" : "completed",
        declaredSideEffectClass: sideEffect as never,
        metadata: { fork_disposition: disposition },
      },
      policy,
    );
    childBoundaries.push(boundary);
    dispositions.push({ sequence_index: seq, name: identity.name, boundary_type: type, disposition, side_effect_class: boundary.side_effect_class });
    if (type === "tool_call") {
      childTools.push({
        tool_call_id: boundary.boundary_id,
        tool_name: identity.name,
        permission_class: sideEffect as ToolInvocation["permission_class"],
        replayability: "UNKNOWN",
        status: disposition === "BLOCKED_SIMULATED" ? "blocked" : "completed",
        started_at: boundary.started_at,
        completed_at: boundary.started_at,
        metadata: { fork_disposition: disposition },
      } as ToolInvocation);
    }
  };

  /** Reuse the recorded response only while the child is still on the recorded path. */
  const tryRecorded = async (request: Parameters<BoundaryResolver["resolve"]>[0]) => {
    if (diverged || !resolver.hasRemaining()) return { hit: false as const };
    try {
      return { hit: true as const, res: await resolver.resolve(request) };
    } catch (err) {
      if (err instanceof BoundaryResolutionError) {
        diverged = true;
        return { hit: false as const };
      }
      throw err;
    }
  };

  const deps: HostDependencies = {
    async callModel(req) {
      const identity = modelBoundaryIdentity(req);
      const recorded = await tryRecorded({ expectedType: "model_call", ...identity, input: req });
      if (recorded.hit) {
        await record("model_call", identity, req, recorded.res.output, "RECORDED_REUSED", "read_only");
        return recorded.res.output;
      }
      if (!options.candidateModel) {
        throw new HostRunnerError(
          "DIVERGENT_DEPENDENCY",
          `model call ${identity.name} diverged from the recording after the mutation and no sandboxed candidate model was configured.`,
        );
      }
      const output = await options.candidateModel(req);
      await record("model_call", identity, req, output, "CANDIDATE_EXECUTED", "read_only");
      return output;
    },
    async callTool(req) {
      const identity = toolBoundaryIdentity(req);
      const sideEffect = req.sideEffect ?? "read_only";
      if (applied.toolOverrides.has(req.name)) {
        const output = applied.toolOverrides.get(req.name);
        await record("tool_call", identity, req.args, output, "OVERRIDDEN", sideEffect);
        return output;
      }
      const recorded = await tryRecorded({
        expectedType: "tool_call", ...identity, input: req.args, sideEffectIntent: "substitute_recorded",
      });
      if (recorded.hit) {
        await record("tool_call", identity, req.args, recorded.res.output, "RECORDED_REUSED", recorded.res.boundary.side_effect_class);
        return recorded.res.output;
      }
      if (sideEffect !== "read_only") {
        blocked++;
        const simulated = { reeprov_simulated: true, executed: false, reason: "SIDE_EFFECT_BLOCKED_IN_FORK" };
        await record("tool_call", identity, req.args, simulated, "BLOCKED_SIMULATED", sideEffect);
        return simulated;
      }
      throw new HostRunnerError(
        "DIVERGENT_DEPENDENCY",
        `read-only tool ${req.name} was called with inputs that have no recording; offline forks never execute live tools.`,
      );
    },
  };

  snapshots.push({
    snapshot_id: `state_${forkId}_restored`,
    step_id: `${forkId}::restored`,
    snapshot_type: "INITIAL_STATE",
    timestamp: startedAt,
    state_scope: "workflow",
    state_data: sanitizePayload(mutatedState, { policy }).value as Record<string, unknown>,
    captured: true,
    hash: sanitizePayload(mutatedState, { policy }).persisted_hash,
  });

  let output: unknown;
  let finalState: Record<string, unknown> = mutatedState;
  const errors: string[] = [];
  let status: HostForkResult["status"] = "COMPLETED";
  const guard = new NetworkKillSwitch();
  try {
    guard.activate();
    const run = await adapter.run({
      state: structuredClone(mutatedState),
      fromStepIndex: resumeIndex,
      deps,
      hooks: {
        onStepStart: (index, id) => {
          currentStep = { index, id, startedAt: new Date().toISOString() };
          executedSteps.push(index);
        },
        onStepComplete: (index, id, stepState) => {
          const safe = sanitizePayload(stepState, { policy });
          const snapshotId = `state_${forkId}_${index}`;
          snapshots.push({
            snapshot_id: snapshotId, step_id: `${forkId}::step::${index}`, snapshot_type: "STEP_STATE",
            timestamp: new Date().toISOString(), state_scope: "workflow",
            state_data: safe.value as Record<string, unknown>, captured: true, hash: safe.persisted_hash,
          });
          stepRecords.push({
            step_id: `${forkId}::step::${index}`,
            step_index: stepRecords.length,
            step_type: "node",
            name: id,
            node_id: id,
            started_at: currentStep?.startedAt ?? new Date().toISOString(),
            completed_at: new Date().toISOString(),
            status: "completed",
            state_snapshot_id: snapshotId,
            boundary_ids: childBoundaries.filter((b) => b.step_id === `${forkId}::step::${index}`).map((b) => b.boundary_id),
            tool_invocation_ids: [], model_invocation_ids: [], memory_operation_ids: [], retrieval_operation_ids: [],
            eval_result_ids: [], artifact_ids: [],
            metadata: { host_step_index: index },
          });
        },
      },
    });
    output = run.output;
    finalState = run.state;
  } catch (err) {
    status = "FAILED";
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    const attempts = guard.getAttemptCount();
    guard.deactivate();
    if (attempts > 0) {
      status = "FAILED";
      errors.push(`NETWORK_ATTEMPT_BLOCKED: ${attempts} live network/subprocess attempt(s) were blocked.`);
    }
  }

  const prefixExecuted = executedSteps.filter((i) => i < resumeIndex).length;
  if (status === "COMPLETED" && (executedSteps[0] !== resumeIndex || prefixExecuted > 0)) {
    status = "FAILED";
    errors.push(
      `RESUME_VIOLATION: host executed steps [${executedSteps.join(", ")}]; a resumed fork must start at step ${resumeIndex} and never re-execute the prefix.`,
    );
  }
  const resumeProof: ResumeProof = {
    checkpoint_id: pre.checkpoint.checkpoint_id,
    checkpoint_cursor: cursor,
    resume_step_index: resumeIndex,
    resume_step_id: pre.checkpoint.resume_step_id,
    first_executed_step_index: executedSteps[0] ?? null,
    executed_step_indices: executedSteps,
    prefix_steps_executed: prefixExecuted,
    parent_prefix_boundary_ids: sortedParent.slice(0, cursor).map((b) => b.boundary_id),
    restored_state_hash: pre.restoredHash,
    mutated_state_hash: hashPayload(mutatedState),
  };

  const completedAt = new Date().toISOString();
  const safeOutput = output === undefined ? undefined : sanitizePayload(output, { policy }).value;
  const finalSafe = sanitizePayload(finalState, { policy });
  snapshots.push({
    snapshot_id: `state_${forkId}_final`, step_id: `${forkId}::final`, snapshot_type: "FINAL_STATE",
    timestamp: completedAt, state_scope: "workflow",
    state_data: finalSafe.value as Record<string, unknown>, captured: true, hash: finalSafe.persisted_hash,
  });

  const child: RunArtifact = runArtifactSchema.parse(
    sanitizeCanonicalRecord(
      {
        schema_version: CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION,
        identity: {
          run_id: forkId,
          project_id: source.identity.project_id,
          project_name: source.identity.project_name,
          workflow_id: source.identity.workflow_id,
          created_at: startedAt,
        },
        execution: {
          status: status === "COMPLETED" ? "completed" : "failed",
          started_at: startedAt,
          completed_at: completedAt,
          duration_ms: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
          summary: `Resumed fork of ${source.identity.run_id} from checkpoint ${pre.checkpoint.checkpoint_id}`,
          ...(errors.length > 0 ? { error: { message: errors.join("; ") } } : {}),
        },
        environment: source.environment,
        trajectory: stepRecords,
        boundaries: childBoundaries,
        external_calls: [],
        state: snapshots,
        checkpoints: [],
        checkpoint_observations: [],
        context: [],
        memory: { operations: [], references: [] },
        tools: childTools,
        retrieval: [],
        models: [],
        artifacts: [],
        evals: [],
        lineage: {
          parent_run_id: source.identity.run_id,
          root_run_id: rootRunId,
          fork_checkpoint_id: pre.checkpoint.checkpoint_id,
          fork_step_id: pre.checkpoint.step_id,
          baseline_run_id: source.identity.run_id,
          checkpoint_reference: pre.checkpoint,
          mutations: options.mutations,
        },
        provenance: {
          capture_method: "cli_bridge",
          adapter_version: adapter.identity.adapter_version,
          captured_by: HOST_RUNNER_ID,
          redaction_verified: true,
          metadata: {
            capture_policy: { content_mode: policy.contentMode },
            fork: {
              adapter: adapter.identity,
              resumed: status === "COMPLETED",
              status,
              resume_proof: resumeProof,
              blocked_side_effects: blocked,
              live_side_effects_executed: 0,
            },
          },
        },
        safety: source.safety,
        observability: {
          total_duration_ms: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
          model_calls_count: childBoundaries.filter((b) => b.boundary_type === "model_call").length,
          tool_calls_count: childBoundaries.filter((b) => b.boundary_type === "tool_call").length,
          evals_passed: 0, evals_failed: 0,
          trace_event_count: stepRecords.length,
          context_snapshot_count: 0, memory_operations_count: 0, retrieval_operations_count: 0,
        },
        replay: {
          overall_replayability: "REPLAYABLE_RECORDED",
          unsupported_boundaries_count: 0,
          side_effect_gated_count: blocked,
          deterministic: true,
          sandboxed_available: false,
          missing_recordings: [],
          notes: [`Resumed after checkpoint ${pre.checkpoint.checkpoint_id}; ${options.mutations.length} mutation(s).`],
        },
        evidence: {
          verification_events: [], test_results: [], review_results: [], approval_events: [], security_events: [],
          final_outcome: {
            status: status === "COMPLETED" ? "SUCCESS" : "FAILURE",
            verification_status: "NOT_RUN",
            completed_at: completedAt,
            payload: safeOutput,
          },
        },
      },
      policy,
    ),
  );

  return result(status, {
    errors,
    resume_proof: resumeProof,
    call_dispositions: dispositions,
    blocked_side_effects: blocked,
    final_output: safeOutput,
    child_artifact: child,
  });
}

/** Server-side validation of an uploaded host fork (no host code runs on the server). */
export function validateUploadedFork(
  parent: RunArtifact,
  child: RunArtifact,
): { ok: true; checkpoint: CheckpointReference } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const checkpointId = child.lineage?.fork_checkpoint_id;
  const checkpoint = parent.checkpoints.find((c) => c.checkpoint_id === checkpointId);
  const fork = child.provenance.metadata?.["fork"] as
    | { adapter?: ResumeAdapterIdentity; resumed?: boolean; status?: string; resume_proof?: ResumeProof }
    | undefined;
  if (child.lineage?.parent_run_id !== parent.identity.run_id) errors.push("LINEAGE_MISMATCH: child parent_run_id does not match.");
  if (child.identity.project_id !== parent.identity.project_id) errors.push("PROJECT_MISMATCH: fork must stay in the parent's project.");
  if (!checkpoint) errors.push(`CHECKPOINT_NOT_FOUND: '${checkpointId}' is not a checkpoint of the parent.`);
  if (checkpoint) {
    const assessment = assessCheckpoint(parent, checkpoint);
    if (!assessment.state_valid) errors.push(...assessment.reasons);
    if (!fork?.adapter || fork.adapter.adapter_id !== checkpoint.resume_adapter?.adapter_id || fork.adapter.adapter_version !== checkpoint.resume_adapter?.adapter_version) {
      errors.push("INCOMPATIBLE_HOST_ADAPTER: fork adapter does not match the checkpoint's resume adapter.");
    }
    const proof = fork?.resume_proof;
    if (!proof) errors.push("RESUME_PROOF_MISSING: child does not carry a resume proof.");
    else {
      if (proof.checkpoint_cursor !== (checkpoint.boundary_cursor ?? 0)) errors.push("RESUME_PROOF_INVALID: cursor differs from checkpoint.");
      if (proof.resume_step_index !== (checkpoint.resume_step_index ?? 0) || proof.first_executed_step_index !== proof.resume_step_index) {
        errors.push("RESUME_PROOF_INVALID: execution did not start at the checkpoint's resume step.");
      }
      if (proof.prefix_steps_executed !== 0) errors.push("RESUME_PROOF_INVALID: prefix steps were re-executed.");
      if (proof.restored_state_hash !== checkpoint.state_hash) errors.push("RESUME_PROOF_INVALID: restored state hash differs from checkpoint.");
    }
  }
  const prefix = new Set(
    [...parent.boundaries]
      .sort((a, b) => (a.sequence_index ?? 0) - (b.sequence_index ?? 0))
      .slice(0, checkpoint?.boundary_cursor ?? 0)
      .map((b) => b.boundary_id),
  );
  if (child.boundaries.some((b) => prefix.has(b.boundary_id))) errors.push("PREFIX_DUPLICATED: child contains parent prefix boundaries.");
  if (child.boundaries.some((b) => b.side_effect_class !== "read_only" && b.status === "completed" && (b.metadata?.["fork_disposition"] ?? "") !== "RECORDED_REUSED")) {
    errors.push("LIVE_SIDE_EFFECT: child reports an executed side effect.");
  }
  return errors.length === 0 && checkpoint ? { ok: true, checkpoint } : { ok: false, errors };
}

/** Rejects results whose verification claim contradicts their own evidence. */
export function replayClaimErrors(replay: ReplayResult, runId: string): string[] {
  const errors: string[] = [];
  if (replay.source_run_id !== runId || replay.replay_of !== runId) errors.push("SOURCE_MISMATCH: replay does not reference this run.");
  if (!replay.host_execution) errors.push("HOST_EXECUTION_MISSING: replay must state what executed.");
  if (replay.host_execution?.kind === "HOST_REEXECUTED" && !replay.host_execution.adapter) {
    errors.push("ADAPTER_MISSING: host re-execution must name its adapter.");
  }
  if (replay.verification === "VERIFIED") {
    if (replay.status !== "MATCHED" || replay.divergences.length > 0) errors.push("INCONSISTENT_CLAIM: VERIFIED requires MATCHED with no divergences.");
    if ((replay.boundary_matches ?? []).some((m) => m.input_verification !== "FULL")) errors.push("INCONSISTENT_CLAIM: VERIFIED requires full input verification.");
    if (replay.output_check?.status !== "MATCHED") errors.push("INCONSISTENT_CLAIM: VERIFIED requires a matched output.");
    if (replay.host_execution?.kind !== "HOST_REEXECUTED") errors.push("INCONSISTENT_CLAIM: only host re-execution can be VERIFIED.");
  }
  return errors;
}
