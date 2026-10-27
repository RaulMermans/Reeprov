/**
 * @reeprov/client — ReeprovClient
 *
 * Standalone TypeScript HTTP client for Reeprov.
 * Communicates strictly over standard HTTP APIs.
 */

import type {
  ArtifactCreatedInput,
  BoundaryCaptureInput,
  CheckpointAck,
  CheckpointObservedInput,
  CheckpointSavedInput,
  IngestAck,
  RecordResult,
  RegisterCheckpointInput,
  CompleteRunInput,
  EmitEventsResult,
  EvalCompletedInput,
  FailRunInput,
  ModelCallInput,
  ReeprovClientOptions,
  StartRunInput,
  StartRunResult,
  ToolCallInput,
  TraceEvent,
} from "./types.js";
import { canonicalSha256 } from "./hash.js";

export const SDK_NAME = "@reeprov/client";
export const SDK_VERSION = "0.2.0-beta.1";

export class ReeprovError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly isRetryable: boolean = false,
  ) {
    super(message);
    this.name = "ReeprovError";
  }
}

/** Legacy alias */
export const AgentPulseError = ReeprovError;

/** Thrown (when failOpen is false) if Reeprov did not confirm every record. */
export class ReeprovIngestError extends ReeprovError {
  constructor(message: string, public readonly ack: IngestAck | CheckpointAck) {
    super(message, ack.httpStatus, false);
    this.name = "ReeprovIngestError";
  }
}

interface HttpResult {
  status: number;
  body: unknown;
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

declare const process: { env?: Record<string, string | undefined> } | undefined;

function getEnv(key: string): string | undefined {
  if (typeof process !== "undefined" && process?.env) {
    return process.env[key];
  }
  return undefined;
}

export class ReeprovClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly defaultProjectId: string;
  private readonly defaultProjectName: string;
  private readonly defaultWorkflowId: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly failOpen: boolean;
  private readonly enabled: boolean;
  /** Next client-assigned boundary sequence per run. */
  private readonly nextSequence = new Map<string, number>();
  /** Sequences the server confirmed per run (stored or duplicate). */
  private readonly confirmedSequences = new Map<string, Set<number>>();

