/**
 * Canonical Model Invocation Contracts.
 *
 * Represents an interaction with a foundation model / LLM provider.
 * Linked to a specific ContextSnapshot to enable token attribution and prompt debugging.
 */

import { z } from "zod";

export const modelInvocationSchema = z.object({
  invocation_id: z.string(),
  step_id: z.string().optional(),
  node_id: z.string().optional(),
  agent_id: z.string().optional(),
  model_name: z.string(),
  provider: z.string(),                          // e.g. "anthropic", "openai", "google", "ollama"
  parameters: z.record(z.string(), z.unknown()).optional(), // temperature, top_p, max_tokens, etc.
  prompt_tokens: z.number().int().nonnegative().optional(),
  completion_tokens: z.number().int().nonnegative().optional(),
  total_tokens: z.number().int().nonnegative().optional(),
  cost_usd: z.number().nonnegative().optional(),
  duration_ms: z.number().nonnegative().optional(),
  context_snapshot_id: z.string().optional(),
  response_summary: z.string().optional(),
  raw_captured: z.boolean().default(false),
  response_hash: z.string().optional(),
  finish_reason: z.string().optional(),
  started_at: z.string(),
  completed_at: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ModelInvocation = z.infer<typeof modelInvocationSchema>;
