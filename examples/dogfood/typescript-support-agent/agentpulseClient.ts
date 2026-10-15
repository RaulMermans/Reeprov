/**
 * AgentPulse TypeScript Client
 *
 * Copy this file into your project and use it to emit trace events to AgentPulse.
 *
 * Required environment variables:
 *   AGENTPULSE_URL        — base URL of your AgentPulse instance
 *   AGENTPULSE_INGEST_KEY — ingest key (NOT the dashboard access key)
 *   AGENTPULSE_PROJECT_ID — stable project identifier (e.g. "blog-agent")
 *   AGENTPULSE_PROJECT_NAME — human-readable project name (e.g. "Blog Agent")
 *   AGENTPULSE_WORKFLOW_ID — workflow being run (e.g. "blog-agent-v1")
 *   AGENTPULSE_ENABLED    — set to "true" to enable; any other value = no-op
 *
 * No external dependencies required (uses built-in fetch).
 */

// ── Config ────────────────────────────────────────────────────────────────────

function getConfig() {
  return {
    url: process.env["AGENTPULSE_URL"] ?? "",
    ingestKey: process.env["AGENTPULSE_INGEST_KEY"] ?? "",
    projectId: process.env["AGENTPULSE_PROJECT_ID"] ?? "",
    projectName: process.env["AGENTPULSE_PROJECT_NAME"] ?? "",
    workflowId: process.env["AGENTPULSE_WORKFLOW_ID"] ?? "",
    enabled: process.env["AGENTPULSE_ENABLED"] === "true",
  };
}

export interface AgentPulseClientOptions {
  endpoint?: string;
  url?: string;
  ingestKey?: string;
  projectId?: string;
  projectName?: string;
  workflowId?: string;
  enabled?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  failOpen?: boolean;
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── Event types ───────────────────────────────────────────────────────────────

interface BaseEvent {
  event_id: string;
  run_id: string;
  workflow_id: string;
  timestamp: string;
  event_type: string;
  status: string;
  node_id?: string;
  duration_ms?: number;
  cost_usd?: number;
  input_summary?: string;
  output_summary?: string;
  metadata?: Record<string, unknown>;
}

// ── Client ────────────────────────────────────────────────────────────────────

export class AgentPulseClient {
  private cfg: {
    url: string;
    ingestKey: string;
    projectId: string;
    projectName: string;
    workflowId: string;
    enabled: boolean;
    timeoutMs: number;
    maxRetries: number;
    failOpen: boolean;
  };

  constructor(options?: AgentPulseClientOptions) {
    const env = getConfig();
    const explicitUrl = options?.endpoint ?? options?.url;
    const explicitKey = options?.ingestKey;
    this.cfg = {
      url: explicitUrl ?? env.url,
      ingestKey: explicitKey ?? env.ingestKey,
      projectId: options?.projectId ?? env.projectId,
      projectName: options?.projectName ?? env.projectName,
      workflowId: options?.workflowId ?? env.workflowId,
      enabled:
        options?.enabled ??
        (explicitUrl !== undefined || explicitKey !== undefined
          ? true
          : env.enabled),
      timeoutMs: options?.timeoutMs ?? 10000,
      maxRetries: options?.maxRetries ?? 2,
      failOpen: options?.failOpen ?? (process.env["AGENTPULSE_FAIL_OPEN"] !== "false"),
    };
  }

  /** Returns false when AGENTPULSE_ENABLED is not "true" or disabled. */
  get isEnabled(): boolean {
    return this.cfg.enabled;
  }

  /**
   * Start a new run. Returns the run_id to use for subsequent calls.
   * Returns a no-op string when disabled.
   */
  async startRun(opts: {
    summary: string;
    runId?: string;
    projectId?: string;
    projectName?: string;
    workflowId?: string;
  }): Promise<string> {
    if (!this.cfg.enabled) return `noop-${shortId()}`;
    const projectId = opts.projectId ?? this.cfg.projectId;
    const projectName = opts.projectName ?? this.cfg.projectName ?? projectId;
    const workflowId = opts.workflowId ?? this.cfg.workflowId ?? "default-workflow";
    const runId = opts.runId ?? `${projectId || "run"}-${shortId()}`;
    await this.post("/api/runs/start", {
      run_id: runId,
      project_id: projectId,
      project_name: projectName,
      workflow_id: workflowId,
      summary: opts.summary,
    });
    return runId;
  }

  /** Emit one or more raw trace events. */
  async emitTraceEvents(events: BaseEvent[]): Promise<void> {
    if (!this.cfg.enabled || events.length === 0) return;
    await this.post("/api/traces/events", { events });
  }

