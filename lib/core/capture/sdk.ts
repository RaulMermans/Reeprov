/**
 * AgentPulse TypeScript Capture SDK.
 *
 * Lightweight, non-intrusive runtime instrumentation layer.
 *
 * Invariants:
 * - Capture failure never crashes the host agent (fails safe by default).
 * - Transparent wrappers preserve target return values and execution semantics.
 * - Explicit flush and run completion semantics.
 */

import { CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION, type RunArtifact } from "../contracts/runArtifact";
import type { ExecutionBoundary, SideEffectClass } from "../contracts/replay";
import type { ExecutionStep, ExecutionStepType } from "../contracts/execution";
import type { ModelInvocation } from "../contracts/models";
import type { ToolInvocation } from "../contracts/tools";
import type { RetrievalOperation } from "../contracts/retrieval";
import type { MemoryOperation } from "../contracts/memory";
import type { ContextSnapshot } from "../contracts/context";
import { captureModelInvocation } from "./adapters/modelCapture";
import { captureToolInvocation } from "./adapters/toolCapture";
import { captureRetrievalOperation } from "./adapters/retrievalCapture";
import { captureMemoryOperation } from "./adapters/memoryCapture";
import { captureHttpCall } from "./adapters/httpCapture";
import { saveCanonicalRun } from "./persistence";
import { resolvePolicy } from "./policy";
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
  private stepCounter = 0;
  private boundaryCounter = 0;
  private isFinished = false;

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
    let status: ExecutionStep["status"] = "completed";
    let error: string | undefined;

    try {
      const result = await fn(stepId);
      return result;
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      const completedAt = new Date().toISOString();
      const durationMs = Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());

      this.steps.push({
        step_id: stepId,
        step_index: stepIndex,
        step_type: stepType,
        name,
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: durationMs,
        status,
        error,
        boundary_ids: [],
        tool_invocation_ids: [],
        model_invocation_ids: [],
        memory_operation_ids: [],
        retrieval_operation_ids: [],
        eval_result_ids: [],
        artifact_ids: [],
      });
    }
  }

  // ── Direct Boundary Capture ───────────────────────────────────────────────

  async captureModel(input: Omit<ModelCaptureInput, "runId">): Promise<ModelCaptureResult | null> {
    try {
      const res = await captureModelInvocation(
        { ...input, runId: this.runId },
        this.policy
      );
      this.boundaries.push(res.boundary);
      this.models.push(res.modelInvocation);
      if (res.contextSnapshot) {
        this.contexts.push(res.contextSnapshot);
      }
      return res;
    } catch (err) {
      this.handleCaptureError("captureModel", err);
      return null;
    }
  }

  async captureTool(input: Omit<ToolCaptureInput, "runId">): Promise<ToolCaptureResult | null> {
    try {
      const res = await captureToolInvocation(
        { ...input, runId: this.runId },
        this.policy
      );
      this.boundaries.push(res.boundary);
      this.tools.push(res.toolInvocation);
      return res;
    } catch (err) {
      this.handleCaptureError("captureTool", err);
      return null;
    }
  }

  async captureRetrieval(input: Omit<RetrievalCaptureInput, "runId">): Promise<RetrievalCaptureResult | null> {
    try {
      const res = await captureRetrievalOperation(
        { ...input, runId: this.runId },
        this.policy
      );
      this.boundaries.push(res.boundary);
      this.retrievals.push(res.retrievalOperation);
      return res;
    } catch (err) {
      this.handleCaptureError("captureRetrieval", err);
      return null;
    }
  }

  async captureMemory(input: Omit<MemoryCaptureInput, "runId">): Promise<MemoryCaptureResult | null> {
    try {
      const res = await captureMemoryOperation(
        { ...input, runId: this.runId },
        this.policy
      );
      this.boundaries.push(res.boundary);
      this.memories.push(res.memoryOperation);
      return res;
    } catch (err) {
      this.handleCaptureError("captureMemory", err);
      return null;
    }
  }

  async captureHttp(input: Omit<HttpCaptureInput, "runId">): Promise<HttpCaptureResult | null> {
    try {
      const res = await captureHttpCall(
        { ...input, runId: this.runId },
        this.policy
      );
      this.boundaries.push(res.boundary);
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
      state: [],
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
        mutations: [],
      },
      provenance: {
        capture_method: "sdk_trace",
        adapter_version: "1.0.0-canonical",
        captured_by: "AgentPulseCaptureSDK",
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
    };

    // Persist
    await saveCanonicalRun(artifact);
    return artifact;
  }

  private handleCaptureError(source: string, err: unknown): void {
    if (this.strict) {
      throw err;
    }
    console.warn(`[AgentPulse Capture Warning] ${source} failed:`, err);
  }
}

export class AgentPulseCaptureService {
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
}

export const agentpulse = new AgentPulseCaptureService();
