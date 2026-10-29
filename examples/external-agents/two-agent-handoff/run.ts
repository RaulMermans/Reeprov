/**
 * Local CaptureSession demonstration of a two-agent handoff.
 *
 * Evidence category: offline recorded capture (deterministic, no live model).
 *
 * HTTP live ingest against a running Studio instance:
 *   REEPROV_INGEST_KEY=... npx tsx examples/external-agents/two-agent-handoff/live-http.ts
 */

import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CaptureSession } from "../../../lib/core/capture/sdk";
import { InMemoryContentStore, setContentStore } from "../../../lib/core/capture/contentStore";
import { exportRunEvidenceBundle } from "../../../lib/core/evidence/exportBundle";
import { runTwoAgentIncidentHandoff } from "./workflow";

setContentStore(new InMemoryContentStore());

const session = new CaptureSession({
  projectId: "incident-triage",
  workflowId: "two-agent-handoff-v1",
  summary: "Two-agent incident handoff",
  runId: `run_two_agent_${Date.now()}`,
});

const result = await runTwoAgentIncidentHandoff(session);
const bundle = exportRunEvidenceBundle(result.artifact);
const outPath = join(tmpdir(), `two-agent-handoff-${result.artifact.identity.run_id}.json`);
await writeFile(outPath, JSON.stringify(bundle, null, 2));

console.log(JSON.stringify({
  evidence_category: "offline_recorded_capture",
  run_id: result.artifact.identity.run_id,
  participating_agent_ids: result.artifact.identity.participating_agent_ids,
  handoff_id: result.handoffId,
  tool_call_id: result.toolCallId,
  export: outPath,
  integrity: {
    valid: bundle.integrity.valid,
    authoritative_verification_count: bundle.integrity.authoritative_verification_count,
    asserted_only_verification_count: bundle.integrity.asserted_only_verification_count,
    outcome_authoritative: bundle.integrity.outcome_authoritative,
  },
}, null, 2));
