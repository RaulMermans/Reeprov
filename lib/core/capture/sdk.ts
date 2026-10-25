/**
 * Reeprov TypeScript Capture SDK.
 *
 * Lightweight, non-intrusive runtime instrumentation layer.
 *
 * Invariants:
 * - Capture failure never crashes the host agent (fails safe by default).
 * - Transparent wrappers preserve target return values and execution semantics.
 * - Explicit flush and run completion semantics.
 * - Monotonic boundary sequence indices and causal step linkage.
 */

import { CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION, type RunArtifact } from "../contracts/runArtifact";
import type { ExecutionBoundary, SideEffectClass } from "../contracts/replay";
import type { ExecutionStep, ExecutionStepType, StateScope, StateSnapshot, StateSnapshotType } from "../contracts/execution";
import type { ModelInvocation } from "../contracts/models";
import type { ToolInvocation } from "../contracts/tools";
import type { RetrievalOperation } from "../contracts/retrieval";
import type { MemoryOperation } from "../contracts/memory";
import type { ContextSnapshot } from "../contracts/context";
import type { CheckpointReference, CheckpointPosition } from "../contracts/lineage";
import {
  type AgentConfigurationSnapshot,
  type AgentConfigurationInput,
  buildAgentConfigurationSnapshot,
} from "../contracts/configuration";
import {
  type PlanEvidence,
  type VerificationEvent,
  type TestResult,
  type ReviewResult,
  type ReviewType,
  type ReviewFinding,
  type ApprovalEvidence,
  type SecurityEvent,
  type RunOutcome,
  type RunEvidence,
  planEvidenceSchema,
  verificationEventSchema,
  testResultSchema,
  reviewResultSchema,
  approvalEvidenceSchema,
  securityEventSchema,
  runOutcomeSchema,
} from "../contracts/evidence";
import { captureModelInvocation } from "./adapters/modelCapture";
import { captureToolInvocation } from "./adapters/toolCapture";
import { captureRetrievalOperation } from "./adapters/retrievalCapture";
import { captureMemoryOperation } from "./adapters/memoryCapture";
import { captureHttpCall } from "./adapters/httpCapture";
import { saveCanonicalRun, getCanonicalRun } from "./persistence";
import { resolvePolicy } from "./policy";
import { hashPayload } from "./hashing";
import { sanitizeCanonicalRecord } from "./redaction";
import { validateExecutionIntegrity, ExecutionIntegrityError } from "./integrity";
import {
  type ReplayMode,
  type ReplayResult,
  type ReplayEvent,
  type ReplayStatus,
  BoundaryResolver,
  DivergenceDetector,
  NetworkKillSwitch,
  StateRestorer,
  saveReplayResult,
} from "../replay";
import type {
  CapturePolicy,
  ModelCaptureInput,
  ModelCaptureResult,
  ToolCaptureInput,
  ToolCaptureResult,
  RetrievalCaptureInput,
  RetrievalCaptureResult,
  MemoryCaptureInput,
  MemoryCaptureResult,
  HttpCaptureInput,
  HttpCaptureResult,
} from "./types";

export interface StartRunOptions {
  projectId: string;
  projectName?: string;
  workflowId: string;
  summary: string;
  runId?: string;
  policy?: Partial<CapturePolicy>;
  strict?: boolean; // If true, capture errors throw instead of logging warnings
}

export interface FinishRunOptions {
  summary?: string;
  status?: "completed" | "failed" | "degraded";
  error?: { message: string; code?: string; details?: unknown };
}

export class CaptureSession {
  public readonly runId: string;
  public readonly projectId: string;
  public readonly projectName: string;
  public readonly workflowId: string;
  public readonly startedAt: string;
  private readonly policy: CapturePolicy;
  private readonly strict: boolean;

  private readonly steps: ExecutionStep[] = [];
  private readonly boundaries: ExecutionBoundary[] = [];
  private readonly models: ModelInvocation[] = [];
  private readonly tools: ToolInvocation[] = [];
  private readonly retrievals: RetrievalOperation[] = [];
  private readonly memories: MemoryOperation[] = [];
  private readonly contexts: ContextSnapshot[] = [];
  private readonly stateSnapshots: StateSnapshot[] = [];
  private readonly checkpoints: CheckpointReference[] = [];

  private readonly activeStepStack: ExecutionStep[] = [];
  private stepCounter = 0;
  private boundaryCounter = 0;
  private isFinished = false;

  private configurationSnapshot?: AgentConfigurationSnapshot;
  private plan?: PlanEvidence;
  private readonly verificationEvents: VerificationEvent[] = [];
  private readonly testResults: TestResult[] = [];
  private readonly reviewResults: ReviewResult[] = [];
  private readonly approvalEvents: ApprovalEvidence[] = [];
  private readonly securityEvents: SecurityEvent[] = [];
  private finalOutcome?: RunOutcome;
  private verificationCounter = 0;

