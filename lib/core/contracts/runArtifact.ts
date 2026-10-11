/**
 * Canonical Versioned RunArtifact Contract.
 *
 * The foundational runtime and data contract for AgentPulse execution intelligence.
 * Encapsulates the complete causal trajectory, context snapshots, memory operations,
 * tool boundaries, evaluations, and lineage of an agent run.
 */

import { z } from "zod";
import { runIdentitySchema } from "./identity";
import { failureCategorySchema } from "./taxonomy";
import { executionStepSchema, stateSnapshotSchema } from "./execution";
import { executionBoundarySchema, externalCallSchema, replayMetadataSchema } from "./replay";
import { contextSnapshotSchema } from "./context";
import { memoryOperationSchema, memoryReferenceSchema } from "./memory";
import { retrievalOperationSchema } from "./retrieval";
import { toolInvocationSchema } from "./tools";
import { modelInvocationSchema } from "./models";
import { artifactReferenceSchema } from "./artifacts";
import { evalResultSchema } from "./evals";
import { runLineageSchema, comparisonMetadataSchema, checkpointReferenceSchema } from "./lineage";

export const CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION = "1.0.0-alpha";

// ── Execution Summary Block ─────────────────────────────────────────────────

export const runExecutionBlockSchema = z.object({
  status: z.enum(["running", "completed", "failed", "degraded", "cancelled", "timed_out", "pending"]),
  started_at: z.string(),
  completed_at: z.string().optional(),
  duration_ms: z.number().nonnegative().optional(),
  exit_reason: z.string().optional(),
  summary: z.string().default(""),
  error: z.object({
    message: z.string(),
    taxonomy: failureCategorySchema.optional(),
    code: z.string().optional(),
    details: z.unknown().optional(),
  }).optional(),
});

export type RunExecutionBlock = z.infer<typeof runExecutionBlockSchema>;

// ── Environment Block ───────────────────────────────────────────────────────

export const runEnvironmentBlockSchema = z.object({
  runtime: z.string().optional(),            // e.g. "node", "python", "deno"
  runtime_version: z.string().optional(),
  os: z.string().optional(),
  framework: z.string().optional(),          // e.g. "langgraph", "crewai", "autogen", "custom"
  framework_version: z.string().optional(),
  sdk_version: z.string().optional(),
  env_fingerprint: z.string().optional(),    // Hash or sanitized environment variable set
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type RunEnvironmentBlock = z.infer<typeof runEnvironmentBlockSchema>;

// ── Memory Block ────────────────────────────────────────────────────────────

export const runMemoryBlockSchema = z.object({
  operations: z.array(memoryOperationSchema).default([]),
  references: z.array(memoryReferenceSchema).default([]),
});

export type RunMemoryBlock = z.infer<typeof runMemoryBlockSchema>;

// ── Provenance Block ────────────────────────────────────────────────────────

export const runProvenanceBlockSchema = z.object({
  source_repo: z.string().optional(),
  commit_sha: z.string().optional(),
  capture_method: z.enum([
    "sdk_trace",
    "http_api",
    "cli_bridge",
    "imported_fixture",
    "legacy_adaptation",
  ]),
  adapter_version: z.string().optional(),
  captured_by: z.string().optional(),
  redaction_verified: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type RunProvenanceBlock = z.infer<typeof runProvenanceBlockSchema>;

// ── Safety Block ────────────────────────────────────────────────────────────

export const runSafetyBlockSchema = z.object({
  approval_status: z.enum(["not_required", "pending", "granted", "rejected"]).default("not_required"),
  approval_records: z.array(z.object({
    gate_name: z.string(),
    status: z.enum(["pending", "granted", "rejected"]),
    approver: z.string().optional(),
    timestamp: z.string().optional(),
    comment: z.string().optional(),
  })).default([]),
  redaction_summary: z.object({
    total_redactions: z.number().int().nonnegative().default(0),
    secrets_detected: z.number().int().nonnegative().default(0),
    fields_redacted: z.array(z.string()).default([]),
  }).default({ total_redactions: 0, secrets_detected: 0, fields_redacted: [] }),
});

export type RunSafetyBlock = z.infer<typeof runSafetyBlockSchema>;

// ── Observability Block ─────────────────────────────────────────────────────

export const runObservabilityBlockSchema = z.object({
  total_duration_ms: z.number().nonnegative().optional(),
  total_cost_usd: z.number().nonnegative().optional(),
  model_calls_count: z.number().int().nonnegative().default(0),
  tool_calls_count: z.number().int().nonnegative().default(0),
  evals_passed: z.number().int().nonnegative().default(0),
  evals_failed: z.number().int().nonnegative().default(0),
  trace_event_count: z.number().int().nonnegative().default(0),
  context_snapshot_count: z.number().int().nonnegative().default(0),
  memory_operations_count: z.number().int().nonnegative().default(0),
  retrieval_operations_count: z.number().int().nonnegative().default(0),
  total_tokens: z.number().int().nonnegative().optional(),
});

export type RunObservabilityBlock = z.infer<typeof runObservabilityBlockSchema>;

// ── Canonical RunArtifact Schema ────────────────────────────────────────────

export const runArtifactSchema = z.object({
  schema_version: z.string().regex(/^1\.\d+\.\d+.*$/, "Must be a valid 1.x version string"),
  identity: runIdentitySchema,
  execution: runExecutionBlockSchema,
  environment: runEnvironmentBlockSchema.default({}),
  trajectory: z.array(executionStepSchema).default([]),
  boundaries: z.array(executionBoundarySchema).default([]),
  external_calls: z.array(externalCallSchema).default([]),
  state: z.array(stateSnapshotSchema).default([]),
  checkpoints: z.array(checkpointReferenceSchema).default([]),
  context: z.array(contextSnapshotSchema).default([]),
  memory: runMemoryBlockSchema.default({ operations: [], references: [] }),
  tools: z.array(toolInvocationSchema).default([]),
  retrieval: z.array(retrievalOperationSchema).default([]),
  models: z.array(modelInvocationSchema).default([]),
  artifacts: z.array(artifactReferenceSchema).default([]),
  evals: z.array(evalResultSchema).default([]),
  lineage: runLineageSchema.default({ mutations: [] }),
  provenance: runProvenanceBlockSchema,
  safety: runSafetyBlockSchema.default({ approval_status: "not_required", approval_records: [], redaction_summary: { total_redactions: 0, secrets_detected: 0, fields_redacted: [] } }),
  observability: runObservabilityBlockSchema.default({
    model_calls_count: 0,
    tool_calls_count: 0,
    evals_passed: 0,
    evals_failed: 0,
    trace_event_count: 0,
    context_snapshot_count: 0,
    memory_operations_count: 0,
    retrieval_operations_count: 0,
  }),
  replay: replayMetadataSchema.default({
    overall_replayability: "UNKNOWN",
    unsupported_boundaries_count: 0,
    side_effect_gated_count: 0,
    deterministic: false,
    sandboxed_available: false,
    missing_recordings: [],
    notes: [],
  }),
  comparison: comparisonMetadataSchema.optional(),
});

export type RunArtifact = z.infer<typeof runArtifactSchema>;