  constructor(options: ReeprovClientOptions = {}) {
    const rawEndpoint =
      options.url ||
      options.endpoint ||
      getEnv("REEPROV_URL") ||
      getEnv("AGENTPULSE_URL") ||
      "http://127.0.0.1:3000";
    this.endpoint = rawEndpoint.replace(/\/+$/, "");
    this.apiKey =
      options.ingestKey ||
      options.apiKey ||
      getEnv("REEPROV_INGEST_KEY") ||
      getEnv("AGENTPULSE_INGEST_KEY") ||
      "";
    this.defaultProjectId =
      options.projectId ||
      getEnv("REEPROV_PROJECT_ID") ||
      getEnv("AGENTPULSE_PROJECT_ID") ||
      "default-project";
    this.defaultProjectName =
      options.projectName ||
      getEnv("REEPROV_PROJECT_NAME") ||
      getEnv("AGENTPULSE_PROJECT_NAME") ||
      "Default Project";
    this.defaultWorkflowId =
      options.workflowId ||
      getEnv("REEPROV_WORKFLOW_ID") ||
      getEnv("AGENTPULSE_WORKFLOW_ID") ||
      "default-workflow";
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.failOpen =
      options.failOpen ??
      ((getEnv("REEPROV_FAIL_OPEN") ?? getEnv("AGENTPULSE_FAIL_OPEN")) !== "false");

    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
    } else {
      const envEnabled = getEnv("REEPROV_ENABLED") ?? getEnv("AGENTPULSE_ENABLED");
      if (envEnabled !== undefined) {
        this.enabled = envEnabled.toLowerCase() === "true";
      } else {
        this.enabled = Boolean(this.apiKey);
      }
    }
  }

  public get isEnabled(): boolean {
    return this.enabled;
  }

  // ── Run Lifecycle ────────────────────────────────────────────────────────────

  public async startRun(input: StartRunInput): Promise<StartRunResult> {
    const runId = input.run_id || `${this.defaultProjectId}-${randomId()}`;
    const local: StartRunResult = {
      run_id: runId,
      workflow_id: input.workflowId ?? this.defaultWorkflowId,
      project_id: input.projectId ?? this.defaultProjectId,
      project_name: input.projectName ?? this.defaultProjectName,
      status: "running",
      started_at: new Date().toISOString(),
      summary: input.summary,
    };
    if (!this.enabled) {
      return { ...local, run_id: input.run_id || `noop-${Math.random().toString(36).slice(2, 10)}` };
    }

    const payload = {
      project_id: local.project_id,
      project_name: local.project_name,
      workflow_id: local.workflow_id,
      summary: input.summary,
      run_id: runId,
      sdk: { name: SDK_NAME, version: SDK_VERSION },
      ...(input.contentMode ? { capture_policy: { content_mode: input.contentMode } } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };

    // run_id is client-assigned, so a retried start is idempotent server-side.
    const res = await this.post("/api/runs/start", payload);
    if (res && res.status >= 200 && res.status < 300) return res.body as StartRunResult;
    const error = new ReeprovError(
      `Reeprov did not confirm run start (${res ? `HTTP ${res.status}: ${describeBody(res.body)}` : "unreachable"}).`,
      res?.status,
      !res,
    );
    if (this.failOpen) {
      console.warn(`[Reeprov] ${error.message} Evidence for run ${runId} may be incomplete.`);
      return { ...local, status: "unconfirmed" };
    }
    throw error;
  }

  public async completeRun(input: CompleteRunInput): Promise<IngestAck> {
    return this.lifecycle("/api/runs/complete", input, "run completion");
  }

  public async failRun(input: FailRunInput): Promise<IngestAck> {
    return this.lifecycle("/api/runs/fail", input, "run failure");
  }

  private async lifecycle(path: string, body: unknown, kind: string): Promise<IngestAck> {
    if (!this.enabled) return disabledAck();
    const res = await this.post(path, body);
    const ok = Boolean(res && res.status >= 200 && res.status < 300);
    const ack: IngestAck = {
      ok,
      delivery: res ? "acknowledged" : "unreachable",
      httpStatus: res?.status,
      accepted: ok ? 1 : 0,
      duplicates: 0,
      rejected: ok ? 0 : 1,
      results: [],
      errors: ok ? [] : [res ? `HTTP ${res.status}: ${describeBody(res.body)}` : "unreachable"],
    };
    return this.settle(kind, ack);
  }

  // ── Trace Events ─────────────────────────────────────────────────────────────

  public async emitTraceEvent(event: TraceEvent): Promise<IngestAck> {
    return this.emitTraceEvents([event]);
  }

  public async emitTraceEvents(events: TraceEvent[]): Promise<IngestAck> {
    if (!this.enabled || events.length === 0) return disabledAck();
    return this.settle("trace event", toAck(await this.post("/api/traces/events", { events }), events.length));
  }

  // ── Semantic Helpers ─────────────────────────────────────────────────────────

  public async modelCallCompleted(input: ModelCallInput): Promise<IngestAck> {
    if (!this.enabled) return disabledAck();
    const now = new Date().toISOString();
    const event: TraceEvent = {
      event_id: `evt-${Math.random().toString(36).slice(2, 10)}`,
      run_id: input.run_id,
      workflow_id: this.defaultWorkflowId,
      timestamp: now,
      event_type: "model_call_completed",
      status: "completed",
      node_id: input.node_id,
      cost_usd: input.cost_usd,
      duration_ms: input.duration_ms,
      input_summary: input.prompt ? input.prompt.slice(0, 500) : undefined,
      metadata: {
        model: input.model,
        provider: input.provider,
        input_tokens: input.input_tokens,
        output_tokens: input.output_tokens,
        ...input.metadata,
      },
    };
    const eventAck = await this.emitTraceEvent(event);

    const boundaryAck = await this.captureBoundary(input.run_id, {
      boundaryType: "model_call",
      name: `${input.provider}/${input.model}`,
      nodeId: input.node_id,
      stepId: input.step_id,
      durationMs: input.duration_ms,
      input: {
        model: input.model,
        provider: input.provider,
        prompt: input.prompt,
        messages: input.messages,
      },
      output: input.response,
      declaredSideEffectClass: "read_only",
      metadata: input.metadata,
    });
    return mergeAcks(eventAck, boundaryAck);
  }

  public async toolCallCompleted(input: ToolCallInput): Promise<IngestAck> {
    if (!this.enabled) return disabledAck();
    const now = new Date().toISOString();
    const event: TraceEvent = {
      event_id: `evt-${Math.random().toString(36).slice(2, 10)}`,
      run_id: input.run_id,
      workflow_id: this.defaultWorkflowId,
      timestamp: now,
      event_type: "tool_call_completed",
      status: input.error ? "failed" : "completed",
      node_id: input.node_id,
      duration_ms: input.duration_ms,
      error_message: input.error,
      metadata: {
        tool_name: input.tool_name,
        permission_class: input.permission_class ?? "read_only",
        ...input.metadata,
      },
    };
    const eventAck = await this.emitTraceEvent(event);

    const boundaryAck = await this.captureBoundary(input.run_id, {
      boundaryType: "tool_call",
      name: input.tool_name,
      nodeId: input.node_id,
      stepId: input.step_id,
      durationMs: input.duration_ms,
      input: input.arguments,
      output: input.output,
      error: input.error ? { message: input.error } : undefined,
      declaredSideEffectClass: input.permission_class ?? "read_only",
      metadata: input.metadata,
    });
    return mergeAcks(eventAck, boundaryAck);
  }

  public async evalCompleted(input: EvalCompletedInput): Promise<IngestAck> {
    if (!this.enabled) return disabledAck();
    const now = new Date().toISOString();
    const event: TraceEvent = {
      event_id: `${input.run_id}::eval::${input.eval_id ?? input.eval_name}`,
      run_id: input.run_id,
      workflow_id: this.defaultWorkflowId,
      timestamp: now,
      event_type: "eval_completed",
      status: input.passed ? "completed" : "failed",
      node_id: input.node_id,
      metadata: {
        ...input.metadata,
        eval_id: input.eval_id ?? input.eval_name,
        eval_name: input.eval_name,
        passed: input.passed,
        score: input.score,
        reason: input.reason,
      },
    };
    return this.emitTraceEvent(event);
  }

  public async artifactCreated(input: ArtifactCreatedInput): Promise<IngestAck> {
    if (!this.enabled) return disabledAck();
    const now = new Date().toISOString();
    const event: TraceEvent = {
      event_id: `evt-${Math.random().toString(36).slice(2, 10)}`,
      run_id: input.run_id,
      workflow_id: this.defaultWorkflowId,
      timestamp: now,
      event_type: "artifact_created",
      status: "completed",
      node_id: input.node_id,
      output_summary: input.summary,
      metadata: {
        artifact_ref: input.artifact_ref,
        artifact_type: input.artifact_type,
        ...input.metadata,
      },
    };
    return this.emitTraceEvent(event);
  }

  // ── Checkpoints ──────────────────────────────────────────────────────────────

  /**
   * Checkpoint observation: records that the agent reached a checkpoint.
   * It is never restorable and never becomes an execution boundary.
   */
  public async checkpointObserved(input: CheckpointObservedInput): Promise<CheckpointAck> {
    if (!this.enabled) return { ok: true, delivery: "disabled", status: "NOT_SENT" };
    return this.checkpointRequest(input.run_id, {
      kind: "observe",
      checkpoint_id: input.checkpoint_id,
      step_id: input.step_id,
      node_id: input.node_id,
      state: input.state,
      metadata: input.metadata,
    });
  }

  /** @deprecated Records an observation only. Use checkpointObserved() or registerCheckpoint(). */
  public async checkpointSaved(input: CheckpointSavedInput): Promise<CheckpointAck> {
    return this.checkpointObserved(input);
  }

  /**
   * Restorable-checkpoint capture. Sends the state snapshot with its
   * canonical hash, the boundary cursor and the resume adapter identity.
   * Reeprov validates the snapshot; it advertises the checkpoint as
   * restorable only after a compatible host resume is verified.
   */
  public async registerCheckpoint(input: RegisterCheckpointInput): Promise<CheckpointAck> {
    if (!this.enabled) return { ok: true, delivery: "disabled", status: "NOT_SENT" };
    return this.checkpointRequest(input.run_id, {
      kind: "register",
      checkpoint_id: input.checkpoint_id,
      step_id: input.step_id,
      step_index: input.step_index,
      position: input.position ?? "AFTER_STEP",
      resume_step_index: input.resume_step_index,
      resume_step_id: input.resume_step_id,
      boundary_cursor: input.boundary_cursor ?? this.confirmedBoundaryCursor(input.run_id),
      state: input.state,
      state_hash: await canonicalSha256(input.state),
      adapter: input.adapter,
      metadata: input.metadata,
    });
  }

  /** Number of contiguous boundaries (from sequence 0) the server confirmed for a run. */
  public confirmedBoundaryCursor(runId: string): number {
    const confirmed = this.confirmedSequences.get(runId) ?? new Set<number>();
    let cursor = 0;
    while (confirmed.has(cursor)) cursor++;
    return cursor;
  }

  private async checkpointRequest(runId: string, body: Record<string, unknown>): Promise<CheckpointAck> {
    const res = await this.post(`/api/runs/${encodeURIComponent(runId)}/checkpoints`, body);
    const data = (res?.body ?? {}) as Partial<CheckpointAck>;
    const status = (data.status ?? "REJECTED") as CheckpointAck["status"];
    const ack: CheckpointAck = {
      ok: Boolean(res) && status !== "REJECTED",
      delivery: res ? "acknowledged" : "unreachable",
      httpStatus: res?.status,
      status,
      code: data.code ?? (res ? undefined : "UNREACHABLE"),
      message: data.message,
      assessment: data.assessment,
    };
    if (!ack.ok) {
      const error = new ReeprovIngestError(
        `Reeprov rejected checkpoint ${String(body["checkpoint_id"])}: ${ack.code ?? "REJECTED"} ${ack.message ?? ""}`.trim(),
        ack,
      );
      if (this.failOpen) console.warn(`[Reeprov] ${error.message}`);
      else throw error;
    }
    return ack;
  }

  // ── Replay-Grade Boundary Capture ──────────────────────────────────────────

  /**
   * Records one boundary with a stable client id and per-run sequence, so a
   * retry is idempotent and two calls can never overwrite each other.
   */
  public async captureBoundary(runId: string, boundary: BoundaryCaptureInput): Promise<IngestAck> {
    if (!this.enabled) return disabledAck();
    let sequenceIndex = boundary.sequenceIndex;
    if (sequenceIndex === undefined) {
      sequenceIndex = this.nextSequence.get(runId) ?? 0;
      this.nextSequence.set(runId, sequenceIndex + 1);
    } else {
      this.nextSequence.set(runId, Math.max(this.nextSequence.get(runId) ?? 0, sequenceIndex + 1));
    }
    const record = {
      runId,
      startedAt: new Date().toISOString(),
      ...boundary,
      sequenceIndex,
      boundaryId: boundary.boundaryId ?? `bnd:${runId}:${sequenceIndex}`,
    };

    const ack = toAck(await this.post("/api/traces/boundaries", { boundaries: [record] }), 1);
    const confirmed = this.confirmedSequences.get(runId) ?? new Set<number>();
    for (const result of ack.results) {
      if ((result.status === "ACCEPTED" || result.status === "DUPLICATE") && result.sequence_index !== undefined) {
        confirmed.add(result.sequence_index);
      }
    }
    this.confirmedSequences.set(runId, confirmed);
    return this.settle("boundary", ack);
  }

  // ── HTTP Ingest Transport ──────────────────────────────────────────────────

  private settle(kind: string, ack: IngestAck): IngestAck {
    if (ack.ok) return ack;
    const error = new ReeprovIngestError(
      `Reeprov did not confirm ${ack.rejected} ${kind} record(s): ${ack.errors.join("; ") || "unknown reason"}`,
      ack,
    );
    if (this.failOpen) console.warn(`[Reeprov] ${error.message}`);
    else throw error;
    return ack;
  }

  /**
   * POSTs JSON. Returns the status and parsed body for any HTTP response
   * (2xx and 4xx bodies carry per-record results), retries network errors
   * and 5xx (safe: records are keyed), and returns undefined if unreachable.
   */
  private async post(path: string, body: unknown): Promise<HttpResult | undefined> {
    const url = `${this.endpoint}${path}`;
    const payload = JSON.stringify(body);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-reeprov-key": this.apiKey,
          },
          body: payload,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (response.status < 500) {
          const contentType = response.headers.get("content-type") ?? "";
          let parsed: unknown = {};
          if (contentType.includes("application/json")) {
            try {
              parsed = await response.json();
            } catch {
              parsed = {};
            }
          }
          return { status: response.status, body: parsed };
        }
        lastError = new ReeprovError(`Reeprov API Error: ${response.status} ${response.statusText}`, response.status, true);
      } catch (err) {
        clearTimeout(timer);
        lastError = err as Error;
      }

      if (attempt < this.maxRetries) {
        const backoffMs = 50 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }

    console.warn(`[Reeprov] Request to ${path} failed after retries: ${lastError?.message}`);
    return undefined;
  }
}

