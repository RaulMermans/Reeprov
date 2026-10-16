/**
 * examples/integrations/campaign-sandbox/reeprov-client.ts
 *
 * Minimal self-contained Reeprov HTTP client for Campaign Sandbox.
 * Copy this file into the Campaign Sandbox project and adapt the import path.
 *
 * This file has no dependencies beyond the built-in `fetch` API (Node 18+).
 * It does NOT import from the Reeprov codebase at runtime — safe to copy.
 *
 * Usage:
 *
 *   const pulse = createCampaignSandboxPulseClient();
 *   const run = await pulse.startRun({ summary: "EMEA campaign brief" });
 *   await pulse.emitEvent(run.run_id, { event_type: "node_started", node_id: "normalize-brief", ... });
 *   await pulse.completeRun({ run_id: run.run_id, summary: "Done." });
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface PulseClientOptions {
  endpoint: string;
  apiKey: string;
  projectId: string;
  projectName: string;
  workflowId: string;
  /** Set to false to disable all emissions without removing instrumentation */
  enabled?: boolean;
}

export interface StartRunInput {
  summary: string;
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

export interface EmitEventInput {
  event_id?: string;
  event_type: string;
  node_id?: string;
  status?: string;
  duration_ms?: number;
  cost_usd?: number;
  input_summary?: string;
  output_summary?: string;
  metadata?: Record<string, unknown>;
}

export interface CompleteRunInput {
  run_id: string;
  summary?: string;
  total_cost_usd?: number;
  total_duration_ms?: number;
  model_calls_count?: number;
  tool_calls_count?: number;
  evals_passed?: number;
  evals_failed?: number;
  artifact_refs?: string[];
}

export interface FailRunInput {
  run_id: string;
  error_summary: string;
  error_code?: string;
  total_cost_usd?: number;
  total_duration_ms?: number;
}

// ── Client ────────────────────────────────────────────────────────────────────

export class CampaignSandboxPulseClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly projectId: string;
  private readonly projectName: string;
  private readonly workflowId: string;
  private readonly enabled: boolean;

  constructor(options: PulseClientOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.projectId = options.projectId;
    this.projectName = options.projectName;
    this.workflowId = options.workflowId;
    this.enabled = options.enabled !== false;
  }

  /** Create a new run. Returns the run record with the generated run_id. */
  async startRun(input: StartRunInput): Promise<StartRunResult> {
    if (!this.enabled) {
      const fakeId = input.run_id ?? `cs-disabled-${Date.now()}`;
      return {
        run_id: fakeId,
        workflow_id: this.workflowId,
        project_id: this.projectId,
        project_name: this.projectName,
        status: "running",
        started_at: new Date().toISOString(),
        summary: input.summary,
      };
    }
    const body = {
      project_id: this.projectId,
      project_name: this.projectName,
      workflow_id: this.workflowId,
      summary: input.summary,
      ...(input.run_id ? { run_id: input.run_id } : {}),
    };
    return this.post<StartRunResult>("/api/runs/start", body);
  }

  /** Emit a single trace event. Non-fatal: logs a warning on failure. */
  async emitEvent(runId: string, event: EmitEventInput): Promise<void> {
    if (!this.enabled) return;
    const payload = {
      events: [
        {
          event_id: event.event_id ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          run_id: runId,
          workflow_id: this.workflowId,
          timestamp: new Date().toISOString(),
          ...event,
        },
      ],
    };
    await this.postSafe("/api/traces/events", payload);
  }

  /** Emit multiple trace events in one request. */
  async emitEvents(runId: string, events: EmitEventInput[]): Promise<void> {
    if (!this.enabled || events.length === 0) return;
    const payload = {
      events: events.map((e) => ({
        event_id: e.event_id ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        run_id: runId,
        workflow_id: this.workflowId,
        timestamp: new Date().toISOString(),
        ...e,
      })),
    };
    await this.postSafe("/api/traces/events", payload);
  }

  /** Mark the run as completed. Non-fatal: logs a warning on failure. */
  async completeRun(input: CompleteRunInput): Promise<void> {
    if (!this.enabled) return;
    await this.postSafe("/api/runs/complete", input);
  }

  /** Mark the run as failed. Non-fatal: logs a warning on failure. */
  async failRun(input: FailRunInput): Promise<void> {
    if (!this.enabled) return;
    await this.postSafe("/api/runs/fail", input);
  }

  // ── Replay-Grade Boundary Capture ──────────────────────────────────────────

  /** Emit a raw execution boundary to Reeprov. */
  async captureBoundary(runId: string, boundary: Record<string, unknown>): Promise<void> {
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
    await this.postSafe("/api/traces/boundaries", payload);
  }