  /** Emit a single raw trace event. */
  async emitTraceEvent(event: BaseEvent): Promise<void> {
    return this.emitTraceEvents([event]);
  }

  /** Record a completed model call. */
  async modelCallCompleted(
    runId: string,
    opts: {
      nodeId?: string;
      modelProvider?: string;
      modelName?: string;
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      costUsd?: number;
      durationMs?: number;
      inputSummary?: string;
      outputSummary?: string;
    },
  ): Promise<void> {
    if (!this.cfg.enabled) return;
    const now = new Date().toISOString();
    const nodeId = opts.nodeId ?? "agent_model";
    const modelName = opts.modelName ?? opts.model ?? "unknown";
    const modelProvider =
      opts.modelProvider ??
      (opts.model?.startsWith("gpt")
        ? "openai"
        : opts.model?.startsWith("claude")
        ? "anthropic"
        : "custom");
    await this.emitTraceEvents([
      {
        event_id: `${runId}::${nodeId}::model::${shortId()}`,
        run_id: runId,
        workflow_id: this.cfg.workflowId,
        node_id: nodeId,
        timestamp: now,
        event_type: "model_call_completed",
        status: "completed",
        duration_ms: opts.durationMs,
        cost_usd: opts.costUsd ?? 0,
        input_summary: opts.inputSummary,
        output_summary: opts.outputSummary,
        metadata: {
          model_provider: modelProvider,
          model_name: modelName,
          input_tokens: opts.inputTokens ?? 0,
          output_tokens: opts.outputTokens ?? 0,
        },
      },
    ]);
  }

  /** Record a completed tool call. */
  async toolCallCompleted(
    runId: string,
    opts: {
      nodeId?: string;
      toolName: string;
      permissionClass?: string;
      durationMs?: number;
      costUsd?: number;
      inputSummary?: string;
      outputSummary?: string;
    },
  ): Promise<void> {
    if (!this.cfg.enabled) return;
    const nodeId = opts.nodeId ?? "agent_tool";
    const toolCallId = `${runId}::tc::${shortId()}`;
    const now = new Date().toISOString();
    await this.emitTraceEvents([
      {
        event_id: `${runId}::${nodeId}::tool::${shortId()}`,
        run_id: runId,
        workflow_id: this.cfg.workflowId,
        node_id: nodeId,
        timestamp: now,
        event_type: "tool_call_completed",
        status: "completed",
        duration_ms: opts.durationMs,
        cost_usd: opts.costUsd,
        input_summary: opts.inputSummary,
        output_summary: opts.outputSummary,
        metadata: {
          tool_name: opts.toolName,
          tool_call_id: toolCallId,
          permission_class: opts.permissionClass ?? "read_only",
        },
      },
    ]);
  }

  /** Record a completed eval. */
  async evalCompleted(
    runId: string,
    opts: {
      evalId: string;
      evalName: string;
      evalType: string;
      passed: boolean;
      score: number;
      severity?: string;
      nodeId?: string;
      findings?: string[];
      recommendation?: string;
      outputSummary?: string;
    },
  ): Promise<void> {
    if (!this.cfg.enabled) return;
    const now = new Date().toISOString();
    await this.emitTraceEvents([
      {
        event_id: `${runId}::eval::${opts.evalId}`,
        run_id: runId,
        workflow_id: this.cfg.workflowId,
        node_id: opts.nodeId,
        timestamp: now,
        event_type: "eval_completed",
        status: "completed",
        output_summary: opts.outputSummary,
        metadata: {
          eval_id: opts.evalId,
          eval_name: opts.evalName,
          eval_type: opts.evalType,
          passed: opts.passed,
          score: opts.score,
          severity: opts.severity ?? "info",
          findings: opts.findings ?? [],
          recommendation: opts.recommendation,
        },
      },
    ]);
  }

  /** Record an artifact. */
  async artifactCreated(
    runId: string,
    opts: {
      artifactRef: string;
      artifactType?: string;
      nodeId?: string;
      outputSummary?: string;
    },
  ): Promise<void> {
    if (!this.cfg.enabled) return;
    const now = new Date().toISOString();
    await this.emitTraceEvents([
      {
        event_id: `${runId}::artifact::${opts.artifactRef}`,
        run_id: runId,
        workflow_id: this.cfg.workflowId,
        node_id: opts.nodeId,
        timestamp: now,
        event_type: "artifact_created",
        status: "completed",
        output_summary: opts.outputSummary,
        metadata: {
          artifact_ref: opts.artifactRef,
          artifact_type: opts.artifactType ?? "output",
        },
      },
    ]);
  }

