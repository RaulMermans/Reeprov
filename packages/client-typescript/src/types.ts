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
  agent_id?: string;
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

/** How much content Reeprov may persist for a run. Secret redaction always applies. */
export type ContentMode = "STRUCTURE_ONLY" | "SAFE_CONTENT" | "FULL_CONTENT";

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
  /** Initiating agent identity when known. Omitted when attribution is unknown. */
  agent_id?: string;
  /** Arbitrary metadata attached to the run */
  metadata?: Record<string, unknown>;
  /** Content capture mode for every record of this run (default SAFE_CONTENT). */
  contentMode?: ContentMode;
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
  /** Final agent output, stored as outcome evidence under the run's content mode. */
  output?: unknown;
}

export interface FailRunInput {
  run_id: string;
  error_summary: string;
  total_cost_usd?: number;
  total_duration_ms?: number;
}

export type RecordStatus = "ACCEPTED" | "DUPLICATE" | "OBSERVATION_RECORDED" | "REJECTED";

export interface RecordResult {
  index: number;
  status: RecordStatus;
  boundary_id?: string;
  event_id?: string;
  sequence_index?: number;
  code?: string;
  message?: string;
  warnings?: string[];
}

export interface EmitEventsResult {
  ok?: boolean;
  accepted: number;
  duplicates?: number;
  observations?: number;
  rejected: number;
  results?: RecordResult[];
  errors?: Array<{ event_id?: string; boundary_id?: string; message: string }>;
}

/**
 * Acknowledgement returned by every ingest call. `ok` is true only when the
 * server confirmed every record (stored or idempotent duplicate). A transport
 * success with rejected records is `ok: false`.
 */
export interface IngestAck {
  ok: boolean;
  /** "disabled" when the client is off; "unreachable" when no response was received. */
  delivery: "acknowledged" | "disabled" | "unreachable";
  httpStatus?: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  results: RecordResult[];
  errors: string[];
}

export interface BoundaryCaptureInput {
  /** Client-assigned stable id. Assigned automatically when omitted; reused on retry. */
  boundaryId?: string;
  /** Client-assigned per-run sequence. Assigned automatically when omitted. */
  sequenceIndex?: number;
  dependencyIdentity?: string;
  boundaryType: "model_call" | "tool_call" | "retrieval_service" | "memory_read" | "memory_write" | string;
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
  parent_event_id?: string;
  duration_ms?: number;
  cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  agent_id?: string;
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
  parent_event_id?: string;
  duration_ms?: number;
  agent_id?: string;
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
  agent_id?: string;
  parent_event_id?: string;
  metadata?: Record<string, unknown>;
}

export interface HandoffInput {
  run_id: string;
  from_agent_id?: string;
  to_agent_id?: string;
  from_step_id?: string;
  to_step_id?: string;
  parent_event_id?: string;
  event_id?: string;
  payload_summary?: string;
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

/** Records that a checkpoint was reached. Never restorable. */
export interface CheckpointObservedInput {
  run_id: string;
  checkpoint_id: string;
  state?: unknown;
  node_id?: string;
  step_id?: string;
  metadata?: Record<string, unknown>;
}

/** @deprecated Use CheckpointObservedInput / checkpointObserved(). */
export type CheckpointSavedInput = CheckpointObservedInput;

export interface ResumeAdapterIdentity {
  adapter_id: string;
  adapter_version: string;
}

/** Restorable-checkpoint capture: a validated state snapshot your host can resume from. */
export interface RegisterCheckpointInput {
  run_id: string;
  checkpoint_id: string;
  /** Host step the checkpoint is taken at. */
  step_id: string;
  step_index?: number;
  position?: "BEFORE_STEP" | "AFTER_STEP" | "CUSTOM";
  /** First host step executed when resuming. */
  resume_step_index: number;
  resume_step_id?: string;
  /** JSON-serializable state the host needs to resume. */
  state: Record<string, unknown>;
  /** Host code that can resume from this checkpoint. */
  adapter: ResumeAdapterIdentity;
  /** Boundaries already recorded; defaults to the boundaries this client acknowledged for the run. */
  boundary_cursor?: number;
  metadata?: Record<string, unknown>;
}

export interface CheckpointAck {
  ok: boolean;
  delivery: IngestAck["delivery"];
  httpStatus?: number;
  status: "REGISTERED" | "REGISTERED_NOT_RESTORABLE" | "DUPLICATE" | "OBSERVATION_RECORDED" | "REJECTED" | "NOT_SENT";
  code?: string;
  message?: string;
  /** Restorability is established by Reeprov, never assumed by the client. */
  assessment?: { status: string; advertised_restorable: boolean; reasons: string[] };
}
