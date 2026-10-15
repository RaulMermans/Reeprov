/**
 * Types & Interfaces for AgentPulse Replay-Grade Boundary Capture Pipeline.
 */

import type {
  ExecutionBoundary,
  BoundaryType,
  ReplayabilityClass,
  SideEffectClass,
  CapturedContentAvailability,
  RedactionStatus,
} from "../contracts/replay";
import type { ModelInvocation } from "../contracts/models";
import type { ToolInvocation } from "../contracts/tools";
import type { RetrievalOperation } from "../contracts/retrieval";
import type { MemoryOperation, MemoryCategory, MemoryOperationType } from "../contracts/memory";
import type { ContextSnapshot, ContextItem, ContextSourceType, ContextProvenance } from "../contracts/context";
import type { RunArtifact } from "../contracts/runArtifact";

// ── Policy Configuration ────────────────────────────────────────────────────

export type ContentCaptureMode = "STRUCTURE_ONLY" | "SAFE_CONTENT" | "FULL_CONTENT";

export interface RedactionPolicyConfig {
  enabled: boolean;
  sensitiveFieldNames?: string[];
  sensitiveHeaders?: string[];
  additionalSecretPatterns?: RegExp[];
  redactEnvironmentVariables?: boolean;
}

export interface CapturePolicy {
  contentMode: ContentCaptureMode;
  maxInlineBytes: number;     // e.g. 4096 (4KB)
  maxPayloadBytes: number;    // e.g. 524288 (512KB)
  redaction: RedactionPolicyConfig;
  hashAlgorithm: "sha256" | "sha512";
  retention?: {
    retentionDays?: number;
    allowRawPrompts?: boolean;
  };
  failClosedOnUnknown?: boolean;
}

// ── Redaction Results ────────────────────────────────────────────────────────

export interface RedactionResult<T = unknown> {
  redacted: boolean;
  fields_redacted: string[];
  strategy: "mask" | "hash" | "omit";
  value: T;
  original_hash?: string;
  persisted_hash: string;
  content_status: RedactionStatus;
}

// ── Content Blobs & Content Store ────────────────────────────────────────────

export interface ContentBlob {
  hash: string;
  content: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
}

export interface ContentStorePutResult {
  hash: string;
  sizeBytes: number;
  isNew: boolean;
  contentRef: string;
}

export interface ContentStoreStats {
  blobCount: number;
  totalBytes: number;
  dedupeSavingsBytes: number;
}

export interface ContentStore {
  put(content: string, mimeType?: string): Promise<ContentStorePutResult>;
  get(hashOrRef: string): Promise<string | null>;
  has(hashOrRef: string): Promise<boolean>;
  getStats(): Promise<ContentStoreStats>;
}

// ── Captured Boundary Representations ────────────────────────────────────────

export interface RawBoundaryInput {
  boundaryId?: string;
  boundary_id?: string;
  runId: string;
  run_id?: string;
  stepId?: string;
  step_id?: string;
  nodeId?: string;
  node_id?: string;
  sequenceIndex?: number;
  sequence_index?: number;
  boundaryType: BoundaryType;
  boundary_type?: BoundaryType;
  name: string;
  startedAt?: string;
  started_at?: string;
  completedAt?: string;
  completed_at?: string;
  durationMs?: number;
  duration_ms?: number;
  status?: "completed" | "failed" | "pending" | "interrupted" | "skipped";
  input: unknown;
  inputSummary?: string;
  input_summary?: string;
  output?: unknown;
  outputSummary?: string;
  output_summary?: string;
  error?: {
    message: string;
    code?: string;
    details?: unknown;
  };
  dependencyIdentity?: string;
  declaredSideEffectClass?: SideEffectClass;
  declaredReplayability?: ReplayabilityClass;
  isIdempotent?: boolean;
  idempotencyKey?: string;
  traceCorrelationId?: string;
  linkedModelInvocationId?: string;
  linkedToolInvocationId?: string;
  linkedRetrievalOperationId?: string;
  linkedMemoryOperationId?: string;
  metadata?: Record<string, unknown>;
}

// ── Model Capture Input ─────────────────────────────────────────────────────