  /** Record a state checkpoint for the run. */
  async checkpointSaved(
    runId: string,
    opts: {
      checkpointId: string;
      stepId: string;
      state: Record<string, unknown>;
      snapshotType?: string;
    },
  ): Promise<void> {
    if (!this.cfg.enabled) return;
    const now = new Date().toISOString();
    await this.emitTraceEvents([
      {
        event_id: `${runId}::checkpoint::${opts.checkpointId}`,
        run_id: runId,
        workflow_id: this.cfg.workflowId,
        timestamp: now,
        event_type: "checkpoint_saved",
        status: "completed",
        metadata: {
          checkpoint_id: opts.checkpointId,
          step_id: opts.stepId,
          snapshot_type: opts.snapshotType ?? "STEP_CHECKPOINT",
          state: opts.state,
        },
      },
    ]);
  }

  /** Complete a run. */
  async completeRun(
    runId: string,
    opts: {
      summary?: string;
      totalCostUsd?: number;
      totalDurationMs?: number;
      artifactRefs?: string[];
      checkpoints?: Array<Record<string, unknown>>;
      state?: Array<Record<string, unknown>>;
    } = {},
  ): Promise<void> {
    if (!this.cfg.enabled) return;
    await this.post("/api/runs/complete", {
      run_id: runId,
      ...(opts.summary ? { summary: opts.summary } : {}),
      ...(opts.totalCostUsd !== undefined ? { total_cost_usd: opts.totalCostUsd } : {}),
      ...(opts.totalDurationMs !== undefined ? { total_duration_ms: opts.totalDurationMs } : {}),
      ...(opts.artifactRefs ? { artifact_refs: opts.artifactRefs } : {}),
      ...(opts.checkpoints ? { checkpoints: opts.checkpoints } : {}),
      ...(opts.state ? { state: opts.state } : {}),
    });
  }

  /** Fail a run. */
  async failRun(
    runId: string,
    opts:
      | {
          errorSummary?: string;
          error?: string;
          totalCostUsd?: number;
          totalDurationMs?: number;
          checkpoints?: Array<Record<string, unknown>>;
          state?: Array<Record<string, unknown>>;
        }
      | string,
  ): Promise<void> {
    if (!this.cfg.enabled) return;
    const summary =
      typeof opts === "string"
        ? opts
        : (opts.errorSummary ?? opts.error ?? "Run failed");
    await this.post("/api/runs/fail", {
      run_id: runId,
      error_summary: summary,
      ...(typeof opts !== "string" && opts.totalCostUsd !== undefined
        ? { total_cost_usd: opts.totalCostUsd }
        : {}),
      ...(typeof opts !== "string" && opts.totalDurationMs !== undefined
        ? { total_duration_ms: opts.totalDurationMs }
        : {}),
      ...(typeof opts !== "string" && opts.checkpoints
        ? { checkpoints: opts.checkpoints }
        : {}),
      ...(typeof opts !== "string" && opts.state
        ? { state: opts.state }
        : {}),
    });
  }

  /** Emit a replay-grade execution boundary to AgentPulse. */
  async captureBoundary(
    runId: string,
    boundary: Record<string, unknown>,
  ): Promise<void> {
    if (!this.cfg.enabled) return;
    try {
      await this.post("/api/traces/boundaries", {
        boundaries: [
          {
            runId,
            startedAt: new Date().toISOString(),
            ...boundary,
          },
        ],
      });
    } catch {
      // Non-fatal capture isolation
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async post(path: string, body: unknown): Promise<void> {
    const url = `${this.cfg.url}${path}`;
    const timeoutMs = this.cfg.timeoutMs;
    const maxRetries = this.cfg.maxRetries;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-agentpulse-key": this.cfg.ingestKey,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          const err = new Error(`AgentPulse request failed: ${res.status} ${path} — ${text}`);
          // Non-retryable client errors: 401, 403, or 4xx
          if (res.status === 401 || res.status === 403 || (res.status >= 400 && res.status < 500)) {
            if (this.cfg.failOpen) {
              console.warn(`[AgentPulse] Non-retryable error (${res.status}): ${text || path}`);
              return;
            }
            (err as any).nonRetryable = true;
            throw err;
          }
          // Server 5xx — transient, eligible for retry
          lastError = err;
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 50 * Math.pow(2, attempt)));
            continue;
          }
        } else {
          return;
        }
      } catch (err: any) {
        if (err?.nonRetryable) {
          throw err;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries && err.name !== "AbortError") {
          await new Promise((r) => setTimeout(r, 50 * Math.pow(2, attempt)));
          continue;
        }
      }
    }

    if (this.cfg.failOpen) {
      console.warn(`[AgentPulse] Telemetry request to ${path} failed after retries:`, lastError?.message);
      return;
    }
    throw lastError ?? new Error(`AgentPulse request failed: ${path}`);
  }
}
