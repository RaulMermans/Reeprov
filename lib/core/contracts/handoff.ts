/**
 * Cross-agent handoff contract.
 *
 * Records a transfer of control or context between agents inside one run.
 * Missing from/to identifiers are preserved as unknown rather than inferred.
 */

import { z } from "zod";

export const handoffAttributionStatusSchema = z.enum([
  "resolved",
  "partial",
  "unknown",
]);

export type HandoffAttributionStatus = z.infer<typeof handoffAttributionStatusSchema>;

export const payloadCaptureStatusSchema = z.enum([
  "captured",
  "redacted",
  "structure_only",
  "omitted",
  "incomplete",
]);

export type PayloadCaptureStatus = z.infer<typeof payloadCaptureStatusSchema>;

export const agentHandoffSchema = z.object({
  handoff_id: z.string(),
  run_id: z.string(),
  from_agent_id: z.string().optional(),
  to_agent_id: z.string().optional(),
  from_step_id: z.string().optional(),
  to_step_id: z.string().optional(),
  parent_event_id: z.string().optional(),
  payload_summary: z.string().optional(),
  /**
   * Delivered handoff body. Optional and backward-compatible.
   * Omitted when capture policy forbids content or when nothing was supplied.
   * Never treat a missing payload as a successful observation of an empty handoff.
   */
  payload: z.unknown().optional(),
  payload_capture_status: payloadCaptureStatusSchema.optional(),
  artifact_refs: z.array(z.string()).default([]),
  evidence_refs: z.array(z.string()).default([]),
  timestamp: z.string(),
  attribution_status: handoffAttributionStatusSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type AgentHandoff = z.infer<typeof agentHandoffSchema>;

export function handoffAttributionStatus(
  fromAgentId?: string,
  toAgentId?: string
): HandoffAttributionStatus {
  if (fromAgentId && toAgentId) return "resolved";
  if (fromAgentId || toAgentId) return "partial";
  return "unknown";
}