  constructor(options: StartRunOptions) {
    this.projectId = options.projectId;
    this.projectName = options.projectName ?? options.projectId;
    this.workflowId = options.workflowId;
    this.runId = options.runId || `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.startedAt = new Date().toISOString();
    this.policy = resolvePolicy(options.policy);
    this.strict = options.strict === true;
  }

  // ── Step Management ───────────────────────────────────────────────────────

  async step<T>(
    name: string,
    stepType: ExecutionStepType,
    fn: (stepId: string) => Promise<T>
  ): Promise<T> {
    const stepIndex = this.stepCounter++;
    const stepId = `step_${this.runId}_${stepIndex}`;
    const startedAt = new Date().toISOString();

    const stepRecord: ExecutionStep = {
      step_id: stepId,
      step_index: stepIndex,
      step_type: stepType,
      name,
      started_at: startedAt,
      status: "completed",
      boundary_ids: [],
      tool_invocation_ids: [],
      model_invocation_ids: [],
      memory_operation_ids: [],
      retrieval_operation_ids: [],
      eval_result_ids: [],
      artifact_ids: [],
    };

    this.activeStepStack.push(stepRecord);

    try {
      const result = await fn(stepId);
      return result;
    } catch (err) {
      stepRecord.status = "failed";
      stepRecord.error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      const completedAt = new Date().toISOString();
      stepRecord.completed_at = completedAt;
      stepRecord.duration_ms = Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
      this.activeStepStack.pop();
      this.steps.push(stepRecord);
    }
  }

  // ── Step Linkage Helper ───────────────────────────────────────────────────

  private linkToActiveStep(details: {
    boundaryId: string;
    stepId?: string;
    modelInvocationId?: string;
    toolInvocationId?: string;
    retrievalOperationId?: string;
    memoryOperationId?: string;
    contextSnapshotId?: string;
    stateSnapshotId?: string;
  }): void {
    const targetStep = details.stepId
      ? this.activeStepStack.find((s) => s.step_id === details.stepId) ??
        this.steps.find((s) => s.step_id === details.stepId)
      : this.activeStepStack[this.activeStepStack.length - 1];

    if (!targetStep) return;

    if (!targetStep.boundary_ids.includes(details.boundaryId)) {
      targetStep.boundary_ids.push(details.boundaryId);
    }
    if (details.modelInvocationId && !targetStep.model_invocation_ids.includes(details.modelInvocationId)) {
      targetStep.model_invocation_ids.push(details.modelInvocationId);
    }
    if (details.toolInvocationId && !targetStep.tool_invocation_ids.includes(details.toolInvocationId)) {
      targetStep.tool_invocation_ids.push(details.toolInvocationId);
    }
    if (details.retrievalOperationId && !targetStep.retrieval_operation_ids.includes(details.retrievalOperationId)) {
      targetStep.retrieval_operation_ids.push(details.retrievalOperationId);
    }
    if (details.memoryOperationId && !targetStep.memory_operation_ids.includes(details.memoryOperationId)) {
      targetStep.memory_operation_ids.push(details.memoryOperationId);
    }
    if (details.contextSnapshotId && !targetStep.context_snapshot_id) {
      targetStep.context_snapshot_id = details.contextSnapshotId;
    }
    if (details.stateSnapshotId && !targetStep.state_snapshot_id) {
      targetStep.state_snapshot_id = details.stateSnapshotId;
    }
  }

  // ── State Snapshot Capture ────────────────────────────────────────────────

  captureState(
    stateData: Record<string, unknown>,
    options?: {
      stepId?: string;
      scope?: StateScope;
      type?: StateSnapshotType;
      metadata?: Record<string, unknown>;
    }
  ): StateSnapshot {
    const effectiveStepId =
      options?.stepId ??
      this.activeStepStack[this.activeStepStack.length - 1]?.step_id ??
      `step_${this.runId}_0`;

    const snapshotId = `state_${this.runId}_${this.stateSnapshots.length}`;
    const clonedState = this.policy.contentMode === "STRUCTURE_ONLY"
      ? {}
      : sanitizeCanonicalRecord(structuredClone(stateData), this.policy);
    const hash = hashPayload(clonedState);
    const snapshotType =
      options?.type ??
      (this.stateSnapshots.length === 0 ? "INITIAL_STATE" : "STEP_STATE");

    const snapshot: StateSnapshot = {
      snapshot_id: snapshotId,
      step_id: effectiveStepId,
      snapshot_type: snapshotType,
      timestamp: new Date().toISOString(),
      state_scope: options?.scope ?? "workflow",
      state_data: clonedState,
      captured: this.policy.contentMode !== "STRUCTURE_ONLY",
      hash,
      metadata: this.policy.contentMode === "STRUCTURE_ONLY"
        ? undefined : sanitizeCanonicalRecord(options?.metadata, this.policy),
    };

    this.stateSnapshots.push(snapshot);

    const activeStep = options?.stepId
      ? this.activeStepStack.find((s) => s.step_id === options.stepId) ??
        this.steps.find((s) => s.step_id === options.stepId)
      : this.activeStepStack[this.activeStepStack.length - 1];

    if (activeStep) {
      activeStep.state_snapshot_id = snapshotId;
    }

    return snapshot;
  }

  // ── Checkpoint Creation ───────────────────────────────────────────────────

  createCheckpoint(options?: {
    stepId?: string;
    stateSnapshotId?: string;
    position?: CheckpointPosition;
    boundaryCursor?: number;
    resumeStepIndex?: number;
    resumeStepId?: string;
    metadata?: Record<string, unknown>;
  }): CheckpointReference {
    const checkpointId = `chk_${this.runId}_${this.checkpoints.length}`;
    const effectiveStepId =
      options?.stepId ??
      this.activeStepStack[this.activeStepStack.length - 1]?.step_id ??
      `step_${this.runId}_0`;

    let targetSnapshot: StateSnapshot | undefined;
    if (options?.stateSnapshotId) {
      targetSnapshot = this.stateSnapshots.find((s) => s.snapshot_id === options.stateSnapshotId);
      if (!targetSnapshot) {
        throw new Error(
          `Checkpoint snapshot '${options.stateSnapshotId}' not found. Cannot create checkpoint.`
        );
      }
    } else {
      targetSnapshot = this.stateSnapshots[this.stateSnapshots.length - 1];
      if (!targetSnapshot) {
        throw new Error("Cannot create checkpoint without at least one state snapshot.");
      }
    }

    const computedHash = hashPayload(targetSnapshot.state_data);
    const isRestorable =
      !!targetSnapshot &&
      targetSnapshot.captured &&
      !!targetSnapshot.state_data &&
      (targetSnapshot.hash ? targetSnapshot.hash === computedHash : true);
    const checkpointHash = targetSnapshot.hash ?? computedHash;

    const position: CheckpointPosition = options?.position ?? "AFTER_STEP";
    const boundaryCursor = options?.boundaryCursor ?? this.boundaries.length;

    const stepRecord =
      this.steps.find((s) => s.step_id === effectiveStepId) ??
      this.activeStepStack.find((s) => s.step_id === effectiveStepId);
    const currentStepIndex = stepRecord
      ? stepRecord.step_index
      : this.steps.length > 0
        ? this.steps[this.steps.length - 1].step_index
        : 0;

    let resumeStepIndex: number;
    let resumeStepId: string | undefined;

    if (options?.resumeStepIndex !== undefined) {
      resumeStepIndex = options.resumeStepIndex;
      resumeStepId =
        options.resumeStepId ?? this.steps.find((s) => s.step_index === resumeStepIndex)?.step_id;
    } else if (position === "AFTER_STEP") {
      resumeStepIndex = currentStepIndex + 1;
      resumeStepId = this.steps.find((s) => s.step_index === resumeStepIndex)?.step_id;
    } else if (position === "BEFORE_STEP") {
      resumeStepIndex = currentStepIndex;
      resumeStepId = effectiveStepId;
    } else {
      resumeStepIndex = currentStepIndex + 1;
      resumeStepId = this.steps.find((s) => s.step_index === resumeStepIndex)?.step_id;
    }

    const checkpoint: CheckpointReference = {
      checkpoint_id: checkpointId,
      run_id: this.runId,
      step_id: effectiveStepId,
      position,
      state_snapshot_id: targetSnapshot.snapshot_id,
      boundary_cursor: boundaryCursor,
      resume_step_index: resumeStepIndex,
      resume_step_id: resumeStepId,
      created_at: new Date().toISOString(),
      schema_version: CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION,
      state_hash: checkpointHash,
      hash: checkpointHash,
      restorable: isRestorable,
      metadata: this.policy.contentMode === "STRUCTURE_ONLY"
        ? undefined : sanitizeCanonicalRecord(options?.metadata, this.policy),
    };

    this.checkpoints.push(checkpoint);
    return checkpoint;
  }

  /**
   * Atomic Checkpoint API:
   * Clones and hashes state, captures a StateSnapshot, validates evidence,
   * creates CheckpointReference bound to boundary cursor, and persists linkage.
   */
  checkpoint(
    stateData: Record<string, unknown>,
    options?: {
      stepId?: string;
      position?: CheckpointPosition;
      label?: string;
      scope?: StateScope;
      type?: StateSnapshotType;
      metadata?: Record<string, unknown>;
    }
  ): { snapshot: StateSnapshot; checkpoint: CheckpointReference } {
    const snapshot = this.captureState(stateData, {
      stepId: options?.stepId,
      scope: options?.scope,
      type: options?.type,
      metadata: options?.metadata,
    });

    const checkpoint = this.createCheckpoint({
      stepId: options?.stepId ?? snapshot.step_id,
      stateSnapshotId: snapshot.snapshot_id,
      position: options?.position ?? "AFTER_STEP",
      metadata: {
        ...(options?.metadata ?? {}),
        ...(options?.label ? { label: options.label } : {}),
      },
    });

    return { snapshot, checkpoint };
  }

  // ── Direct Boundary Capture ───────────────────────────────────────────────

  async captureModel(input: Omit<ModelCaptureInput, "runId">): Promise<ModelCaptureResult | null> {
    try {
      const sequenceIndex = this.boundaryCounter++;
      const effectiveStepId = input.stepId ?? this.activeStepStack[this.activeStepStack.length - 1]?.step_id;

      const res = await captureModelInvocation(
        {
          ...input,
          runId: this.runId,
          stepId: effectiveStepId,
          sequenceIndex,
        },
        this.policy
      );

      this.boundaries.push(res.boundary);
      this.models.push(res.modelInvocation);
      if (res.contextSnapshot) {
        this.contexts.push(res.contextSnapshot);
      }

      this.linkToActiveStep({
        boundaryId: res.boundary.boundary_id,
        stepId: effectiveStepId,
        modelInvocationId: res.modelInvocation.invocation_id,
        contextSnapshotId: res.contextSnapshot?.snapshot_id,
      });

      return res;
    } catch (err) {
      this.handleCaptureError("captureModel", err);
      return null;
    }
  }

  async captureTool(input: Omit<ToolCaptureInput, "runId">): Promise<ToolCaptureResult | null> {
    try {
      const sequenceIndex = this.boundaryCounter++;
      const effectiveStepId = input.stepId ?? this.activeStepStack[this.activeStepStack.length - 1]?.step_id;

      const res = await captureToolInvocation(
        {
          ...input,
          runId: this.runId,
          stepId: effectiveStepId,
          sequenceIndex,
        },
        this.policy
      );

      this.boundaries.push(res.boundary);
      this.tools.push(res.toolInvocation);

      this.linkToActiveStep({
        boundaryId: res.boundary.boundary_id,
        stepId: effectiveStepId,
        toolInvocationId: res.toolInvocation.tool_call_id,
      });

      return res;
    } catch (err) {
      this.handleCaptureError("captureTool", err);
      return null;
    }
  }

  async captureRetrieval(input: Omit<RetrievalCaptureInput, "runId">): Promise<RetrievalCaptureResult | null> {
    try {
      const sequenceIndex = this.boundaryCounter++;
      const effectiveStepId = input.stepId ?? this.activeStepStack[this.activeStepStack.length - 1]?.step_id;

      const res = await captureRetrievalOperation(
        {
          ...input,
          runId: this.runId,
          stepId: effectiveStepId,
          sequenceIndex,
        },
        this.policy
      );

      this.boundaries.push(res.boundary);
      this.retrievals.push(res.retrievalOperation);

      this.linkToActiveStep({
        boundaryId: res.boundary.boundary_id,
        stepId: effectiveStepId,
        retrievalOperationId: res.retrievalOperation.operation_id,
      });

      return res;
    } catch (err) {
      this.handleCaptureError("captureRetrieval", err);
      return null;
    }
  }

  async captureMemory(input: Omit<MemoryCaptureInput, "runId">): Promise<MemoryCaptureResult | null> {
    try {
      const sequenceIndex = this.boundaryCounter++;
      const effectiveStepId = input.stepId ?? this.activeStepStack[this.activeStepStack.length - 1]?.step_id;

      const res = await captureMemoryOperation(
        {
          ...input,
          runId: this.runId,
          stepId: effectiveStepId,
          sequenceIndex,
        },
        this.policy
      );

      this.boundaries.push(res.boundary);
      this.memories.push(res.memoryOperation);

      this.linkToActiveStep({
        boundaryId: res.boundary.boundary_id,
        stepId: effectiveStepId,
        memoryOperationId: res.memoryOperation.operation_id,
      });

      return res;
    } catch (err) {
      this.handleCaptureError("captureMemory", err);
      return null;
    }
  }

  async captureHttp(input: Omit<HttpCaptureInput, "runId">): Promise<HttpCaptureResult | null> {
    try {
      const sequenceIndex = this.boundaryCounter++;
      const effectiveStepId = input.stepId ?? this.activeStepStack[this.activeStepStack.length - 1]?.step_id;

      const res = await captureHttpCall(
        {
          ...input,
          runId: this.runId,
          stepId: effectiveStepId,
          sequenceIndex,
        },
        this.policy
      );

      this.boundaries.push(res.boundary);

      this.linkToActiveStep({
        boundaryId: res.boundary.boundary_id,
        stepId: effectiveStepId,
      });

      return res;
    } catch (err) {
      this.handleCaptureError("captureHttp", err);
      return null;
    }
  }

  // ── Transparent Functional Wrappers ───────────────────────────────────────

  wrapTool<TArgs, TResult>(
    toolFn: (args: TArgs) => Promise<TResult> | TResult,
    options: {
      name: string;
      permissionClass?: SideEffectClass;
      stepId?: string;
      nodeId?: string;
    }
  ): (args: TArgs) => Promise<TResult> {
    return async (args: TArgs): Promise<TResult> => {
      const startedAt = new Date().toISOString();
      const startMs = Date.now();
      let output: TResult | undefined;
      let error: { message: string } | undefined;

      try {
        output = await toolFn(args);
        return output;
      } catch (err) {
        error = { message: err instanceof Error ? err.message : String(err) };
        throw err;
      } finally {
        const completedAt = new Date().toISOString();
        const durationMs = Date.now() - startMs;
        await this.captureTool({
          toolName: options.name,
          stepId: options.stepId,
          nodeId: options.nodeId,
          arguments: args,
          output,
          error,
          startedAt,
          completedAt,
          durationMs,
          declaredPermissionClass: options.permissionClass,
        });
      }
    };
  }

  wrapModel<TInput, TOutput>(
    modelFn: (input: TInput) => Promise<TOutput>,
    options: {
      provider: string;
      model: string;
      promptExtractor?: (input: TInput) => string;
      stepId?: string;
      nodeId?: string;
    }
  ): (input: TInput) => Promise<TOutput> {
    return async (input: TInput): Promise<TOutput> => {
      const startedAt = new Date().toISOString();
      const startMs = Date.now();
      let response: TOutput | undefined;
      let error: { message: string } | undefined;

      try {
        response = await modelFn(input);
        return response;
      } catch (err) {
        error = { message: err instanceof Error ? err.message : String(err) };
        throw err;
      } finally {
        const completedAt = new Date().toISOString();
        const durationMs = Date.now() - startMs;
        const prompt = options.promptExtractor
          ? options.promptExtractor(input)
          : typeof input === "string"
            ? input
            : JSON.stringify(input);

        await this.captureModel({
          provider: options.provider,
          model: options.model,
          prompt,
          response,
          error,
          startedAt,
          completedAt,
          durationMs,
          stepId: options.stepId,
          nodeId: options.nodeId,
        });
      }
    };
  }

  wrapRetrieval<TInput, TOutput extends Array<{ documentId?: string; content?: string }>>(
    retrievalFn: (input: TInput) => Promise<TOutput>,
    options: {
      serviceName: string;
      queryExtractor: (input: TInput) => string;
      stepId?: string;
      nodeId?: string;
    }
  ): (input: TInput) => Promise<TOutput> {
    return async (input: TInput): Promise<TOutput> => {
      const startedAt = new Date().toISOString();
      const startMs = Date.now();
      let results: TOutput | undefined;
      let error: { message: string } | undefined;

      try {
        results = await retrievalFn(input);
        return results;
      } catch (err) {
        error = { message: err instanceof Error ? err.message : String(err) };
        throw err;
      } finally {
        const completedAt = new Date().toISOString();
        const durationMs = Date.now() - startMs;
        const query = options.queryExtractor(input);

        await this.captureRetrieval({
          serviceName: options.serviceName,
          query,
          results: (results ?? []).map((r, i) => ({
            documentId: r.documentId ?? `doc_${i}`,
            content: r.content ?? "",
          })),
          error,
          startedAt,
          completedAt,
          durationMs,
          stepId: options.stepId,
          nodeId: options.nodeId,
        });
      }
    };
  }

  // ── Configuration & Evidence Plane ───────────────────────────────────────

  setConfiguration(
    input: Omit<AgentConfigurationInput, "run_id"> & { run_id?: string }
  ): AgentConfigurationSnapshot {
    const snapshot = buildAgentConfigurationSnapshot({
      ...input,
      run_id: this.runId,
    });
    this.configurationSnapshot = snapshot;
    return snapshot;
  }

  recordPlan(
    plan: Omit<PlanEvidence, "run_id" | "created_at"> & {
      run_id?: string;
      created_at?: string;
    }
  ): PlanEvidence {
    const validated = planEvidenceSchema.parse({
      created_at: new Date().toISOString(),
      ...plan,
      run_id: this.runId,
    });
    this.plan = validated;
    return validated;
  }

  recordTestResult(
    test: Omit<TestResult, "run_id"> & { run_id?: string }
  ): TestResult {
    const validated = testResultSchema.parse({
      ...test,
      run_id: this.runId,
    });
    this.testResults.push(validated);
    return validated;
  }

  recordReview(
    review: Omit<ReviewResult, "run_id" | "created_at"> & {
      run_id?: string;
      created_at?: string;
    }
  ): ReviewResult {
    const validated = reviewResultSchema.parse({
      created_at: new Date().toISOString(),
      ...review,
      run_id: this.runId,
    });
    this.reviewResults.push(validated);
    return validated;
  }

  recordVerification(
    event: Omit<VerificationEvent, "run_id" | "sequence_index"> & {
      run_id?: string;
      sequence_index?: number;
    }
  ): VerificationEvent {
    const sequenceIndex = event.sequence_index ?? this.verificationCounter++;
    const validated = verificationEventSchema.parse({
      ...event,
      run_id: this.runId,
      sequence_index: sequenceIndex,
    });
    this.verificationEvents.push(validated);
    return validated;
  }

  recordSecurityEvent(
    event: Omit<SecurityEvent, "run_id" | "event_id" | "timestamp"> & {
      run_id?: string;
      event_id?: string;
      timestamp?: string;
    }
  ): SecurityEvent {
    const eventId = event.event_id ?? `sec_${this.runId}_${this.securityEvents.length}`;
    const validated = securityEventSchema.parse({
      timestamp: new Date().toISOString(),
      ...event,
      event_id: eventId,
      run_id: this.runId,
    });
    this.securityEvents.push(validated);
    return validated;
  }

  recordApproval(
    approval: Omit<ApprovalEvidence, "requested_at"> & {
      requested_at?: string;
    }
  ): ApprovalEvidence {
    const validated = approvalEvidenceSchema.parse({
      requested_at: new Date().toISOString(),
      ...approval,
    });
    this.approvalEvents.push(validated);
    return validated;
  }

  setOutcome(
    outcome: Omit<RunOutcome, "completed_at"> & { completed_at?: string }
  ): RunOutcome {
    const validated = runOutcomeSchema.parse({
      completed_at: new Date().toISOString(),
      ...outcome,
    });
    this.finalOutcome = validated;
    return validated;
  }

  // ── Verification Lifecycle Helpers ────────────────────────────────────────

  public readonly verification = {
    startTest: (
      suite: string,
      name: string,
      options?: { stepId?: string; attempt?: number; environment?: string }
    ) => {
      const testId = `test_${this.runId}_${this.testResults.length}`;
      const startedAt = new Date().toISOString();
      const startMs = Date.now();
      const stepId = options?.stepId ?? this.activeStepStack[this.activeStepStack.length - 1]?.step_id;

      this.recordVerification({
        event_id: `vevt_${this.runId}_${this.verificationCounter}`,
        event_type: "test.started",
        target_type: "test",
        target_id: testId,
        status: "STARTED",
        actor: "test_runner",
        started_at: startedAt,
        step_id: stepId,
        evidence_refs: [],
        artifact_refs: [],
      });

      return {
        testId,
        pass: (passOptions?: { durationMs?: number; artifactRefs?: string[] }): TestResult => {
          const completedAt = new Date().toISOString();
          const durationMs = passOptions?.durationMs ?? Math.max(0, Date.now() - startMs);
          const artifactRefs = passOptions?.artifactRefs ?? [];

          const testResult = this.recordTestResult({
            test_id: testId,
            step_id: stepId,
            suite,
            name,
            status: "PASSED",
            duration_ms: durationMs,
            attempt: options?.attempt ?? 1,
            environment: options?.environment,
            artifact_refs: artifactRefs,
            started_at: startedAt,
            completed_at: completedAt,
          });

          this.recordVerification({
            event_id: `vevt_${this.runId}_${this.verificationCounter}`,
            event_type: "test.passed",
            target_type: "test",
            target_id: testId,
            status: "PASSED",
            actor: "test_runner",
            started_at: startedAt,
            completed_at: completedAt,
            duration_ms: durationMs,
            evidence_refs: [testId],
            artifact_refs: artifactRefs,
            step_id: stepId,
          });

          return testResult;
        },
        fail: (failOptions?: {
          failureMessage?: string;
          durationMs?: number;
          stdoutRef?: string;
          stderrRef?: string;
          artifactRefs?: string[];
        }): TestResult => {
          const completedAt = new Date().toISOString();
          const durationMs = failOptions?.durationMs ?? Math.max(0, Date.now() - startMs);
          const artifactRefs = failOptions?.artifactRefs ?? [];

          const testResult = this.recordTestResult({
            test_id: testId,
            step_id: stepId,
            suite,
            name,
            status: "FAILED",
            duration_ms: durationMs,
            attempt: options?.attempt ?? 1,
            environment: options?.environment,
            artifact_refs: artifactRefs,
            stdout_ref: failOptions?.stdoutRef,
            stderr_ref: failOptions?.stderrRef,
            failure_message: failOptions?.failureMessage,
            started_at: startedAt,
            completed_at: completedAt,
          });

          this.recordVerification({
            event_id: `vevt_${this.runId}_${this.verificationCounter}`,
            event_type: "test.failed",
            target_type: "test",
            target_id: testId,
            status: "FAILED",
            actor: "test_runner",
            started_at: startedAt,
            completed_at: completedAt,
            duration_ms: durationMs,
            evidence_refs: [testId],
            artifact_refs: artifactRefs,
            step_id: stepId,
            details: failOptions?.failureMessage ? { message: failOptions.failureMessage } : undefined,
          });

          return testResult;
        },
      };
    },

    startReview: (
      reviewType: ReviewType,
      reviewer: string,
      options?: { stepId?: string }
    ) => {
      const reviewId = `rev_${this.runId}_${this.reviewResults.length}`;
      const startedAt = new Date().toISOString();
      const stepId = options?.stepId ?? this.activeStepStack[this.activeStepStack.length - 1]?.step_id;

      this.recordVerification({
        event_id: `vevt_${this.runId}_${this.verificationCounter}`,
        event_type: "review.started",
        target_type: "review",
        target_id: reviewId,
        status: "STARTED",
        actor: reviewer,
        started_at: startedAt,
        step_id: stepId,
        evidence_refs: [],
        artifact_refs: [],
      });

      return {
        reviewId,
        pass: (passOptions?: {
          findings?: ReviewFinding[];
          artifactRefs?: string[];
          evidenceRefs?: string[];
        }): ReviewResult => {
          const review = this.recordReview({
            review_id: reviewId,
            step_id: stepId,
            review_type: reviewType,
            reviewer,
            status: "PASSED",
            findings: passOptions?.findings ?? [],
            artifact_refs: passOptions?.artifactRefs ?? [],
            evidence_refs: passOptions?.evidenceRefs ?? [],
            created_at: new Date().toISOString(),
          });

          this.recordVerification({
            event_id: `vevt_${this.runId}_${this.verificationCounter}`,
            event_type: "review.passed",
            target_type: "review",
            target_id: reviewId,
            status: "PASSED",
            actor: reviewer,
            step_id: stepId,
            evidence_refs: [reviewId],
            artifact_refs: passOptions?.artifactRefs ?? [],
          });

          return review;
        },
        fail: (failOptions?: {
          findings?: ReviewFinding[];
          artifactRefs?: string[];
          evidenceRefs?: string[];
        }): ReviewResult => {
          const review = this.recordReview({
            review_id: reviewId,
            step_id: stepId,
            review_type: reviewType,
            reviewer,
            status: "FAILED",
            findings: failOptions?.findings ?? [],
            artifact_refs: failOptions?.artifactRefs ?? [],
            evidence_refs: failOptions?.evidenceRefs ?? [],
            created_at: new Date().toISOString(),
          });

          this.recordVerification({
            event_id: `vevt_${this.runId}_${this.verificationCounter}`,
            event_type: "review.failed",
            target_type: "review",
            target_id: reviewId,
            status: "FAILED",
            actor: reviewer,
            step_id: stepId,
            evidence_refs: [reviewId],
            artifact_refs: failOptions?.artifactRefs ?? [],
          });

          return review;
        },
      };
    },
  };

  // ── Finish & Flush ────────────────────────────────────────────────────────

  async finishRun(options: FinishRunOptions = {}): Promise<RunArtifact> {
    if (this.isFinished) {
      throw new Error(`Run ${this.runId} has already been finished.`);
    }
    this.isFinished = true;

    const completedAt = new Date().toISOString();
    const durationMs = Math.max(0, new Date(completedAt).getTime() - new Date(this.startedAt).getTime());

    // Calculate totals
    let totalCost = 0;
    let totalTokens = 0;
    for (const m of this.models) {
      if (m.cost_usd) totalCost += m.cost_usd;
      if (m.total_tokens) totalTokens += m.total_tokens;
    }

    const artifact: RunArtifact = {
      schema_version: CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION,
      identity: {
        run_id: this.runId,
        project_id: this.projectId,
        project_name: this.projectName,
        workflow_id: this.workflowId,
        created_at: this.startedAt,
      },
      execution: {
        status: options.status ?? "completed",
        started_at: this.startedAt,
        completed_at: completedAt,
        duration_ms: durationMs,
        summary: options.summary ?? `Executed workflow ${this.workflowId}`,
        error: options.error,
      },
      environment: {
        runtime: "node",
        runtime_version: process.version,
        sdk_version: "1.0.0",
      },
      trajectory: this.steps,
      boundaries: this.boundaries,
      external_calls: [],
      state: this.stateSnapshots,
      checkpoints: this.checkpoints,
      context: this.contexts,
      memory: {
        operations: this.memories,
        references: [],
      },
      tools: this.tools,
      retrieval: this.retrievals,
      models: this.models,
      artifacts: [],
      evals: [],
      lineage: {
        checkpoint_reference: this.checkpoints[0],
        mutations: [],
      },
      provenance: {
        capture_method: "sdk_trace",
        adapter_version: "1.0.0-canonical",
        captured_by: "ReeprovCaptureSDK",
        redaction_verified: true,
      },
      safety: {
        approval_status: "not_required",
        approval_records: [],
        redaction_summary: {
          total_redactions: this.boundaries.reduce(
            (acc, b) => acc + (b.redaction_metadata?.fields_redacted.length ?? 0),
            0
          ),
          secrets_detected: this.boundaries.filter(
            (b) => b.redaction_status !== "none" && b.redaction_status !== "unverified"
          ).length,
          fields_redacted: [],
        },
      },
      observability: {
        total_duration_ms: durationMs,
        total_cost_usd: totalCost,
        model_calls_count: this.models.length,
        tool_calls_count: this.tools.length,
        evals_passed: 0,
        evals_failed: 0,
        trace_event_count: this.steps.length,
        context_snapshot_count: this.contexts.length,
        memory_operations_count: this.memories.length,
        retrieval_operations_count: this.retrievals.length,
        total_tokens: totalTokens,
      },
      replay: {
        overall_replayability:
          this.boundaries.every((b) => b.replayability === "REPLAYABLE_RECORDED")
            ? "REPLAYABLE_RECORDED"
            : this.boundaries.some((b) => b.replayability === "SIDE_EFFECT_GATED")
              ? "SIDE_EFFECT_GATED"
              : "UNKNOWN",
        unsupported_boundaries_count: 0,
        side_effect_gated_count: this.boundaries.filter(
          (b) => b.replayability === "SIDE_EFFECT_GATED"
        ).length,
        deterministic: false,
        sandboxed_available: false,
        missing_recordings: [],
        notes: [],
      },
      configuration_snapshot: this.configurationSnapshot,
      evidence:
        this.plan ||
        this.verificationEvents.length > 0 ||
        this.testResults.length > 0 ||
        this.reviewResults.length > 0 ||
        this.approvalEvents.length > 0 ||
        this.securityEvents.length > 0 ||
        this.finalOutcome
          ? {
              plan: this.plan,
              verification_events: this.verificationEvents,
              test_results: this.testResults,
              review_results: this.reviewResults,
              approval_events: this.approvalEvents,
              security_events: this.securityEvents,
              final_outcome: this.finalOutcome,
            }
          : undefined,
    };

    // Apply capture policy to assembled sidecars and run-level evidence before
    // either returning the artifact or sending it to persistence.
    if (this.policy.contentMode === "STRUCTURE_ONLY") {
      artifact.execution.summary = "[CONTENT_OMITTED]";
      artifact.execution.error = undefined;
      artifact.trajectory = artifact.trajectory.map((step) => ({
        ...step, name: "[CONTENT_OMITTED]", input_summary: undefined,
        output_summary: undefined, error: undefined, metadata: undefined,
      }));
      artifact.configuration_snapshot = undefined;
      artifact.evidence = undefined;
      artifact.checkpoints = artifact.checkpoints.map((checkpoint) => ({
        ...checkpoint, restorable: false, metadata: undefined,
      }));
    }
    const safeArtifact = sanitizeCanonicalRecord(artifact, this.policy);

    // Integrity validation
    const integrityReport = validateExecutionIntegrity(safeArtifact);
    if (!integrityReport.valid) {
      if (this.strict) {
        throw new ExecutionIntegrityError(integrityReport.errors);
      }
      console.warn("[Reeprov Execution Integrity Warning]", integrityReport.errors);
    }

    // Persist
    await saveCanonicalRun(safeArtifact);
    return safeArtifact;
  }

  private handleCaptureError(source: string, err: unknown): void {
    if (this.strict) {
      throw err;
    }
    console.warn(`[Reeprov Capture Warning] ${source} failed:`, err);
  }
}

export class ReeprovCaptureService {
  startRun(options: StartRunOptions): CaptureSession {
    return new CaptureSession(options);
  }

  async withRun<T>(
    options: StartRunOptions,
    fn: (session: CaptureSession) => Promise<T>
  ): Promise<{ result: T; artifact: RunArtifact }> {
    const session = this.startRun(options);
    try {
      const result = await fn(session);
      const artifact = await session.finishRun({ status: "completed" });
      return { result, artifact };
    } catch (err) {
      const artifact = await session.finishRun({
        status: "failed",
        error: { message: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  }

  /**
   * Loads a canonical run artifact by ID or returns the artifact directly.
   */
  async loadRun(runOrId: string | RunArtifact): Promise<RunArtifact | null> {
    if (typeof runOrId === "string") {
      return getCanonicalRun(runOrId);
    }
    return runOrId;
  }

  /**
   * Replays a captured run artifact offline using deterministic boundary substitution.
   */
  async replay(
    runOrId: string | RunArtifact,
    options?: ReplayOptions
  ): Promise<ReplaySession> {
    const artifact = typeof runOrId === "string" ? await getCanonicalRun(runOrId) : runOrId;
    if (!artifact) {
      throw new Error(`RunArtifact not found: ${String(runOrId)}`);
    }
    return new ReplaySession(artifact, options);
  }
}

export interface ReplayOptions {
  mode?: ReplayMode;
  replayId?: string;
  verifyBlobs?: boolean;
}

export class ReplaySession {
  public readonly mode: ReplayMode;
  public readonly replayId: string;
  public readonly sourceRun: RunArtifact;
  private readonly resolver: BoundaryResolver;
  private readonly divergenceDetector: DivergenceDetector;
  private readonly networkGuard = new NetworkKillSwitch();
  private readonly restorer: StateRestorer;
  private state: Record<string, unknown> = {};
  private activeStepIndex = 0;
  private readonly startedAt: string;
  private isFinished = false;
  private readonly events: ReplayEvent[] = [];

  constructor(sourceRun: RunArtifact, options: ReplayOptions = {}) {
    this.sourceRun = sourceRun;
    this.mode = options.mode ?? "STRICT_OFFLINE";
    this.replayId = options.replayId ?? `replay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.startedAt = new Date().toISOString();
    this.resolver = new BoundaryResolver(sourceRun, { strict: this.mode === "STRICT_OFFLINE" });
    this.divergenceDetector = new DivergenceDetector(this.replayId, sourceRun.identity.run_id);
    this.restorer = new StateRestorer(sourceRun);
    const restored = this.restorer.restoreInitialState();
    this.state = restored.state;
    if (this.mode === "STRICT_OFFLINE") {
      this.networkGuard.activate();
    }
  }

