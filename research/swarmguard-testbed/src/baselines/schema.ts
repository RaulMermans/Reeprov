/**
 * Frozen monitor output contract. Baselines and the future SwarmGuard
 * verifier emit this schema. No ground-truth fields are permitted.
 */

import { z } from "zod";
import type { RunArtifact } from "../../../../lib/core/contracts/runArtifact";
import { assertIsolated } from "../leakcheck";

export const MONITOR_RESULT_FORMAT = "reeprov.swarmguard_testbed.monitor_result.v1" as const;

export const monitorClassSchema = z.enum(["supported", "contradicted", "unverified"]);
export type MonitorClass = z.infer<typeof monitorClassSchema>;

export const claimPredictionSchema = z.object({
  claim_id: z.string(),
  agent_id: z.string(),
  event_id: z.string().optional(),
  handoff_id: z.string().optional(),
  event_kind: z.enum(["assertion", "handoff"]),
  classification: monitorClassSchema,
  originating_agent_id: z.string().optional(),
  event_or_handoff_id: z.string().optional(),
  abstained: z.boolean(),
  rationale: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  capture_incomplete: z.boolean().default(false),
});
export type ClaimPrediction = z.infer<typeof claimPredictionSchema>;

export const monitorResultSchema = z.object({
  format: z.literal(MONITOR_RESULT_FORMAT),
  monitor_id: z.string(),
  monitor_version: z.string(),
  case_id: z.string().optional(),
  run_id: z.string(),
  domain_id: z.string(),
  predictions: z.array(claimPredictionSchema),
  latency_ms: z.number().nonnegative(),
  token_usage: z
    .object({
      prompt: z.number().nonnegative().optional(),
      completion: z.number().nonnegative().optional(),
      cost_usd: z.number().nonnegative().optional(),
    })
    .optional(),
  limitations: z.array(z.string()),
});
export type MonitorResult = z.infer<typeof monitorResultSchema>;

export interface ObservableClaim {
  claim_id: string;
  agent_id: string;
  event_kind: "assertion" | "handoff";
  event_id?: string;
  handoff_id?: string;
  claim?: string;
  evidence_refs: string[];
  artifact_refs: string[];
  payload?: unknown;
  capture_incomplete: boolean;
}

export function extractObservableClaims(artifact: RunArtifact): ObservableClaim[] {
  const claims: ObservableClaim[] = [];
  for (const event of artifact.evidence?.verification_events ?? []) {
    if (event.origin !== "agent_asserted") continue;
    const capture = event.details?.["capture_status"];
    const claimText = typeof event.details?.["claim"] === "string" ? event.details["claim"] : undefined;
    const incomplete = capture !== "captured" || !claimText;
    claims.push({
      claim_id: event.target_id ?? event.event_id,
      agent_id: event.actor,
      event_kind: "assertion",
      event_id: event.event_id,
      claim: claimText,
      evidence_refs: event.evidence_refs ?? [],
      artifact_refs: event.artifact_refs ?? [],
      capture_incomplete: incomplete,
    });
  }
  for (const handoff of artifact.handoffs ?? []) {
    const status = handoff.payload_capture_status;
    const incomplete = status === "omitted" || status === "structure_only" || status === "incomplete";
    claims.push({
      claim_id: `handoff:${handoff.handoff_id}`,
      agent_id: handoff.from_agent_id ?? "unknown",
      event_kind: "handoff",
      handoff_id: handoff.handoff_id,
      claim: handoff.payload_summary,
      evidence_refs: handoff.evidence_refs ?? [],
      artifact_refs: handoff.artifact_refs ?? [],
      payload: handoff.payload,
      capture_incomplete: Boolean(incomplete),
    });
  }
  return claims;
}

export function assertMonitorEvidenceAuthorized(artifact: RunArtifact): void {
  const isolation = assertIsolated(artifact);
  if (!isolation.isolated) {
    throw new Error(`Monitor received leaked evaluator fields: ${isolation.leaks.join("; ")}`);
  }
}

export function predictionFor(
  claim: ObservableClaim,
  classification: MonitorClass,
  rationale: string,
  extra?: Partial<ClaimPrediction>
): ClaimPrediction {
  const abstained = classification === "unverified";
  return claimPredictionSchema.parse({
    claim_id: claim.claim_id,
    agent_id: claim.agent_id,
    event_id: claim.event_id,
    handoff_id: claim.handoff_id,
    event_kind: claim.event_kind,
    classification,
    originating_agent_id: claim.agent_id,
    event_or_handoff_id: claim.event_id ?? claim.handoff_id,
    abstained,
    rationale,
    confidence: abstained ? "low" : "medium",
    capture_incomplete: claim.capture_incomplete,
    ...extra,
  });
}
