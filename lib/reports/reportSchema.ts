import { z } from "zod";

export const severitySchema = z.enum(["info", "low", "medium", "high", "critical"]);

export const findingSchema = z.object({
  id: z.string(),
  category: z.string(),
  severity: severitySchema,
  title: z.string(),
  summary: z.string(),
  evidencePaths: z.array(z.string()),
  recommendation: z.string(),
  confidence: z.number().min(0).max(1),
});

export const scanReportSchema = z.object({
  repoName: z.string(),
  scannedAt: z.string(),
  filesScanned: z.number(),
  ignoredFiles: z.number(),
  detectedAgents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      promptPaths: z.array(z.string()),
      toolNames: z.array(z.string()),
      evalPaths: z.array(z.string()),
      configPath: z.string().optional(),
      risks: z.array(z.string()),
    }),
  ),
  detectedPrompts: z.array(z.string()),
  detectedTools: z.array(z.string()),
  detectedEvals: z.array(z.string()),
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
});