  getState<T extends Record<string, unknown>>(): T {
    return { ...this.state } as T;
  }

  async step<T>(
    name: string,
    _stepType: ExecutionStepType,
    fn: (stepId: string) => Promise<T>
  ): Promise<T> {
    const currentStepIndex = this.activeStepIndex++;
    const stepId = `step_${this.replayId}_${currentStepIndex}`;
    const expectedStep = this.sourceRun.trajectory?.[currentStepIndex];
    if (expectedStep) {
      this.divergenceDetector.checkStep(expectedStep.step_index, expectedStep.name, currentStepIndex, name);
    }
    const result = await fn(stepId);
    return result;
  }

  wrapModel<TInput, TOutput>(
    _modelFn: (input: TInput) => Promise<TOutput>,
    options: {
      provider: string;
      model: string;
      promptExtractor?: (input: TInput) => string;
      stepId?: string;
      nodeId?: string;
    }
  ): (input: TInput) => Promise<TOutput> {
    return async (input: TInput): Promise<TOutput> => {
      const prompt = options.promptExtractor
        ? options.promptExtractor(input)
        : typeof input === "string"
          ? input
          : JSON.stringify(input);

      const boundaryInput = {
        model: options.model,
        provider: options.provider,
        prompt,
      };

      const res = await this.resolver.resolve({
        expectedType: "model_call",
        name: `${options.provider}/${options.model}`,
        dependencyIdentity: `${options.provider}:${options.model}`,
        input: boundaryInput,
      });

      return res.output as TOutput;
    };
  }

