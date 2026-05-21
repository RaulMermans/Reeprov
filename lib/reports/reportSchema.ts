import { z } from "zod";

// ── v2 governance schemas ──────────────────────────────────────────────────────

export const repositoryModeSchema = z.enum([
  "ai_application",
  "ai_framework_library",
  "example_template",
  "non_ai",
  "unknown_ai",
]);

export const repositoryModeScoringPolicySchema = z.object({
  aiSystemHealthApplicable: z.boolean(),
  generalHygieneApplicable: z.boolean(),
  governanceApplicable: z.boolean(),
  description: z.string(),
});

export const repositoryModeResultSchema = z.object({
  mode: repositoryModeSchema,
  confidence: z.enum(["high", "medium", "low"]),
  reasons: z.array(z.string()),
  evidence: z.array(z.string()),
  scoringPolicy: repositoryModeScoringPolicySchema,
});

export const scoreDimensionsSchema = z.object({
  aiSystemHealth: z.number().nullable(),
  generalRepoHygiene: z.number(),
  governanceCompleteness: z.number().nullable(),
  graphMappingCompleteness: z.number(),
  confidence: z.enum(["high", "medium", "low"]),
  legacyOverallScore: z.number(),
});

export const scoreCapSchema = z.object({
  dimension: z.string(),
  cap: z.number(),
  reason: z.string(),
  evidence: z.array(z.string()),
});

export const graphCompletenessMetricsSchema = z.object({
  mappedAgents: z.number(),
  totalAgents: z.number(),
  mappedPrompts: z.number(),
  totalPrompts: z.number(),
  mappedTools: z.number(),
  totalTools: z.number(),
  mappedEvals: z.number(),
  totalEvals: z.number(),
  workflowStepsWithAgent: z.number(),
  totalWorkflowSteps: z.number(),
  workflowStepsWithPrompt: z.number(),
  workflowStepsWithModel: z.number(),
  workflowStepsWithEval: z.number(),
  completenessScore: z.number(),
});

export const evalPerformanceResultSchema = z.object({
  agent: z.string().optional(),
  workflow: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  score: z.number().optional(),
  latencyMs: z.number().optional(),
  tokensInput: z.number().optional(),
  tokensOutput: z.number().optional(),
  costUsd: z.number().optional(),
  pass: z.boolean().optional(),
  sourcePath: z.string(),
});

export const performanceDataSchema = z.object({
  available: z.boolean(),
  results: z.array(evalPerformanceResultSchema),
  evalResultCount: z.number(),
  resultFiles: z.array(z.string()),
});

// ── Core schemas ───────────────────────────────────────────────────────────────

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
  reportVersion: z.string().default("1.0"),
  repoName: z.string(),
  scanSource: scanSourceSchema.optional(),
  zipStats: zipStatsSchema.optional(),
  scannedAt: z.string(),
  filesScanned: z.number(),
  ignoredFiles: z.number(),
  projectType: projectTypeSchema,
  // v2 governance fields — all optional for backward compatibility
  repositoryMode: repositoryModeResultSchema.optional(),
  scoreDimensions: scoreDimensionsSchema.optional(),
  scoreCapsApplied: z.array(scoreCapSchema).optional(),
  graphCompleteness: graphCompletenessMetricsSchema.optional(),
  performanceData: performanceDataSchema.optional(),
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
