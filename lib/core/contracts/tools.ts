/**
 * Canonical Tool Invocation Contracts.
 *
 * Represents an execution boundary where an agent accesses an external function, API, or system.
 */

import { z } from "zod";
import { replayabilityClassSchema, sideEffectClassSchema } from "./replay";

export const toolInvocationSchema = z.object({
  tool_call_id: z.string(),
  step_id: z.string().optional(),
  node_id: z.string().optional(),
  tool_name: z.string(),
  permission_class: sideEffectClassSchema.default("read_only"),
  replayability: replayabilityClassSchema.default("UNKNOWN"),
  input: z.unknown().optional(),
  input_summary: z.string().optional(),
  output: z.unknown().optional(),
  output_summary: z.string().optional(),
  status: z.enum(["completed", "failed", "pending", "skipped", "blocked"]),
  error: z.string().optional(),
  started_at: z.string(),
  completed_at: z.string().optional(),
  duration_ms: z.number().optional(),
  boundary_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ToolInvocation = z.infer<typeof toolInvocationSchema>;