export interface ModelCaptureInput {
  runId: string;
  stepId?: string;
  nodeId?: string;
  sequenceIndex?: number;
  model: string;
  provider: string;
  revision?: string;
  parameters?: Record<string, unknown>;
  toolsExposed?: Array<{ name: string; description?: string; parameters?: unknown }>;
  prompt?: string;
  messages?: Array<{ role: string; content: unknown; name?: string }>;
  contextItems?: Array<{
    sourceType: ContextSourceType;
    content: string;
    sourceReference?: string;
    provenance?: ContextProvenance;
    tokenEstimate?: number;
    sensitivity?: "public" | "internal" | "confidential" | "restricted";
    metadata?: Record<string, unknown>;
  }>;
  response: unknown;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  finishReason?: string;
  durationMs?: number;
  startedAt: string;
  completedAt?: string;
  error?: { message: string; code?: string; details?: unknown };
  metadata?: Record<string, unknown>;
}

export interface ModelCaptureResult {
  boundary: ExecutionBoundary;
  modelInvocation: ModelInvocation;
  contextSnapshot?: ContextSnapshot;
}

// ── Tool Capture Input ──────────────────────────────────────────────────────

export interface ToolCaptureInput {
  runId: string;
  stepId?: string;
  nodeId?: string;
  sequenceIndex?: number;
  toolName: string;
  toolVersion?: string;
  arguments: unknown;
  output?: unknown;
  error?: { message: string; code?: string; details?: unknown };
  status?: "completed" | "failed" | "pending" | "skipped" | "blocked";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  declaredPermissionClass?: SideEffectClass;
  approvalState?: {
    required: boolean;
    granted?: boolean;
    approver?: string;
  };
  isIdempotent?: boolean;
  idempotencyKey?: string;
  retryAttempt?: number;
  toolProvider?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolCaptureResult {
  boundary: ExecutionBoundary;
  toolInvocation: ToolInvocation;
}

// ── Retrieval Capture Input ─────────────────────────────────────────────────

export interface RetrievalResultCaptureItem {
  documentId: string;
  chunkId?: string;
  title?: string;
  uri?: string;
  score?: number;
  rank?: number;
  content: string;
  metadata?: Record<string, unknown>;
  enteredModelContext?: boolean;
}

export interface RetrievalCaptureInput {
  runId: string;
  stepId?: string;
  nodeId?: string;
  sequenceIndex?: number;
  serviceName: string;
  query: string;
  filters?: Record<string, unknown>;
  topK?: number;
  results: RetrievalResultCaptureItem[];
  durationMs?: number;
  startedAt: string;
  completedAt?: string;
  error?: { message: string; code?: string; details?: unknown };
  metadata?: Record<string, unknown>;
}

export interface RetrievalCaptureResult {
  boundary: ExecutionBoundary;
  retrievalOperation: RetrievalOperation;
}

// ── Memory Capture Input ────────────────────────────────────────────────────

export interface MemoryCaptureInput {
  runId: string;
  stepId?: string;
  nodeId?: string;
  sequenceIndex?: number;
  provider: string;
  operationType: MemoryOperationType;
  category: MemoryCategory;
  memoryId?: string;
  query?: string;
  key?: string;
  value?: unknown;
  score?: number;
  rank?: number;
  sourceProvenance?: string;
  version?: string;
  timestamps: {
    createdAt?: string;
    updatedAt?: string;
    operationAt: string;
  };
  outcome: "success" | "rejected" | "not_found" | "failed" | "pending";
  contextInjectionLinkage?: {
    contextItemId: string;
    contextSnapshotId: string;
  };
  originatingRunId?: string;
  originatingStepId?: string;
  error?: { message: string; code?: string; details?: unknown };
  details?: Record<string, unknown>;
}

export interface MemoryCaptureResult {
  boundary: ExecutionBoundary;
  memoryOperation: MemoryOperation;
}

// ── HTTP Capture Input ──────────────────────────────────────────────────────

export interface HttpCaptureInput {
  runId: string;
  stepId?: string;
  nodeId?: string;
  sequenceIndex?: number;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  status: number;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: { message: string; code?: string; details?: unknown };
  retryAttempt?: number;
  metadata?: Record<string, unknown>;
}

export interface HttpCaptureResult {
  boundary: ExecutionBoundary;
}

// ── Internal Metrics ────────────────────────────────────────────────────────

export interface CaptureMetricsSnapshot {
  captureSuccessCount: number;
  captureFailureCount: number;
  boundaryCount: number;
  bytesCaptured: number;
  bytesPersisted: number;
  redactionCount: number;
  truncationCount: number;
  persistenceLatencyMsTotal: number;
  persistenceOpsCount: number;
  unsupportedBoundaryCount: number;
  replayabilityDistribution: Record<ReplayabilityClass, number>;
  sideEffectDistribution: Record<SideEffectClass, number>;
}