  wrapTool<TArgs, TResult>(
    _toolFn: (args: TArgs) => Promise<TResult> | TResult,
    options: {
      name: string;
      permissionClass?: SideEffectClass;
      stepId?: string;
      nodeId?: string;
    }
  ): (args: TArgs) => Promise<TResult> {
    return async (args: TArgs): Promise<TResult> => {
      const res = await this.resolver.resolve({
        expectedType: "tool_call",
        name: options.name,
        dependencyIdentity: `tool:${options.name}`,
        input: args,
        sideEffectIntent: "substitute_recorded",
      });

      return res.output as TResult;
    };
  }

  wrapRetrieval<TInput, TOutput>(
    _retrievalFn: (input: TInput) => Promise<TOutput>,
    options: {
      serviceName: string;
      queryExtractor: (input: TInput) => string;
      stepId?: string;
      nodeId?: string;
    }
  ): (input: TInput) => Promise<TOutput> {
    return async (input: TInput): Promise<TOutput> => {
      const query = options.queryExtractor(input);
      const res = await this.resolver.resolve({
        expectedType: "retrieval_call",
        name: `${options.serviceName}:search`,
        dependencyIdentity: `retrieval:${options.serviceName}`,
        input: { query },
      });

      const outputAny = res.output as Record<string, unknown> | null;
      if (outputAny && typeof outputAny === "object" && "results" in outputAny) {
        return outputAny.results as TOutput;
      }
      return res.output as TOutput;
    };
  }

