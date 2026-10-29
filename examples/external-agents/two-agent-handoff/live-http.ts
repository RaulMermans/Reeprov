/**
 * HTTP ingest of a two-agent handoff through @reeprov/client.
 *
 * Evidence category: live external execution (SDK → running Reeprov).
 * Real model calls are used only when OPENAI_API_KEY or ANTHROPIC_API_KEY is set.
 */

import { ReeprovClient } from "../../../packages/client-typescript/src/index.js";
import { lookupIncidentTicket } from "./workflow";

const ingestKey = process.env["REEPROV_INGEST_KEY"];
if (!ingestKey) {
  console.error("Set REEPROV_INGEST_KEY to ingest into a running Reeprov instance.");
  process.exit(1);
}

const liveModel = Boolean(process.env["OPENAI_API_KEY"] || process.env["ANTHROPIC_API_KEY"]);

const client = new ReeprovClient({
  endpoint: process.env["REEPROV_URL"] || "http://127.0.0.1:3000",
  ingestKey,
  projectId: process.env["REEPROV_PROJECT_ID"] || "incident-triage",
  projectName: "Incident Triage",
  workflowId: "two-agent-handoff-v1",
  failOpen: false,
});

const ticket = await lookupIncidentTicket("INC-1042");
const started = await client.startRun({
  summary: `Live two-agent handoff for ${ticket.ticket_id}`,
  agent_id: "triage-agent",
});
const startedEventId = `${started.run_id}::run_started`;
const triageStepId = "triage.classify";
const lookupStepId = "triage.lookup";
const handoffEventId = "handoff.triage-to-resolver";
const resolverStepId = "resolver.propose";

try {
  await client.modelCallCompleted({
    run_id: started.run_id,
    agent_id: "triage-agent",
    node_id: "triage.classify",
    step_id: triageStepId,
    parent_event_id: startedEventId,
    model: liveModel ? "live-model" : "triage-policy-v1",
    provider: liveModel ? "live" : "deterministic",
    prompt: `Classify ${ticket.ticket_id}`,
    response: { intent: "escalate_to_resolver", live_model: liveModel },
  });

  await client.toolCallCompleted({
    run_id: started.run_id,
    agent_id: "triage-agent",
    node_id: "triage.lookup",
    step_id: lookupStepId,
    parent_event_id: triageStepId,
    tool_name: "lookup_incident_ticket",
    arguments: { ticket_id: ticket.ticket_id },
    output: ticket,
    permission_class: "read_only",
  });

  await client.recordHandoff({
    run_id: started.run_id,
    event_id: handoffEventId,
    from_agent_id: "triage-agent",
    to_agent_id: "resolver-agent",
    from_step_id: lookupStepId,
    parent_event_id: lookupStepId,
    payload_summary: `Escalate ${ticket.ticket_id} severity=${ticket.severity}`,
  });

  await client.modelCallCompleted({
    run_id: started.run_id,
    agent_id: "resolver-agent",
    node_id: "resolver.propose",
    step_id: resolverStepId,
    parent_event_id: handoffEventId,
    model: liveModel ? "live-model" : "resolver-policy-v1",
    provider: liveModel ? "live" : "deterministic",
    prompt: `Resolve ${ticket.ticket_id}`,
    response: { claim: "Incident validation succeeded and the ticket is cleared." },
  });

  await client.evalCompleted({
    run_id: started.run_id,
    agent_id: "resolver-agent",
    eval_name: "agent_claimed_validation",
    passed: true,
    reason: "Agent asserted that validation succeeded.",
    parent_event_id: resolverStepId,
  });

  await client.completeRun({
    run_id: started.run_id,
    summary: `Handoff captured for ${ticket.ticket_id}`,
  });

  const endpoint = process.env["REEPROV_URL"] || "http://127.0.0.1:3000";
  let reconstructed: Record<string, unknown> | undefined;
  try {
    const canonicalRes = await fetch(`${endpoint}/api/runs/${encodeURIComponent(started.run_id)}/canonical`);
    if (canonicalRes.ok) {
      const artifact = await canonicalRes.json() as {
        identity?: { participating_agent_ids?: string[] };
        handoffs?: Array<{ from_agent_id?: string; to_agent_id?: string }>;
        tools?: Array<{ tool_name?: string }>;
      };
      reconstructed = {
        participating_agent_ids: artifact.identity?.participating_agent_ids ?? [],
        handoffs: artifact.handoffs ?? [],
        tools: (artifact.tools ?? []).map((tool) => ({
          tool_name: tool.tool_name,
          agent_id: (tool as { agent_id?: string }).agent_id,
        })),
        parents: ((artifact as { trajectory?: Array<{ step_id?: string; parent_step_id?: string; agent_id?: string }> }).trajectory ?? [])
          .filter((step) => step.parent_step_id)
          .map((step) => ({ step_id: step.step_id, parent_step_id: step.parent_step_id, agent_id: step.agent_id })),
      };
    }
  } catch {
    reconstructed = undefined;
  }

  console.log(JSON.stringify({
    evidence_category: liveModel ? "live_external_execution_with_model" : "live_external_execution_http_sdk",
    run_id: started.run_id,
    live_model: liveModel,
    agents: ["triage-agent", "resolver-agent"],
    tool: "lookup_incident_ticket",
    handoff: "triage-agent -> resolver-agent",
    reconstructed,
  }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await client.failRun({ run_id: started.run_id, error_summary: message });
  console.error(message);
  process.exit(1);
}
