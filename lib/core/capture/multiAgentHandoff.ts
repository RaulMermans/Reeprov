/**
 * Reusable two-agent handoff harness.
 *
 * Captures a single run with distinct agent identities, one observed tool
 * result, and an explicit handoff. Agent-asserted "validation succeeded"
 * claims are recorded separately from system-recorded observations.
 */

import { CaptureSession } from "./sdk";
import type { RunArtifact } from "../contracts/runArtifact";

export const TRIAGE_AGENT_ID = "triage-agent";
export const RESOLVER_AGENT_ID = "resolver-agent";

export interface IncidentTicket {
  ticket_id: string;
  severity: "low" | "medium" | "high";
  status: "open" | "acknowledged";
}

export interface TwoAgentHandoffResult {
  artifact: RunArtifact;
  ticket: IncidentTicket;
  handoffId: string;
  triageStepId: string;
  resolverStepId: string;
  toolCallId?: string;
}

const TICKET_LEDGER: Record<string, IncidentTicket> = {
  "INC-1042": { ticket_id: "INC-1042", severity: "high", status: "open" },
};

export async function lookupIncidentTicket(ticketId: string): Promise<IncidentTicket> {
  const ticket = TICKET_LEDGER[ticketId];
  if (!ticket) {
    throw new Error(`Unknown ticket ${ticketId}`);
  }
  return { ...ticket };
}

export async function runTwoAgentIncidentHandoff(
  session: CaptureSession,
  ticketId = "INC-1042"
): Promise<TwoAgentHandoffResult> {
  let triageStepId = "";
  let resolverStepId = "";
  let toolCallId: string | undefined;
  let ticket: IncidentTicket = { ticket_id: ticketId, severity: "medium", status: "open" };

  await session.step(
    "classify-incident",
    "model_call",
    async (stepId) => {
      triageStepId = stepId;
      session.captureState({ phase: "triage", ticketId }, { stepId, type: "INITIAL_STATE" });
      await session.captureModel({
        stepId,
        provider: "deterministic",
        model: "triage-policy-v1",
        prompt: `Classify incident ${ticketId}`,
        response: { intent: "escalate_to_resolver", ticket_id: ticketId },
        startedAt: new Date().toISOString(),
      });
      return "escalate";
    },
    { agentId: TRIAGE_AGENT_ID, nodeId: "triage.classify" }
  );

  await session.step(
    "lookup-ticket",
    "tool_call",
    async (stepId) => {
      ticket = await lookupIncidentTicket(ticketId);
      const captured = await session.captureTool({
        stepId,
        toolName: "lookup_incident_ticket",
        arguments: { ticket_id: ticketId },
        output: ticket,
        startedAt: new Date().toISOString(),
        declaredPermissionClass: "read_only",
      });
      toolCallId = captured?.toolInvocation.tool_call_id;
      session.captureState({ phase: "ticket_observed", ticket }, { stepId });
      return ticket;
    },
    { agentId: TRIAGE_AGENT_ID, nodeId: "triage.lookup", parentStepId: triageStepId }
  );

  const handoff = session.recordHandoff({
    fromAgentId: TRIAGE_AGENT_ID,
    toAgentId: RESOLVER_AGENT_ID,
    fromStepId: triageStepId,
    payloadSummary: `Escalate ${ticket.ticket_id} severity=${ticket.severity}`,
    evidenceRefs: toolCallId ? [toolCallId] : [],
  });

  await session.step(
    "propose-resolution",
    "model_call",
    async (stepId) => {
      resolverStepId = stepId;
      await session.captureModel({
        stepId,
        provider: "deterministic",
        model: "resolver-policy-v1",
        prompt: `Resolve ${ticket.ticket_id}`,
        response: {
          claim: "Incident validation succeeded and the ticket is cleared.",
          ticket_id: ticket.ticket_id,
        },
        startedAt: new Date().toISOString(),
      });
      session.captureState({ phase: "resolver_claim", ticket }, { stepId, type: "FINAL_STATE" });
      return "claimed";
    },
    { agentId: RESOLVER_AGENT_ID, nodeId: "resolver.propose", parentStepId: handoff.from_step_id }
  );

  session.recordVerification({
    event_id: `vevt_${session.runId}_agent_claim`,
    event_type: "test.passed",
    target_type: "test",
    target_id: "agent_claimed_validation",
    status: "PASSED",
    actor: RESOLVER_AGENT_ID,
    origin: "agent_asserted",
    authority: "asserted",
    evidence_refs: [],
    artifact_refs: [],
  });

  const observed = session.verification.startTest("incident-observation", "ticket_lookup_observed");
  observed.pass({ artifactRefs: toolCallId ? [toolCallId] : [] });

  session.setOutcome({
    status: "SUCCESS",
    verification_status: "PASS",
    summary: "Two-agent incident handoff captured",
  });

  const artifact = await session.finishRun({
    summary: `Incident ${ticket.ticket_id} handed from ${TRIAGE_AGENT_ID} to ${RESOLVER_AGENT_ID}`,
  });

  return {
    artifact,
    ticket,
    handoffId: handoff.handoff_id,
    triageStepId,
    resolverStepId,
    toolCallId,
  };
}
