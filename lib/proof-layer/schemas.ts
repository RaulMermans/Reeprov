import { z } from "zod";

// ── Node types ─────────────────────────────────────────────────────────────

export const nodeTypeSchema = z.enum([
  "trigger", "llm", "agent", "tool", "evaluator",
  "approval", "artifact", "router", "retrieval", "deterministic"
]);

export const permissionClassSchema = z.enum([
  "read_only", "write_draft", "external_side_effect", "destructive", "sensitive_data"
]);

export const workflowNodeSchema = z.object({
  id: z.string(),
  type: nodeTypeSchema,
  label: z.string(),
  description: z.string().optional(),
  stage_category: z.string().optional(),
  expected_inputs: z.array(z.string()).optional(),
  expected_outputs: z.array(z.string()).optional(),
  risk_gates: z.array(z.string()).optional(),
  quality_gates: z.array(z.string()).optional(),
  model_provider: z.string().optional(),
  model_name: z.string().optional(),
  allowed_tools: z.array(z.string()).optional(),
  input_schema_ref: z.string().optional(),
  output_schema_ref: z.string().optional(),
  eval_refs: z.array(z.string()).optional(),
  permission_class: permissionClassSchema.optional(),
  timeout_ms: z.number().optional(),
  max_retries: z.number().optional(),
});

export const workflowEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  condition: z.string().optional(),
});

export const architectureTypeSchema = z.enum([
  "single_llm_call", "rag", "prompt_chain", "deterministic_workflow",
  "workflow_tools", "single_agent", "hybrid_workflow_agent", "multi_agent"
]);

export const workflowSpecSchema = z.object({
  workflow_id: z.string(),
  project_id: z.string().optional(),
  name: z.string(),
  version: z.string().optional(),
  description: z.string().optional(),
  architecture_type: architectureTypeSchema,
  nodes: z.array(workflowNodeSchema),
  expected_order: z.array(z.string()).optional(),
  edges: z.array(workflowEdgeSchema).optional(),
  allowed_tools: z.array(z.string()).optional(),
  evals: z.array(z.string()).optional(),
  approval_gates: z.array(z.string()).optional(),
  risk_gates: z.array(z.string()).optional(),
  quality_gates: z.array(z.string()).optional(),
  artifacts: z.array(z.string()).optional(),
}).refine(
  (spec) => {
    if (!spec.edges) return true;
    const nodeIds = new Set(spec.nodes.map(n => n.id));
    return spec.edges.every(e => nodeIds.has(e.from) && nodeIds.has(e.to));
  },
  { message: "Edge references a node ID not present in nodes" }
).refine(
  (spec) => {
    if (!spec.expected_order) return true;
    const nodeIds = new Set(spec.nodes.map((node) => node.id));
    const orderedNodeIds = new Set(spec.expected_order);
    return spec.expected_order.length === nodeIds.size
      && orderedNodeIds.size === nodeIds.size
      && spec.expected_order.every((nodeId) => nodeIds.has(nodeId));
  },
  { message: "Expected order must contain every workflow node exactly once" }
).refine(
  (spec) => {
    const needsApproval = spec.nodes.some(n =>
      n.permission_class === "destructive" || n.permission_class === "external_side_effect"
    );
    if (!needsApproval) return true;
    return spec.nodes.some(n => n.type === "approval");
  },
  { message: "Workflow with destructive or external_side_effect nodes requires at least one approval node" }
);

// ── TraceEvent ─────────────────────────────────────────────────────────────

export const traceEventTypeSchema = z.enum([
  "run_started", "run_completed", "run_failed",
  "node_started", "node_completed", "node_failed",
  "model_call_started", "model_call_completed",
  "tool_call_started", "tool_call_completed", "tool_call_failed",
  "skill_call_started", "skill_call_completed", "skill_call_failed",
  "cli_call_started", "cli_call_completed", "cli_call_failed",
  "eval_started", "eval_completed",
  "approval_requested", "approval_granted", "approval_rejected",
  "artifact_created",
  "retry_started",
  "agent_note_recorded",
  "error",
]);

