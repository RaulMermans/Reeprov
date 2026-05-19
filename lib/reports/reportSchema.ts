import { z } from "zod";

export const severitySchema = z.enum(["info", "low", "medium", "high", "critical"]);

export const evidenceSnippetSchema = z.object({
  path: z.string(),
  excerpt: z.string(),
  redacted: z.boolean(),
});

export const findingSchema = z.object({
  id: z.string(),
  category: z.string(),
  severity: severitySchema,
  title: z.string(),
  summary: z.string(),
  evidencePaths: z.array(z.string()),
  recommendation: z.string(),
  confidence: z.number().min(0).max(1),
  evidenceSnippets: z.array(evidenceSnippetSchema).optional(),
});

export const agentModelMappingSchema = z.object({
  provider: z.string(),
  name: z.string().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
});

export const agentPermissionsSchema = z.object({
  externalNetwork: z.boolean().optional(),
  writeFiles: z.boolean().optional(),
  publish: z.boolean().optional(),
  extra: z.record(z.string(), z.boolean()).optional(),
});

export const detectedAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  promptPaths: z.array(z.string()),
  toolNames: z.array(z.string()),
  evalPaths: z.array(z.string()),
  configPath: z.string().optional(),
  risks: z.array(z.string()),
  source: z.enum(["explicit", "inferred"]),
  confidence: z.enum(["low", "medium", "high"]),
  evidenceReason: z.string().optional(),
  displayKind: z.enum(["manifest", "agent_file", "inferred_candidate"]).optional(),
  model: agentModelMappingSchema.optional(),
  owner: z.string().optional(),
  permissions: agentPermissionsSchema.optional(),
  files: z.record(z.string(), z.string()).optional(),
});

export const workflowStageSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  agent: z.string().optional(),
  prompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  evals: z.array(z.string()).optional(),
  model: agentModelMappingSchema.optional(),
  approvalGate: z.boolean().optional(),
  artifacts: z.array(z.string()).optional(),
});

export const detectedWorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z
    .enum(["deterministic_workflow", "workflow_with_tools", "hybrid_workflow_agent", "unknown"])
    .optional(),
  stages: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  evals: z.array(z.string()).optional(),
  configPath: z.string().optional(),
  risks: z.array(z.string()).optional(),
  source: z.enum(["explicit", "inferred"]),
  confidence: z.enum(["low", "medium", "high"]),
  evidenceReason: z.string().optional(),
  stagesDetailed: z.array(workflowStageSchema).optional(),
  owner: z.string().optional(),
  status: z.string().optional(),
  architecture: z.string().optional(),
  approvalGates: z.array(z.string()).optional(),
  artifacts: z.array(z.string()).optional(),
});

export const detectedModelConfigSchema = z.object({
  id: z.string(),
  provider: z.string(),
  model: z.string().optional(),
  sourcePath: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  source: z.enum(["manifest", "env", "code", "import"]),
  mappedAgentIds: z.array(z.string()).optional(),
});

export const detectedModelPerformanceSchema = z.object({
  agentId: z.string().optional(),
  provider: z.string(),
  model: z.string(),
  evalId: z.string().optional(),
  score: z.number().optional(),
  latencyMs: z.number().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  costUsd: z.number().optional(),
  sourcePath: z.string(),
});

export const systemGraphNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum([
    "agent",
    "workflow",
    "workflow_step",
    "prompt",
    "tool",
    "model",
    "provider",
    "eval",
    "data_source",
    "approval_gate",
    "artifact",
    "external_side_effect",
    "assistant_tooling",
    "unknown",
  ]),
  sourcePath: z.string().optional(),
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
    .optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  scope: z
    .enum(["product", "assistant_tooling", "ci", "docs", "tests", "example", "unknown"])
    .optional(),
});

