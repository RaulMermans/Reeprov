/**
 * Canonical Adapter: Legacy SavedRun / ExistingRun → Canonical RunArtifact.
 *
 * Guarantees backward compatibility for existing AgentPulse runs stored in
 * file or Postgres storage without data loss.
 *
 * Non-Fabrication Policy:
 * Fields that were not captured in legacy runs use explicit "not_captured",
 * "unknown", or "unavailable" semantics rather than synthetic assumptions.
 */

import type { SavedRun } from "@/lib/runs/runTypes";
import type { RunRecord, TraceEvent, ToolCallRecord, EvalResult as LegacyEvalResult } from "@/lib/proof-layer/schemas";
import {
  CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION,
  type RunArtifact,
  runArtifactSchema,
} from "../contracts/runArtifact";
import type { EvalFamily } from "../contracts/evals";
import type { ExecutionStep, ExecutionStepType } from "../contracts/execution";
import type { ExecutionBoundary } from "../contracts/replay";
import type { ToolInvocation } from "../contracts/tools";
import type { ModelInvocation } from "../contracts/models";
import type { ArtifactReference } from "../contracts/artifacts";

export interface LegacyRunInput {
  runRecord: RunRecord;
  traceEvents?: TraceEvent[];
  toolCalls?: ToolCallRecord[];
  evalResults?: LegacyEvalResult[];
  artifactRefs?: string[];
  createdAt?: string;
  updatedAt?: string;
}

function mapLegacyEvalType(legacyType: LegacyEvalResult["type"]): EvalFamily {
  switch (legacyType) {
    case "schema_validity":
      return "schema_validity";
    case "tool_call_assertion":
      return "tool_selection";
    case "output_quality":
      return "output_validity";
    case "safety":
      return "safety";
    case "source_grounding":
      return "retrieval";
    case "trace_contract":
      return "trajectory";
    case "approval_gate":
      return "approval_compliance";
    case "model_benchmark":
      return "model_benchmark";
    default:
      return "output_validity";
  }
}

function mapTraceEventTypeToStepType(eventType: TraceEvent["event_type"]): ExecutionStepType {
  switch (eventType) {
    case "run_started":
    case "run_completed":
    case "run_failed":
      return "trigger";
    case "node_started":
    case "node_completed":
    case "node_failed":
      return "node";
    case "model_call_started":
    case "model_call_completed":
      return "model_call";
    case "tool_call_started":
    case "tool_call_completed":
    case "tool_call_failed":
    case "skill_call_started":
    case "skill_call_completed":
    case "skill_call_failed":
    case "cli_call_started":
    case "cli_call_completed":
    case "cli_call_failed":
      return "tool_call";
    case "eval_started":
    case "eval_completed":
      return "eval";
    case "approval_requested":
    case "approval_granted":
    case "approval_rejected":
      return "approval";
    case "artifact_created":
      return "artifact";
    case "retry_started":
    case "agent_note_recorded":
    case "error":
      return "state_change";
    default:
      return "unknown";
  }
}

/**
 * Maps a legacy AgentPulse run into the canonical RunArtifact contract.
 */
