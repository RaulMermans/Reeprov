/**
 * AgentPulseClient — minimal TypeScript client for emitting trace events.
 *
 * External AI projects can import or copy this file to send traces to an
 * AgentPulse instance.
 *
 * Usage:
 *
 *   const pulse = new AgentPulseClient({
 *     endpoint: process.env.AGENTPULSE_URL!,
 *     apiKey:   process.env.AGENTPULSE_INGEST_KEY!,
 *     projectId: "campaign-sandbox",
 *     projectName: "Campaign Sandbox",
 *     workflowId: "campaign-recommendation-v1",
 *   });
 *
 *   const run = await pulse.startRun({ summary: "Generate campaign recommendation." });
 *
 *   await pulse.emitTraceEvent({
 *     event_id:   crypto.randomUUID(),
 *     run_id:     run.run_id,
 *     workflow_id: "campaign-recommendation-v1",
 *     node_id:    "brief-parser",
 *     timestamp:  new Date().toISOString(),
 *     event_type: "node_started",
 *     status:     "running",
 *   });
 *
 *   await pulse.completeRun({ run_id: run.run_id, summary: "Done." });
 *
 * Auth:
 *   All requests include the apiKey as x-agentpulse-key.
 *   The key is matched against AGENTPULSE_INGEST_KEY (or AGENTPULSE_ACCESS_KEY
 *   as fallback) on the server.
 */

import type { TraceEvent } from "./schemas";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentPulseClientOptions {
  /** Base URL of the AgentPulse instance, e.g. "http://localhost:3000" */
  endpoint: string;
  /** API key — sent as x-agentpulse-key header */
  apiKey: string;
  /** Optional project ID; overridden per-call if provided there */
  projectId?: string;
  /** Optional project display name */
  projectName?: string;
  /** Optional workflow ID */
  workflowId?: string;
}

export interface StartRunInput {
  /** Summary of what this run is doing */
  summary: string;
  /** Override project_id for this run */
  projectId?: string;
  /** Override project_name for this run */
  projectName?: string;
  /** Override workflow_id for this run */
  workflowId?: string;
  /** Optional client-provided run_id; server generates one if omitted */
  run_id?: string;
}

export interface StartRunResult {
  run_id: string;
  workflow_id: string;
  project_id: string;
  project_name: string;
  status: string;
  started_at: string;
  summary: string;
}

export interface CompleteRunInput {
  run_id: string;
  summary?: string;
  total_cost_usd?: number;
  total_duration_ms?: number;
  artifact_refs?: string[];
}

export interface FailRunInput {
  run_id: string;
  error_summary: string;
  total_cost_usd?: number;
  total_duration_ms?: number;
}

export interface EmitEventsResult {
  accepted: number;
  rejected: number;
  errors: Array<{ event_id: string; message: string }>;
}

// ── Client ────────────────────────────────────────────────────────────────────

export class AgentPulseClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly defaultProjectId: string;
  private readonly defaultProjectName: string;
  private readonly defaultWorkflowId: string;

  constructor(options: AgentPulseClientOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.defaultProjectId = options.projectId ?? "unknown-project";
    this.defaultProjectName = options.projectName ?? "Unknown Project";
    this.defaultWorkflowId = options.workflowId ?? "unknown-workflow";
  }

  // ── Run lifecycle ────────────────────────────────────────────────────────────

  /**
   * Creates a new run. Returns the run record with the generated run_id.
   */
  async startRun(input: StartRunInput): Promise<StartRunResult> {
    const body = {
      project_id: input.projectId ?? this.defaultProjectId,
      project_name: input.projectName ?? this.defaultProjectName,
      workflow_id: input.workflowId ?? this.defaultWorkflowId,
      summary: input.summary,
      ...(input.run_id ? { run_id: input.run_id } : {}),
    };

    const response = await this.post("/api/runs/start", body);
    return response as StartRunResult;
  }

  /**
   * Marks the run as completed.
   */
  async completeRun(input: CompleteRunInput): Promise<void> {
    await this.post("/api/runs/complete", input);
  }

  /**
   * Marks the run as failed with an error summary.
   */
  async failRun(input: FailRunInput): Promise<void> {
    await this.post("/api/runs/fail", input);
  }

  // ── Trace events ─────────────────────────────────────────────────────────────

  /**
   * Emits a single trace event to AgentPulse.
   */
  async emitTraceEvent(event: TraceEvent): Promise<EmitEventsResult> {
    return this.emitTraceEvents([event]);
  }

  /**
   * Emits multiple trace events in one request.
   * Preferred over calling emitTraceEvent in a loop.
   */
  async emitTraceEvents(events: TraceEvent[]): Promise<EmitEventsResult> {
    const response = await this.post("/api/traces/events", { events });
    return response as EmitEventsResult;
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────────────

  private async post(path: string, body: unknown): Promise<unknown> {
    const url = `${this.endpoint}${path}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agentpulse-key": this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let message = `AgentPulse API error: ${response.status} ${response.statusText}`;
      try {
        const data = await response.json() as { message?: string };
        if (data.message) message = `AgentPulse API error (${response.status}): ${data.message}`;
      } catch {
        // ignore parse errors
      }
      throw new AgentPulseError(message, response.status);
    }

    return response.json();
  }
}

// ── Error ─────────────────────────────────────────────────────────────────────

export class AgentPulseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AgentPulseError";
  }
}