export const systemGraphEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  type: z.enum([
    "uses_prompt",
    "calls_tool",
    "uses_model",
    "provided_by",
    "evaluated_by",
    "contains_step",
    "depends_on",
    "produces",
    "reads_from",
    "writes_to",
    "requires_approval",
    "has_permission",
    "related_to",
    "inferred_from",
  ]),
  confidence: z.enum(["high", "medium", "low"]),
  source: z.enum(["manifest", "file_path", "code_pattern", "inferred", "eval_result"]).optional(),
});

export const systemGraphWarningSchema = z.object({
  id: z.string(),
  severity: z.enum(["info", "low", "medium", "high"]),
  targetNodeId: z.string().optional(),
  type: z.enum([
    "agent_missing_prompt",
    "agent_missing_tools",
    "agent_missing_evals",
    "agent_missing_model",
    "workflow_missing_steps",
    "tool_missing_permission",
    "eval_not_mapped",
    "prompt_not_mapped",
    "model_not_mapped",
    "performance_data_missing",
    "assistant_tooling_not_product",
  ]),
  message: z.string(),
  recommendation: z.string(),
});

export const systemGraphSchema = z.object({
  nodes: z.array(systemGraphNodeSchema),
  edges: z.array(systemGraphEdgeSchema),
  warnings: z.array(systemGraphWarningSchema),
  summary: z.object({
    agentCount: z.number(),
    workflowCount: z.number(),
    promptCount: z.number(),
    toolCount: z.number(),
    modelCount: z.number(),
    evalCount: z.number(),
    mappedAgentCount: z.number(),
    unmappedAgentCount: z.number(),
    missingPromptLinks: z.number(),
    missingToolLinks: z.number(),
    missingEvalLinks: z.number(),
    missingModelLinks: z.number(),
  }),
});

export const detectedCIWorkflowSchema = z.object({
  name: z.string(),
  path: z.string(),
  provider: z.enum(["github_actions", "gitlab", "circleci", "unknown"]),
});

export const projectTypeSchema = z.enum([
  "agent_system",
  "workflow_system",
  "hybrid_workflow_agent",
  "ai_application",
  "unknown_ai_project",
]);

export const scanSourceSchema = z.object({
  type: z.enum(["github", "zip", "mock"]),
  label: z.string(),
  owner: z.string().optional(),
  repo: z.string().optional(),
  filename: z.string().optional(),
});

export const zipStatsSchema = z.object({
  totalEntries: z.number(),
  totalFiles: z.number(),
  candidateFiles: z.number(),
  scannedFiles: z.number(),
  skippedByFileLimit: z.number(),
  strippedRootFolder: z.string().optional(),
});

export const scanReportSchema = z.object({
  repoName: z.string(),
  scanSource: scanSourceSchema.optional(),
  zipStats: zipStatsSchema.optional(),
  scannedAt: z.string(),
  filesScanned: z.number(),
  ignoredFiles: z.number(),
  projectType: projectTypeSchema,
  detectedAgents: z.array(detectedAgentSchema),
  detectedWorkflowsDetailed: z.array(detectedWorkflowSchema),
  detectedCIWorkflows: z.array(detectedCIWorkflowSchema),
  detectedPrompts: z.array(z.string()),
  detectedPromptRelatedFiles: z.array(z.string()).optional(),
  detectedTools: z.array(z.string()),
  detectedEvals: z.array(z.string()),
  detectedTests: z.array(z.string()),
  detectedWorkflows: z.array(z.string()),
  detectedModels: z.array(detectedModelConfigSchema).optional(),
  modelPerformance: z.array(detectedModelPerformanceSchema).optional(),
  systemGraph: systemGraphSchema.optional(),
  findings: z.array(findingSchema),
  scores: z.object({
    architecture: z.number(),
    promptQuality: z.number(),
    toolGovernance: z.number(),
    evalCoverage: z.number(),
    security: z.number(),
    documentation: z.number(),
    overall: z.number(),
  }),
  recommendations: z.array(z.string()),
  auditorStatus: z
    .object({
      llmAuditorsEnabled: z.boolean(),
      promptAuditorRan: z.boolean(),
      provider: z.string().optional(),
      model: z.string().optional(),
      error: z.string().optional(),
    })
    .optional(),
});