  /** Emit a captured model invocation boundary. */
  async captureModelCall(
    runId: string,
    params: {
      model: string;
      provider: string;
      prompt?: unknown;
      messages?: unknown[];
      response: unknown;
      stepId?: string;
      nodeId?: string;
      durationMs?: number;
    }
  ): Promise<void> {
    await this.captureBoundary(runId, {
      boundaryType: "model_call",
      name: `${params.provider}/${params.model}`,
      stepId: params.stepId,
      nodeId: params.nodeId,
      durationMs: params.durationMs,
      input: {
        model: params.model,
        provider: params.provider,
        prompt: params.prompt,
        messages: params.messages,
      },
      output: params.response,
      declaredSideEffectClass: "read_only",
    });
  }

  /** Emit a captured tool invocation boundary. */
  async captureToolCall(
    runId: string,
    params: {
      toolName: string;
      arguments: unknown;
      output?: unknown;
      error?: { message: string };
      stepId?: string;
      nodeId?: string;
      durationMs?: number;
      permissionClass?: string;
    }
  ): Promise<void> {
    await this.captureBoundary(runId, {
      boundaryType: "tool_call",
      name: params.toolName,
      stepId: params.stepId,
      nodeId: params.nodeId,
      durationMs: params.durationMs,
      input: params.arguments,
      output: params.output,
      error: params.error,
      declaredSideEffectClass: params.permissionClass,
    });
  }

  /** Emit a captured retrieval operation boundary. */
  async captureRetrieval(
    runId: string,
    params: {
      serviceName: string;
      query: string;
      results: unknown[];
      stepId?: string;
      nodeId?: string;
      durationMs?: number;
    }
  ): Promise<void> {
    await this.captureBoundary(runId, {
      boundaryType: "retrieval_service",
      name: `${params.serviceName}:search`,
      stepId: params.stepId,
      nodeId: params.nodeId,
      durationMs: params.durationMs,
      input: { query: params.query },
      output: { results: params.results },
      declaredSideEffectClass: "read_only",
    });
  }

  /** Emit a captured memory operation boundary. */
  async captureMemoryOperation(
    runId: string,
    params: {
      provider: string;
      operationType: string;
      category?: string;
      key?: string;
      value?: unknown;
      stepId?: string;
      nodeId?: string;
    }
  ): Promise<void> {
    const isRead = params.operationType === "read" || params.operationType === "retrieval";
    await this.captureBoundary(runId, {
      boundaryType: isRead ? "memory_read" : "memory_write",
      name: `${params.provider}:${params.operationType}`,
      stepId: params.stepId,
      nodeId: params.nodeId,
      input: { key: params.key, value: params.value, operationType: params.operationType },
      output: { status: "recorded" },
      declaredSideEffectClass: isRead ? "read_only" : "external_side_effect",
    });
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.endpoint}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-reeprov-key": this.apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Reeprov API ${response.status}: ${await response.text()}`);
    }
    return response.json() as Promise<T>;
  }

  /** Like post() but catches errors and logs a warning instead of throwing. */
  private async postSafe(path: string, body: unknown): Promise<void> {
    try {
      await this.post(path, body);
    } catch (err) {
      console.warn(`[Reeprov] Non-fatal emission error: ${String(err)}`);
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates a CampaignSandboxPulseClient from environment variables.
 *
 * Required env vars in Campaign Sandbox (canonical REEPROV_*):
 *   REEPROV_URL          — e.g. "http://localhost:3000"
 *   REEPROV_INGEST_KEY   — matches REEPROV_INGEST_KEY in Reeprov
 *   REEPROV_PROJECT_ID   — e.g. "campaign-sandbox"
 *   REEPROV_PROJECT_NAME — e.g. "Campaign Sandbox"
 *   REEPROV_WORKFLOW_ID  — e.g. "campaign-sandbox-v1"
 *
 * Optional:
 *   REEPROV_ENABLED      — set to "false" to disable without removing code
 */
export function createCampaignSandboxPulseClient(): CampaignSandboxPulseClient {
  const endpoint = process.env["REEPROV_URL"] ?? "http://localhost:3000";
  const apiKey = process.env["REEPROV_INGEST_KEY"] ?? "";
  const projectId = process.env["REEPROV_PROJECT_ID"] ?? "campaign-sandbox";
  const projectName = process.env["REEPROV_PROJECT_NAME"] ?? "Campaign Sandbox";
  const workflowId = process.env["REEPROV_WORKFLOW_ID"] ?? "campaign-sandbox-v1";
  const enabled = process.env["REEPROV_ENABLED"] !== "false";

  return new CampaignSandboxPulseClient({
    endpoint,
    apiKey,
    projectId,
    projectName,
    workflowId,
    enabled,
  });
}

/** Canonical aliases */
export const CampaignSandboxReeprovClient = CampaignSandboxPulseClient;
export type CampaignSandboxReeprovClient = CampaignSandboxPulseClient;
export const createCampaignSandboxClient = createCampaignSandboxPulseClient;
export const createCampaignSandboxReeprovClient = createCampaignSandboxPulseClient;
