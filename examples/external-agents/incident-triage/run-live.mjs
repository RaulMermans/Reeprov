#!/usr/bin/env node
/**
 * Live execution of the Incident Triage reference agent.
 *
 * Env: REEPROV_URL, REEPROV_INGEST_KEY, REEPROV_PROJECT_ID (optional),
 *      TRIAGE_RUN_ID, TRIAGE_CONTENT_MODE, TRIAGE_METRICS_CREDENTIAL (all optional;
 *      the credential is a synthetic value used to exercise redaction).
 * Prints one JSON line: { run_id, output, acks }.
 */

import { join } from "node:path";
import { ReeprovClient } from "@reeprov/client";
import { runIncidentTriage } from "./agent.mjs";

const client = new ReeprovClient({
  projectId: process.env.REEPROV_PROJECT_ID ?? "s13-incident-triage",
  projectName: "S13 Incident Triage (synthetic)",
  workflowId: "incident_triage",
  failOpen: false,
});

const result = await runIncidentTriage({
  client,
  outboxDir: join(process.cwd(), "outbox"),
  runId: process.env.TRIAGE_RUN_ID,
  contentMode: process.env.TRIAGE_CONTENT_MODE,
  metricsCredential: process.env.TRIAGE_METRICS_CREDENTIAL,
});
console.log(JSON.stringify({
  run_id: result.run_id,
  output: result.output,
  acks: result.acks.map((a) => ({ ok: a.ok, status: a.status, code: a.code, assessment: a.assessment?.status })),
}));
