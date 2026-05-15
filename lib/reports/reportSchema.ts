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
