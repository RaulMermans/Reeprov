/**
 * lib/reconstruction/schema.ts
 *
 * Runtime Zod schemas for static reconstruction output.
 *
 * AgentPulse must not silently return malformed reconstruction objects. These
 * schemas validate every reconstruction returned from the engine, the API
 * routes, and test fixtures. They mirror the TypeScript types in `./types.ts`.
 */

import { z } from "zod";
import {
  nodeTypeSchema,
  permissionClassSchema,
  architectureTypeSchema,
} from "@/lib/proof-layer/schemas";

// ── Primitives ─────────────────────────────────────────────────────────────────

export const reconstructionConfidenceSchema = z.enum(["high", "medium", "low"]);

export const reconstructionSeveritySchema = z.enum(["info", "low", "medium", "high"]);

export const missingLinkTypeSchema = z.enum([
  "agent_missing_prompt",
  "agent_missing_tools",
  "agent_missing_evals",
  "agent_missing_model",
  "workflow_missing_stages",
  "stage_missing_agent",
  "stage_missing_prompt",
  "stage_missing_tools",
  "stage_missing_evals",
  "stage_missing_model",
  "tool_missing_permission_class",
  "tool_missing_approval_policy",
  "eval_unmapped",
  "prompt_unmapped",
  "model_unmapped",
]);

// ── SuggestedWorkflowSpec ─────────────────────────────────────────────────────
//
// We re-inline the base WorkflowSpec shape (rather than extending the proof
// layer's `workflowSpecSchema`) because the suggested spec is inferred from
// incomplete evidence — the engine marks gaps via `missingFields` instead of
// failing schema validation. The proof layer's refinements (edge integrity,
// approval-node requirements) apply to runtime contracts, not suggestions.

const reconstructedWorkflowNodeSchema = z.object({
  id: z.string(),
  type: nodeTypeSchema,
  label: z.string(),
  description: z.string().optional(),
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

const reconstructedWorkflowEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  condition: z.string().optional(),
});

export const suggestedWorkflowSpecSchema = z.object({
  workflow_id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().optional(),
  description: z.string().optional(),
  architecture_type: architectureTypeSchema,
  nodes: z.array(reconstructedWorkflowNodeSchema),
  edges: z.array(reconstructedWorkflowEdgeSchema).optional(),
  allowed_tools: z.array(z.string()).optional(),
  evals: z.array(z.string()).optional(),
  approval_gates: z.array(z.string()).optional(),
  artifacts: z.array(z.string()).optional(),
  source: z.enum(["manifest", "framework_adapter", "path_inference", "readme_inference", "mixed"]),
  confidence: reconstructionConfidenceSchema,
  evidencePaths: z.array(z.string()),
  missingFields: z.array(z.string()),
  recommendations: z.array(z.string()),
});

// ── MappingSummary ────────────────────────────────────────────────────────────

export const mappingSummarySchema = z.object({
  agents: z.object({
    total: z.number().int().nonnegative(),
    mappedToPrompts: z.number().int().nonnegative(),
    mappedToTools: z.number().int().nonnegative(),
    mappedToEvals: z.number().int().nonnegative(),
    mappedToModels: z.number().int().nonnegative(),
  }),
  workflows: z.object({
    total: z.number().int().nonnegative(),
    withStages: z.number().int().nonnegative(),
    stagesMappedToAgents: z.number().int().nonnegative(),
    stagesMappedToPrompts: z.number().int().nonnegative(),
    stagesMappedToTools: z.number().int().nonnegative(),
    stagesMappedToEvals: z.number().int().nonnegative(),
    stagesMappedToModels: z.number().int().nonnegative(),
  }),
  prompts: z.object({
    total: z.number().int().nonnegative(),
    mapped: z.number().int().nonnegative(),
    unmapped: z.number().int().nonnegative(),
  }),
  tools: z.object({
    total: z.number().int().nonnegative(),
    mapped: z.number().int().nonnegative(),
    withPermissionClass: z.number().int().nonnegative(),
    requiringApproval: z.number().int().nonnegative(),
  }),
  evals: z.object({
    total: z.number().int().nonnegative(),
    mapped: z.number().int().nonnegative(),
    unmapped: z.number().int().nonnegative(),
  }),
  models: z.object({
    total: z.number().int().nonnegative(),
    mapped: z.number().int().nonnegative(),
    unmapped: z.number().int().nonnegative(),
  }),
});

