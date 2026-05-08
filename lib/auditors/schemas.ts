import { z } from "zod";

export const promptAuditorFindingSchema = z.object({
  category: z.literal("prompt_quality"),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  title: z.string().min(1),
  summary: z.string().min(1),
  evidencePaths: z.array(z.string()),
  recommendation: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const promptAuditorResultSchema = z.object({
  findings: z.array(promptAuditorFindingSchema),
  score: z.number().min(0).max(100),
  modelUsed: z.string().optional(),
  llmAuditorEnabled: z.boolean(),
  llmAuditorRan: z.boolean(),
});

export type PromptAuditorFinding = z.infer<typeof promptAuditorFindingSchema>;
export type PromptAuditorResult = z.infer<typeof promptAuditorResultSchema>;