function disabledAck(): IngestAck {
  return { ok: true, delivery: "disabled", accepted: 0, duplicates: 0, rejected: 0, results: [], errors: [] };
}

function describeBody(body: unknown): string {
  const b = (body ?? {}) as { message?: string; code?: string };
  return b.message ?? b.code ?? "no detail";
}

function toAck(res: HttpResult | undefined, recordCount: number): IngestAck {
  if (!res) {
    return {
      ok: false, delivery: "unreachable", accepted: 0, duplicates: 0, rejected: recordCount,
      results: [], errors: ["Reeprov unreachable; records were not confirmed."],
    };
  }
  const body = (res.body ?? {}) as EmitEventsResult;
  if (res.status === 401 || res.status === 403 || typeof body.rejected !== "number") {
    return {
      ok: false, delivery: "acknowledged", httpStatus: res.status, accepted: 0, duplicates: 0, rejected: recordCount,
      results: [], errors: [`HTTP ${res.status}: ${describeBody(res.body)}`],
    };
  }
  const results: RecordResult[] = body.results ?? [];
  const confirmed = (body.accepted ?? 0) + (body.duplicates ?? 0) + (body.observations ?? 0);
  // Older servers omit per-record results; never treat missing records as stored.
  const unaccounted = Math.max(0, recordCount - confirmed - body.rejected);
  const rejected = body.rejected + unaccounted;
  return {
    ok: rejected === 0,
    delivery: "acknowledged",
    httpStatus: res.status,
    accepted: body.accepted ?? 0,
    duplicates: body.duplicates ?? 0,
    rejected,
    results,
    errors: [
      ...(body.errors ?? []).map((e) => e.message),
      ...(unaccounted > 0 ? [`${unaccounted} record(s) were not acknowledged by the server.`] : []),
    ],
  };
}

function mergeAcks(a: IngestAck, b: IngestAck): IngestAck {
  return {
    ok: a.ok && b.ok,
    delivery: a.delivery === "acknowledged" && b.delivery === "acknowledged" ? "acknowledged" : a.delivery === "acknowledged" ? b.delivery : a.delivery,
    httpStatus: b.httpStatus ?? a.httpStatus,
    accepted: a.accepted + b.accepted,
    duplicates: a.duplicates + b.duplicates,
    rejected: a.rejected + b.rejected,
    results: [...a.results, ...b.results],
    errors: [...a.errors, ...b.errors],
  };
}

/** Legacy alias */
export const AgentPulseClient = ReeprovClient;
