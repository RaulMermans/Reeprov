/**
 * @reeprov/client — ReeprovClient
 *
 * Standalone TypeScript HTTP client for Reeprov.
 * Communicates strictly over standard HTTP APIs.
 */

import type {
  AgentPulseClientOptions,
  ArtifactCreatedInput,
  BoundaryCaptureInput,
  CheckpointSavedInput,
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
    if (!this.enabled) {
      const noopId = input.run_id || `noop-${Math.random().toString(36).slice(2, 10)}`;
      return {
        run_id: noopId,
        workflow_id: input.workflowId ?? this.defaultWorkflowId,
        project_id: input.projectId ?? this.defaultProjectId,
        project_name: input.projectName ?? this.defaultProjectName,
        status: "running",
        started_at: new Date().toISOString(),
        summary: input.summary,
      };
    }

    const payload = {
      project_id: input.projectId ?? this.defaultProjectId,
      project_name: input.projectName ?? this.defaultProjectName,
      workflow_id: input.workflowId ?? this.defaultWorkflowId,
      summary: input.summary,
      ...(input.run_id ? { run_id: input.run_id } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };

    return this.post<StartRunResult>("/api/runs/start", payload);
  }

  public async completeRun(input: CompleteRunInput): Promise<void> {
    if (!this.enabled) return;
    await this.post("/api/runs/complete", input);
  }

  public async failRun(input: FailRunInput): Promise<void> {
    if (!this.enabled) return;
    await this.post("/api/runs/fail", input);
  }

  // ── Trace Events ─────────────────────────────────────────────────────────────

  public async emitTraceEvent(event: TraceEvent): Promise<void> {
    await this.emitTraceEvents([event]);
  }

  public async emitTraceEvents(events: TraceEvent[]): Promise<void> {
    if (!this.enabled || events.length === 0) {
      return;
    }
    await this.post("/api/traces/events", { events });
  }

  // ── Semantic Helpers ─────────────────────────────────────────────────────────

  public async modelCallCompleted(input: ModelCallInput): Promise<void> {
    if (!this.enabled) return;
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
    await this.emitTraceEvent(event);

    await this.captureBoundary(input.run_id, {
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
  }

  public async toolCallCompleted(input: ToolCallInput): Promise<void> {
    if (!this.enabled) return;
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
    await this.emitTraceEvent(event);

    await this.captureBoundary(input.run_id, {
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
  }

  public async evalCompleted(input: EvalCompletedInput): Promise<void> {
    if (!this.enabled) return;
    const now = new Date().toISOString();
    const event: TraceEvent = {
      event_id: `evt-${Math.random().toString(36).slice(2, 10)}`,
      run_id: input.run_id,
      workflow_id: this.defaultWorkflowId,
      timestamp: now,
      event_type: "eval_completed",
      status: input.passed ? "completed" : "failed",
      node_id: input.node_id,
      metadata: {
        eval_name: input.eval_name,
        passed: input.passed,
        score: input.score,
        reason: input.reason,
        ...input.metadata,
      },
    };
    await this.emitTraceEvent(event);
  }

  public async artifactCreated(input: ArtifactCreatedInput): Promise<void> {
    if (!this.enabled) return;
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
    await this.emitTraceEvent(event);
  }

  public async checkpointSaved(input: CheckpointSavedInput): Promise<void> {
    if (!this.enabled) return;
    await this.captureBoundary(input.run_id, {
      boundaryType: "checkpoint",
      name: `checkpoint:${input.checkpoint_id}`,
      nodeId: input.node_id,
      stepId: input.step_id,
      output: input.state,
      declaredSideEffectClass: "read_only",
      metadata: {
        checkpoint_id: input.checkpoint_id,
        ...input.metadata,
      },
    });
  }

  // ── Replay-Grade Boundary Capture ──────────────────────────────────────────

  public async captureBoundary(runId: string, boundary: BoundaryCaptureInput): Promise<void> {
    if (!this.enabled) return;
    const payload = {
      boundaries: [
        {
          runId,
          startedAt: new Date().toISOString(),
          ...boundary,
        },
      ],
    };

    try {
      await this.post("/api/traces/boundaries", payload);
    } catch (err) {
      if (this.failOpen) {
        console.warn(`[Reeprov] Non-fatal boundary capture error: ${(err as Error).message}`);
      } else {
        throw err;
      }
    }
  }

  // ── HTTP Ingest Transport ──────────────────────────────────────────────────

  private async post<T = unknown>(path: string, body: unknown): Promise<T> {
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

        if (response.ok) {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            return (await response.json()) as T;
          }
          return {} as T;
        }

        // Fast-fail non-retryable 4xx errors
        if (response.status === 401 || response.status === 403 || (response.status >= 400 && response.status < 500)) {
          let errDetail = `${response.status} ${response.statusText}`;
          try {
            const errData = (await response.json()) as { message?: string };
            if (errData?.message) errDetail = errData.message;
          } catch {
            // ignore json parse error
          }
          const fastFailErr = new ReeprovError(`Reeprov API Error (${response.status}): ${errDetail}`, response.status, false);
          if (this.failOpen) {
            console.warn(`[Reeprov] Non-retryable error: ${fastFailErr.message}`);
            return undefined as T;
          }
          throw fastFailErr;
        }

        // 5xx transient server error
        lastError = new ReeprovError(`Reeprov API Error: ${response.status} ${response.statusText}`, response.status, true);
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof ReeprovError && !err.isRetryable) {
          throw err;
        }
        lastError = err as Error;
      }

      if (attempt < this.maxRetries) {
        const backoffMs = 50 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }

    if (this.failOpen) {
      console.warn(`[Reeprov] Telemetry request to ${path} failed after retries: ${lastError?.message}`);
      return undefined as T;
    }

    throw lastError || new ReeprovError(`Reeprov request failed: ${path}`);
  }
}

/** Legacy alias */
export const AgentPulseClient = ReeprovClient;