// ── MissingLink ───────────────────────────────────────────────────────────────

export const missingLinkSchema = z.object({
  id: z.string(),
  severity: reconstructionSeveritySchema,
  type: missingLinkTypeSchema,
  targetId: z.string(),
  targetLabel: z.string(),
  evidencePaths: z.array(z.string()),
  recommendation: z.string(),
});

// ── SuggestedManifestFile ─────────────────────────────────────────────────────

export const suggestedManifestFileSchema = z.object({
  path: z.string(),
  format: z.enum(["json", "yaml", "markdown"]),
  purpose: z.string(),
  content: z.string(),
});

// ── InstrumentationPlan ───────────────────────────────────────────────────────

export const instrumentationPlanEventSchema = z.object({
  stageId: z.string(),
  events: z.array(z.string()),
});

export const instrumentationPlanSchema = z.object({
  required: z.literal(false),
  available: z.literal(true),
  summary: z.string(),
  recommendedEnvVars: z.array(z.string()),
  suggestedEvents: z.array(instrumentationPlanEventSchema),
  codeHints: z.array(z.string()),
});

// ── ReconstructedSystemGraph ──────────────────────────────────────────────────

export const reconstructedNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum([
    "agent",
    "workflow",
    "stage",
    "prompt",
    "tool",
    "eval",
    "model",
    "approval_gate",
    "artifact",
  ]),
  confidence: reconstructionConfidenceSchema,
  sourcePath: z.string().optional(),
  missingLinks: z.array(missingLinkTypeSchema).optional(),
});

export const reconstructedEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.string(),
  confidence: reconstructionConfidenceSchema,
});

export const reconstructedSystemGraphSchema = z.object({
  nodes: z.array(reconstructedNodeSchema),
  edges: z.array(reconstructedEdgeSchema),
});

// ── StaticProofReconstruction ─────────────────────────────────────────────────

export const staticProofReconstructionSchema = z.object({
  reconstructionId: z.string().min(1),
  reportId: z.string().min(1),
  projectId: z.string().min(1),
  sourceReportVersion: z.string().min(1),
  generatedAt: z.string().min(1),
  mode: z.literal("static_inference"),
  confidence: reconstructionConfidenceSchema,
  workflowSpecs: z.array(suggestedWorkflowSpecSchema),
  systemGraph: reconstructedSystemGraphSchema,
  mappingSummary: mappingSummarySchema,
  missingLinks: z.array(missingLinkSchema),
  suggestedFiles: z.array(suggestedManifestFileSchema),
  instrumentationPlan: instrumentationPlanSchema,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Validates a reconstruction object against `staticProofReconstructionSchema`.
 * Throws a Zod-formatted error if invalid.
 */
export function assertStaticProofReconstruction(
  value: unknown,
): z.infer<typeof staticProofReconstructionSchema> {
  return staticProofReconstructionSchema.parse(value);
}

export type SuggestedWorkflowSpecSchema = z.infer<typeof suggestedWorkflowSpecSchema>;
export type MappingSummarySchema = z.infer<typeof mappingSummarySchema>;
export type MissingLinkSchema = z.infer<typeof missingLinkSchema>;
export type SuggestedManifestFileSchema = z.infer<typeof suggestedManifestFileSchema>;
export type InstrumentationPlanSchema = z.infer<typeof instrumentationPlanSchema>;
export type ReconstructedSystemGraphSchema = z.infer<typeof reconstructedSystemGraphSchema>;
export type StaticProofReconstructionSchema = z.infer<typeof staticProofReconstructionSchema>;
