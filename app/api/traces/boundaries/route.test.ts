import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { POST as startRun } from "@/app/api/runs/start/route";
import { getCanonicalRun } from "@/lib/core/capture/persistence";

let storeDir: string;
const priorStoreDir = process.env["AGENTPULSE_STORE_DIR"];
const priorKey = process.env["AGENTPULSE_INGEST_KEY"];

beforeEach(async () => {
  storeDir = await mkdtemp(join(tmpdir(), "reeprov-boundaries-"));
  process.env["AGENTPULSE_STORE_DIR"] = storeDir;
  process.env["AGENTPULSE_INGEST_KEY"] = "s12-test-key";
});

afterEach(async () => {
  if (priorStoreDir === undefined) delete process.env["AGENTPULSE_STORE_DIR"];
  else process.env["AGENTPULSE_STORE_DIR"] = priorStoreDir;
  if (priorKey === undefined) delete process.env["AGENTPULSE_INGEST_KEY"];
  else process.env["AGENTPULSE_INGEST_KEY"] = priorKey;
  await rm(storeDir, { recursive: true, force: true });
});

const request = (path: string, body: unknown) => new Request(`http://localhost${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-agentpulse-key": "s12-test-key" },
  body: JSON.stringify(body),
});

describe("published SDK boundary ingestion", () => {
  it("preserves repeated same-type boundaries without client sequence numbers", async () => {
    const start = await startRun(request("/api/runs/start", {
      project_id: "s12", project_name: "Sprint 12", workflow_id: "incident", summary: "Synthetic incident",
    }));
    expect(start.status).toBe(201);
    const { run_id: runId } = await start.json() as { run_id: string };

    for (const name of ["lookup_incident_metrics", "lookup_escalation_policy"]) {
      const response = await POST(request("/api/traces/boundaries", {
        boundaries: [{ runId, boundaryType: "tool_call", name, input: {}, output: { value: 1 } }],
      }));
      expect(await response.json()).toMatchObject({ accepted: 1, rejected: 0 });
    }

    const artifact = await getCanonicalRun(runId);
    expect(artifact?.boundaries.map((boundary) => boundary.name)).toEqual([
      "lookup_incident_metrics", "lookup_escalation_policy",
    ]);
    expect(artifact?.boundaries.map((boundary) => boundary.sequence_index)).toEqual([0, 1]);
  });

  it("reports a missing run as rejected", async () => {
    const response = await POST(request("/api/traces/boundaries", {
      boundaries: [{ runId: "unknown", boundaryType: "tool_call", name: "lookup", input: {} }],
    }));
    expect(await response.json()).toMatchObject({ accepted: 0, rejected: 1 });
  });
});
