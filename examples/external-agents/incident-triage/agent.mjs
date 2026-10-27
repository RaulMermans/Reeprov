/**
 * Incident Triage reference agent — live run orchestration.
 *
 * Uses only the public @reeprov/client API. Data sources are synthetic and
 * local; the two side-effecting tools really write to `outboxDir`, so a live
 * side effect is observable (replay and fork must never repeat it).
 */

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createCapturingDependencies } from "@reeprov/client";
import { createHostAdapter, STEPS } from "./adapter.mjs";

const INCIDENTS = {
  "INC-2041": {
    incident_id: "INC-2041",
    service: "checkout-api",
    region: "eu-west",
    title: "Elevated checkout latency; card payments failing for some EU customers",
    opened_by: "synthetic-monitor",
  },
};
const METRICS = {
  "checkout-api": {
    error_rate: 0.032,
    p99_latency_ms: 4200,
    payment_path: true,
    payment_failures_per_min: 112,
    customer_reports: 37,
    affected_customers_estimate: 1240,
  },
};
const RUNBOOKS = {
  "checkout-api": {
    runbook_id: "RB-CHECKOUT",
    oncall_team: "payments-oncall",
    rules: [
      { id: "RB-PAY-001", text: "Payment-path failures with confirmed customer impact are SEV1 regardless of error rate. Page payments on-call." },
      { id: "RB-GEN-004", text: "Error rate above 5% for 10 minutes is SEV1." },
    ],
  },
};

export function createLiveDependencies(outbox) {
  return {
    async callTool({ name, args }) {
      switch (name) {
        case "get_incident": return INCIDENTS[args.incident_id];
        case "query_metrics": return METRICS[args.service];
        case "get_runbook": return RUNBOOKS[args.service];
        case "create_ticket": {
          await mkdir(outbox, { recursive: true });
          await appendFile(join(outbox, "tickets.jsonl"), `${JSON.stringify(args)}\n`);
          return { ticket_id: `TCK-${args.incident_id}`, queue: args.queue };
        }
        case "page_oncall": {
          await mkdir(outbox, { recursive: true });
          await appendFile(join(outbox, "pages.jsonl"), `${JSON.stringify(args)}\n`);
          return { page_id: `PG-${args.incident_id}`, team: args.team };
        }
        default: throw new Error(`unknown tool ${name}`);
      }
    },
    // Deterministic local summarizer standing in for a model (no LLM provider is used).
    async callModel({ evidence }) {
      return {
        text: `${evidence.incident.title}. error_rate=${evidence.metrics.error_rate}, ` +
          `payment_failures_per_min=${evidence.metrics.payment_failures_per_min}, ` +
          `customer_reports=${evidence.metrics.customer_reports}. Runbooks: ${evidence.runbook_ids.join(", ")}.`,
      };
    },
  };
}


/**
 * Runs the agent live against Reeprov.
 * @returns {{ run_id: string, output: object, acks: object[] }}
 */
export async function runIncidentTriage({ client, outboxDir, runId, contentMode, metricsCredential, input = { incident_id: "INC-2041" } }) {
  const adapter = createHostAdapter({ metricsCredential });
  const run = await client.startRun({ summary: `Triage synthetic incident ${input.incident_id}`, run_id: runId, contentMode });
  let currentStep;
  const deps = createCapturingDependencies(client, run.run_id, createLiveDependencies(outboxDir), { currentNode: () => currentStep });
  const acks = [];
  // STRUCTURE_ONLY runs store no content, so no restorable snapshot can exist:
  // record checkpoint observations instead of registering checkpoints.
  const checkpoint = contentMode === "STRUCTURE_ONLY"
    ? (cp) => client.checkpointObserved({ run_id: cp.run_id, checkpoint_id: cp.checkpoint_id, step_id: cp.step_id })
    : (cp) => client.registerCheckpoint(cp);

  const initial = adapter.initialState(input);
  acks.push(await checkpoint({
    run_id: run.run_id, checkpoint_id: "start", step_id: STEPS[0], step_index: 0, position: "BEFORE_STEP",
    resume_step_index: 0, resume_step_id: STEPS[0], state: initial, adapter: adapter.identity,
  }));

  try {
    const { output } = await adapter.run({
      state: initial,
      fromStepIndex: 0,
      deps,
      hooks: {
        onStepStart: (_i, id) => { currentStep = id; },
        onStepComplete: async (index, id, state) => {
          if (id === "summarize_evidence") {
            acks.push(await checkpoint({
              run_id: run.run_id, checkpoint_id: "after_evidence", step_id: id, step_index: index, position: "AFTER_STEP",
              resume_step_index: index + 1, resume_step_id: STEPS[index + 1], state, adapter: adapter.identity,
            }));
          }
        },
      },
    });
    acks.push(await client.completeRun({ run_id: run.run_id, summary: `${output.severity}: ${output.action}`, output }));
    return { run_id: run.run_id, output, acks };
  } catch (err) {
    await client.failRun({ run_id: run.run_id, error_summary: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