// ── Agent notes ────────────────────────────────────────────────────────────
//
// Optional, user-safe reasoning/decision summaries an integration may attach
// to an "agent_note_recorded" trace event's metadata. Never hidden
// chain-of-thought — only a structured, integration-authored summary.
// visibility must be exactly "user_safe" for Reeprov to ever render it;
// anything else (or missing) is treated as not safe to display.

export const agentNoteTypeSchema = z.enum(["plan", "decision", "critique", "recovery", "confidence", "risk"]);
export const agentNoteConfidenceSchema = z.enum(["low", "medium", "high"]);

export const agentNoteMetadataSchema = z.object({
  note_type: agentNoteTypeSchema,
  agent: z.string().optional(),
  summary: z.string().min(1),
  confidence: agentNoteConfidenceSchema.optional(),
  visibility: z.literal("user_safe"),
});

export const traceEventSchema = z.object({
  event_id: z.string(),
  run_id: z.string(),
  workflow_id: z.string(),
  node_id: z.string().optional(),
  timestamp: z.string(),
  event_type: traceEventTypeSchema,
  status: z.enum(["started", "running", "completed", "failed", "degraded", "pending", "skipped", "blocked"]).optional(),
  duration_ms: z.number().optional(),
  cost_usd: z.number().optional(),
  input_summary: z.string().optional(),
  output_summary: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ── ToolCallRecord ─────────────────────────────────────────────────────────

export const toolCallRecordSchema = z.object({
  tool_call_id: z.string(),
  run_id: z.string(),
  node_id: z.string(),
  tool_name: z.string(),
  permission_class: permissionClassSchema,
  input_summary: z.string().optional(),
  output_summary: z.string().optional(),
  status: z.enum(["completed", "failed", "pending"]),
  error: z.string().optional(),
  started_at: z.string(),
  completed_at: z.string().optional(),
  duration_ms: z.number().optional(),
});

// ── EvalResult ─────────────────────────────────────────────────────────────

export const evalTypeSchema = z.enum([
  "schema_validity", "tool_call_assertion", "output_quality",
  "safety", "source_grounding", "trace_contract",
  "approval_gate", "model_benchmark"
]);

export const evalSeveritySchema = z.enum(["info", "warning", "fail", "critical"]);

export const evalResultSchema = z.object({
  eval_id: z.string(),
  run_id: z.string(),
  node_id: z.string().optional(),
  name: z.string(),
  type: evalTypeSchema,
  score: z.number().optional(),
  passed: z.boolean(),
  severity: evalSeveritySchema,
  findings: z.array(z.string()),
  recommendation: z.string().optional(),
  canonical_family: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ── RunRecord ──────────────────────────────────────────────────────────────

export const runStatusSchema = z.enum(["running", "completed", "failed", "degraded", "pending"]);

export const runRecordSchema = z.object({
  run_id: z.string(),
  workflow_id: z.string(),
  project_id: z.string(),
  project_name: z.string(),
  status: runStatusSchema,
  started_at: z.string(),
  completed_at: z.string().optional(),
  total_duration_ms: z.number().optional(),
  total_cost_usd: z.number().optional(),
  model_calls_count: z.number(),
  tool_calls_count: z.number(),
  evals_passed: z.number(),
  evals_failed: z.number(),
  approval_status: z.enum(["not_required", "pending", "granted", "rejected"]).optional(),
  artifact_refs: z.array(z.string()),
  summary: z.string(),
});

// ── TypeScript types ───────────────────────────────────────────────────────

export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type WorkflowSpec = z.infer<typeof workflowSpecSchema>;
export type TraceEvent = z.infer<typeof traceEventSchema>;
export type ToolCallRecord = z.infer<typeof toolCallRecordSchema>;
export type EvalResult = z.infer<typeof evalResultSchema>;
export type RunRecord = z.infer<typeof runRecordSchema>;
export type AgentNoteType = z.infer<typeof agentNoteTypeSchema>;
export type AgentNoteConfidence = z.infer<typeof agentNoteConfidenceSchema>;
export type AgentNoteMetadata = z.infer<typeof agentNoteMetadataSchema>;