export function adaptLegacyRunToRunArtifact(input: LegacyRunInput | SavedRun): RunArtifact {
  const { runRecord } = input;
  const traceEvents = [...(input.traceEvents ?? [])].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp)
  );
  const toolCalls = input.toolCalls ?? [];
  const evalResults = input.evalResults ?? [];
  const artifactRefs = input.artifactRefs ?? runRecord.artifact_refs ?? [];

  // Trajectory: convert TraceEvents to ExecutionSteps
  const trajectory: ExecutionStep[] = traceEvents.map((evt, idx) => ({
    step_id: evt.event_id,
    step_index: idx,
    step_type: mapTraceEventTypeToStepType(evt.event_type),
    name: evt.node_id ? `${evt.node_id}: ${evt.event_type}` : evt.event_type,
    node_id: evt.node_id,
    started_at: evt.timestamp,
    completed_at: evt.duration_ms
      ? new Date(Date.parse(evt.timestamp) + evt.duration_ms).toISOString()
      : undefined,
    duration_ms: evt.duration_ms,
    status: evt.status === "failed" ? "failed" : evt.status === "degraded" ? "degraded" : "completed",
    boundary_ids: [],
    tool_invocation_ids: [],
    model_invocation_ids: [],
    memory_operation_ids: [],
    retrieval_operation_ids: [],
    eval_result_ids: [],
    artifact_ids: [],
    input_summary: evt.input_summary,
    output_summary: evt.output_summary,
    metadata: evt.metadata,
  }));

  // Tools: map ToolCallRecords to ToolInvocations
  const tools: ToolInvocation[] = toolCalls.map((tc) => ({
    tool_call_id: tc.tool_call_id,
    node_id: tc.node_id,
    tool_name: tc.tool_name,
    permission_class: tc.permission_class,
    replayability: "UNKNOWN",
    input_summary: tc.input_summary,
    output_summary: tc.output_summary,
    status: tc.status === "completed" ? "completed" : tc.status === "failed" ? "failed" : "pending",
    error: tc.error,
    started_at: tc.started_at,
    completed_at: tc.completed_at,
    duration_ms: tc.duration_ms,
  }));

  // Boundaries: build boundary entries for tools and model calls
  const boundaries: ExecutionBoundary[] = toolCalls.map((tc) => ({
    boundary_id: `bnd_tool_${tc.tool_call_id}`,
    node_id: tc.node_id,
    boundary_type: "tool_call",
    name: tc.tool_name,
    status: tc.status === "failed" ? "failed" : "completed",
    input: {
      captured: !!tc.input_summary,
      summary: tc.input_summary,
      redaction_status: "unverified",
    },
    output: tc.output_summary
      ? {
          captured: true,
          summary: tc.output_summary,
          redaction_status: "unverified",
        }
      : undefined,
    replayability: "UNKNOWN",
    side_effect_class: tc.permission_class,
    idempotency: { is_idempotent: false },
    captured_content_availability: tc.input_summary ? "summary_only" : "not_captured",
    redaction_status: "unverified",
    timestamp: tc.started_at,
    duration_ms: tc.duration_ms,
  }));

  // Models: extract model calls from model_call_completed events
  const models: ModelInvocation[] = [];
  traceEvents.forEach((evt) => {
    if (evt.event_type === "model_call_completed" || evt.event_type === "model_call_started") {
      const modelName = (evt.metadata?.["model"] as string) || (evt.metadata?.["model_name"] as string) || "unknown_model";
      const provider = (evt.metadata?.["provider"] as string) || (evt.metadata?.["model_provider"] as string) || "unknown_provider";

      // If completing an existing call, or new call:
      models.push({
        invocation_id: `model_${evt.event_id}`,
        step_id: evt.event_id,
        node_id: evt.node_id,
        model_name: modelName,
        provider,
        cost_usd: evt.cost_usd,
        duration_ms: evt.duration_ms,
        response_summary: evt.output_summary,
        raw_captured: false,
        started_at: evt.timestamp,
        metadata: evt.metadata,
      });

      boundaries.push({
        boundary_id: `bnd_model_${evt.event_id}`,
        node_id: evt.node_id,
        boundary_type: "model_call",
        name: `${provider}/${modelName}`,
        status: evt.status === "failed" ? "failed" : "completed",
        input: {
          captured: !!evt.input_summary,
          summary: evt.input_summary,
          redaction_status: "unverified",
        },
        output: evt.output_summary
          ? {
              captured: true,
              summary: evt.output_summary,
              redaction_status: "unverified",
            }
          : undefined,
        replayability: "REPLAYABLE_RECORDED",
        side_effect_class: "read_only",
        idempotency: { is_idempotent: true },
        captured_content_availability: evt.input_summary ? "summary_only" : "not_captured",
        redaction_status: "unverified",
        timestamp: evt.timestamp,
        duration_ms: evt.duration_ms,
      });
    }
  });

  // Artifacts: map string refs to ArtifactReferences
  const artifacts: ArtifactReference[] = artifactRefs.map((ref, idx) => ({
    artifact_id: `art_${runRecord.run_id}_${idx}`,
    name: ref.split("/").pop() || ref,
    type: "legacy_artifact_reference",
    uri: ref,
    created_at: runRecord.completed_at || runRecord.started_at,
  }));

  // Evals: map legacy EvalResults to canonical EvalResult
  const evals = evalResults.map((ev) => ({
    eval_id: ev.eval_id,
    eval_type: mapLegacyEvalType(ev.type),
    evaluator_id: ev.name,
    target_run_id: ev.run_id,
    target_node_id: ev.node_id,
    name: ev.name,
    score: ev.score,
    passed: ev.passed,
    severity: ev.severity,
    evidence_references: [],
    grader_type: "deterministic" as const,
    findings: ev.findings,
    recommendation: ev.recommendation,
    timestamp: runRecord.completed_at || runRecord.started_at,
  }));

  const rawArtifact: RunArtifact = {
    schema_version: CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION,
    identity: {
      run_id: runRecord.run_id,
      project_id: runRecord.project_id,
      project_name: runRecord.project_name,
      workflow_id: runRecord.workflow_id,
      created_at: input.createdAt || runRecord.started_at,
    },
    execution: {
      status: runRecord.status,
      started_at: runRecord.started_at,
      completed_at: runRecord.completed_at,
      duration_ms: runRecord.total_duration_ms,
      summary: runRecord.summary || "",
    },
    environment: {
      runtime: "unknown",
      framework: "unknown",
      env_fingerprint: "not_captured",
    },
    trajectory,
    boundaries,
    external_calls: [],
    state: [],
    context: [], // Explicitly not captured in legacy runs
    memory: {
      operations: [],
      references: [],
    },
    tools,
    retrieval: [],
    models,
    artifacts,
    evals,
    lineage: {
      mutations: [],
    },
    provenance: {
      capture_method: "legacy_adaptation",
      adapter_version: "1.0.0-compat",
      captured_by: "AgentPulseLegacyRunAdapter",
      redaction_verified: false,
    },
    safety: {
      approval_status: runRecord.approval_status ?? "not_required",
      approval_records: [],
      redaction_summary: {
        total_redactions: 0,
        secrets_detected: 0,
        fields_redacted: [],
      },
    },
    observability: {
      total_duration_ms: runRecord.total_duration_ms,
      total_cost_usd: runRecord.total_cost_usd,
      model_calls_count: runRecord.model_calls_count,
      tool_calls_count: runRecord.tool_calls_count,
      evals_passed: runRecord.evals_passed,
      evals_failed: runRecord.evals_failed,
      trace_event_count: traceEvents.length,
      context_snapshot_count: 0,
      memory_operations_count: 0,
      retrieval_operations_count: 0,
    },
    replay: {
      overall_replayability: "UNKNOWN",
      unsupported_boundaries_count: 0,
      side_effect_gated_count: 0,
      deterministic: false,
      sandboxed_available: false,
      missing_recordings: ["context_snapshots", "memory_operations", "exact_inputs"],
      notes: [
        "Adapted from legacy AgentPulse run format.",
        "Context and memory operations were not captured in this run.",
      ],
    },
  };

  return runArtifactSchema.parse(rawArtifact);
}
