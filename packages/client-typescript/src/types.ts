/**
 * @reeprov/client — Canonical Type Definitions
 *
 * Standalone interfaces for Reeprov trace ingestion and execution boundary capture.
 */

export type PermissionClass =
  | "read_only"
  | "write_draft"
  | "external_side_effect"
  | "destructive"
  | "sensitive_data";

export type EventStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface TraceEvent {
  event_id: string;
  run_id: string;
  workflow_id: string;
  timestamp: string;
  event_type: string;
  status: EventStatus | string;
  node_id?: string;
  parent_event_id?: string;
  cost_usd?: number;
  duration_ms?: number;
  input_summary?: string;
  output_summary?: string;
  metadata?: Record<string, unknown>;
  error_message?: string;
}

export interface ReeprovClientOptions {
  /** Base URL of the Reeprov instance, e.g. "http://127.0.0.1:3000" */
  url?: string;
  /** Backwards-compatible alias for url */
  endpoint?: string;
  /** Project-scoped ingest API key (or global ingest key) */
  ingestKey?: string;
  /** Backwards-compatible alias for ingestKey */
  apiKey?: string;
  /** Stable project identifier (e.g. "my-agent-service") */
  projectId?: string;
  /** Human-readable project display name */
  projectName?: string;
  /** Default workflow identifier */
  workflowId?: string;
  /** Request timeout in milliseconds (default: 10,000ms) */
  timeoutMs?: number;
  /** Maximum retry attempts for transient 5xx server errors (default: 2) */
  maxRetries?: number;
  /** Fail-open posture: log telemetry warnings instead of throwing (default: true) */
  failOpen?: boolean;
  /** Explicit enable flag: defaults to true if endpoint and ingestKey are provided */
  enabled?: boolean;
}

export type AgentPulseClientOptions = ReeprovClientOptions;

export interface StartRunInput {
  /** Brief human summary describing the run's goal or trigger */
  summary: string;
  /** Optional client-supplied run ID. Server generates a UUID if omitted */
  run_id?: string;
  /** Override project ID for this specific run */
  projectId?: string;
  /** Override project name for this specific run */
  projectName?: string;
  /** Override workflow ID for this specific run */
  workflowId?: string;
  /** Arbitrary metadata attached to the run */
  metadata?: Record<string, unknown>;
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
  metrics?: Record<string, number>;
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
  errors?: Array<{ event_id: string; message: string }>;
}

export interface BoundaryCaptureInput {
  boundaryType: "model_call" | "tool_call" | "retrieval_service" | "memory_read" | "memory_write" | "checkpoint" | string;
  name: string;
  stepId?: string;
  nodeId?: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: { message: string; stack?: string };
  declaredSideEffectClass?: PermissionClass;
  metadata?: Record<string, unknown>;
}

export interface ModelCallInput {
  run_id: string;
  model: string;
  provider: string;
  response: unknown;
  prompt?: string;
  messages?: unknown[];
  node_id?: string;
  step_id?: string;
  duration_ms?: number;
  cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  metadata?: Record<string, unknown>;
}

export interface ToolCallInput {
  run_id: string;
  tool_name: string;
  arguments: unknown;
  output?: unknown;
  error?: string;
  permission_class?: PermissionClass;
  node_id?: string;
  step_id?: string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}

export interface EvalCompletedInput {
  run_id: string;
  eval_id?: string;
  eval_name: string;
  passed: boolean;
  score?: number;
  reason?: string;
  node_id?: string;
  metadata?: Record<string, unknown>;
}

export interface ArtifactCreatedInput {
  run_id: string;
  artifact_ref: string;
  artifact_type: string;
  summary?: string;
  node_id?: string;
  metadata?: Record<string, unknown>;
}

export interface CheckpointSavedInput {
  run_id: string;
  checkpoint_id: string;
  state: unknown;
  node_id?: string;
  step_id?: string;
  metadata?: Record<string, unknown>;
}
