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
  private cfg = getConfig();

  /** Returns false when AGENTPULSE_ENABLED is not "true". */
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
  }): Promise<string> {
    if (!this.cfg.enabled) return `noop-${shortId()}`;
    const runId = opts.runId ?? `${this.cfg.projectId}-${shortId()}`;
    await this.post("/api/runs/start", {
      run_id: runId,
      project_id: this.cfg.projectId,
      project_name: this.cfg.projectName,
      workflow_id: this.cfg.workflowId,
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
      nodeId: string;
      modelProvider: string;
      modelName: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      durationMs?: number;
      inputSummary?: string;
      outputSummary?: string;
    },
  ): Promise<void> {
    if (!this.cfg.enabled) return;
    const now = new Date().toISOString();
    await this.emitTraceEvents([
      {
        event_id: `${runId}::${opts.nodeId}::model::${shortId()}`,
        run_id: runId,
        workflow_id: this.cfg.workflowId,
        node_id: opts.nodeId,
        timestamp: now,
        event_type: "model_call_completed",
        status: "completed",
        duration_ms: opts.durationMs,
        cost_usd: opts.costUsd,
        input_summary: opts.inputSummary,
        output_summary: opts.outputSummary,
        metadata: {
          model_provider: opts.modelProvider,
          model_name: opts.modelName,
          input_tokens: opts.inputTokens,
          output_tokens: opts.outputTokens,
        },
      },
    ]);
  }

  /** Record a completed tool call. */
  async toolCallCompleted(
    runId: string,
    opts: {
      nodeId: string;
      toolName: string;
      permissionClass?: string;
      durationMs?: number;
      costUsd?: number;
      inputSummary?: string;
      outputSummary?: string;
    },
  ): Promise<void> {
    if (!this.cfg.enabled) return;
    const toolCallId = `${runId}::tc::${shortId()}`;
    const now = new Date().toISOString();
    await this.emitTraceEvents([
      {
        event_id: `${runId}::${opts.nodeId}::tool::${shortId()}`,
        run_id: runId,
        workflow_id: this.cfg.workflowId,
        node_id: opts.nodeId,
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

  /** Complete a run. */
  async completeRun(
    runId: string,
    opts: {
      summary?: string;
      totalCostUsd?: number;
      totalDurationMs?: number;
      artifactRefs?: string[];
    } = {},
  ): Promise<void> {
    if (!this.cfg.enabled) return;
    await this.post("/api/runs/complete", {
      run_id: runId,
      ...(opts.summary ? { summary: opts.summary } : {}),
      ...(opts.totalCostUsd !== undefined ? { total_cost_usd: opts.totalCostUsd } : {}),
      ...(opts.totalDurationMs !== undefined ? { total_duration_ms: opts.totalDurationMs } : {}),
      ...(opts.artifactRefs ? { artifact_refs: opts.artifactRefs } : {}),
    });
  }

  /** Fail a run. */
  async failRun(
    runId: string,
    opts: { errorSummary: string },
  ): Promise<void> {
    if (!this.cfg.enabled) return;
    await this.post("/api/runs/fail", {
      run_id: runId,
      error_summary: opts.errorSummary,
    });
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async post(path: string, body: unknown): Promise<void> {
    const res = await fetch(`${this.cfg.url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agentpulse-key": this.cfg.ingestKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`AgentPulse request failed: ${res.status} ${path} — ${text}`);
    }
  }
}