  async finishReplay(finalOutput?: unknown): Promise<ReplayResult> {
    if (this.isFinished) {
      throw new Error("ReplaySession has already finished");
    }
    this.isFinished = true;
    if (this.mode === "STRICT_OFFLINE") {
      this.networkGuard.deactivate();
    }

    if (this.resolver.hasRemaining()) {
      const next = this.resolver.peekNext();
      this.divergenceDetector.recordDivergence({
        type: "MISSING_BOUNDARY",
        message: `Replay finished without executing recorded boundary '${next?.name}' at sequence index ${this.resolver.getCursor()}.`,
        boundarySequence: this.resolver.getCursor(),
        expected: { boundary: next?.name, type: next?.boundary_type },
      });
    }

    const completedAt = new Date().toISOString();
    const divergences = this.divergenceDetector.getDivergences();
    const status: ReplayStatus = divergences.length === 0 ? "MATCHED" : "DIVERGED";
    const finalOutputHash = finalOutput !== undefined ? hashPayload(finalOutput) : undefined;

    const result: ReplayResult = {
      replay_id: this.replayId,
      source_run_id: this.sourceRun.identity.run_id,
      replay_of: this.sourceRun.identity.run_id,
      status,
      mode: this.mode,
      started_at: this.startedAt,
      completed_at: completedAt,
      steps_expected: this.sourceRun.trajectory?.length ?? 0,
      steps_executed: this.activeStepIndex,
      boundaries_expected: this.sourceRun.boundaries?.length ?? 0,
      boundaries_substituted: this.resolver.getSubstitutedCount(),
      live_calls_attempted: 0,
      live_calls_blocked: 0,
      divergences,
      final_output: finalOutput,
      final_output_hash: finalOutputHash,
      deterministic_match: status === "MATCHED",
      limitations: [],
      replay_events: this.events,
    };

    await saveReplayResult(result);
    return result;
  }
}

/** Legacy class alias for backward compatibility */
export const AgentPulseCaptureService = ReeprovCaptureService;

export const reeprov = new ReeprovCaptureService();
/** Legacy instance alias for backward compatibility */
export const agentpulse = reeprov;

