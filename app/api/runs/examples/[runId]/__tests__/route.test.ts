import { describe, expect, it } from "vitest";
import { GET } from "../route";
import { getRunStore } from "@/lib/db/getStores";
import { runRecordSchema } from "@/lib/proof-layer/schemas";

describe("GET /api/runs/examples/[runId] — Public Demo Run Route", () => {
  it("allows unauthenticated access to bundled static example runs", async () => {
    const request = new Request("http://localhost:3000/api/runs/examples/wa-run-001");
    const response = await GET(request, {
      params: Promise.resolve({ runId: "wa-run-001" }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.run).toBeDefined();
    expect(data.run.run_id).toBe("wa-run-001");
    expect(data.traceEvents).toBeInstanceOf(Array);
    expect(data.workflow).toBeDefined();
  });

  it("returns 404 for arbitrary non-example run IDs", async () => {
    const request = new Request("http://localhost:3000/api/runs/examples/nonexistent-run-999");
    const response = await GET(request, {
      params: Promise.resolve({ runId: "nonexistent-run-999" }),
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.message).toContain("not found");
  });

  it("never resolves or leaks user runs created in user storage", async () => {
    const userRunId = "user-private-run-dogfood-123";
    const userRunRecord = runRecordSchema.parse({
      run_id: userRunId,
      workflow_id: "private-workflow",
      project_id: "private-project",
      project_name: "Private Project",
      status: "completed",
      started_at: new Date().toISOString(),
      model_calls_count: 1,
      tool_calls_count: 1,
      evals_passed: 1,
      evals_failed: 0,
      artifact_refs: [],
      summary: "Private user run containing sensitive user data",
    });

    // Save user run to user run store
    await getRunStore().createRun(userRunRecord);

    // Verify it exists in user run store
    const inStore = await getRunStore().getRun(userRunId);
    expect(inStore).not.toBeNull();

    // The public example route must NOT expose it
    const request = new Request(`http://localhost:3000/api/runs/examples/${userRunId}`);
    const response = await GET(request, {
      params: Promise.resolve({ runId: userRunId }),
    });

    expect(response.status).toBe(404);
  });
});
