/**
 * Ingest diagnostics — file-backed store tests.
 *
 * Uses a real temp directory per test run. Overrides AGENTPULSE_STORE_DIR so
 * tests don't pollute .agentpulse/diagnostics.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileDiagnosticStore } from "@/lib/diagnostics/fileDiagnosticStore";
import { MAX_DIAGNOSTICS_PER_PROJECT } from "@/lib/diagnostics/diagnosticTypes";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "agentpulse-diagnostics-test-"));
  process.env["AGENTPULSE_STORE_DIR"] = tmpDir;
});

afterEach(async () => {
  delete process.env["AGENTPULSE_STORE_DIR"];
  await rm(tmpDir, { recursive: true, force: true });
});

describe("fileDiagnosticStore", () => {
  it("records and lists a diagnostic", async () => {
    const diagnostic = await fileDiagnosticStore.recordDiagnostic({
      projectId: "proj-a",
      category: "missing_run_id",
      errorCode: "400",
      message: "run_id is required.",
    });

    expect(diagnostic.diagnosticId).toMatch(/^diag_/);
    expect(diagnostic.createdAt).toBeTruthy();

    const listed = await fileDiagnosticStore.listDiagnostics({ projectId: "proj-a" });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.category).toBe("missing_run_id");
  });

  it("filters by projectId and integrationId independently", async () => {
    await fileDiagnosticStore.recordDiagnostic({
      projectId: "proj-a",
      category: "run_not_found",
      errorCode: "404",
      message: "Run not found.",
    });
    await fileDiagnosticStore.recordDiagnostic({
      projectId: "proj-b",
      integrationId: "integ-1",
      category: "run_not_found",
      errorCode: "404",
      message: "Run not found.",
    });

    const forProjectA = await fileDiagnosticStore.listDiagnostics({ projectId: "proj-a" });
    expect(forProjectA).toHaveLength(1);

    const forIntegration1 = await fileDiagnosticStore.listDiagnostics({ integrationId: "integ-1" });
    expect(forIntegration1).toHaveLength(1);
    expect(forIntegration1[0]?.projectId).toBe("proj-b");
  });

  it("never persists a raw ingest key or authorization header value in the message", async () => {
    const diagnostic = await fileDiagnosticStore.recordDiagnostic({
      category: "invalid_ingest_key",
      errorCode: "401",
      message: "Ingest authentication failed on POST /api/traces/events.",
    });

    expect(diagnostic.message).not.toMatch(/sk-|ghp_|Bearer /);
  });

  it("redacts secret-shaped values embedded in a diagnostic message", async () => {
    const diagnostic = await fileDiagnosticStore.recordDiagnostic({
      projectId: "proj-a",
      category: "other",
      errorCode: "400",
      message: "Unexpected value sk-ant-abcdef1234567890abcdef1234567890abcdef in payload.",
    });

    expect(diagnostic.message).not.toContain("sk-ant-abcdef1234567890abcdef1234567890abcdef");
    expect(diagnostic.message).toContain("[REDACTED:");
  });

  it("caps retained diagnostics per project at MAX_DIAGNOSTICS_PER_PROJECT", async () => {
    for (let i = 0; i < MAX_DIAGNOSTICS_PER_PROJECT + 10; i++) {
      await fileDiagnosticStore.recordDiagnostic({
        projectId: "proj-cap",
        category: "other",
        errorCode: "400",
        message: `error ${i}`,
      });
    }

    const listed = await fileDiagnosticStore.listDiagnostics({ projectId: "proj-cap", limit: 1000 });
    expect(listed.length).toBeLessThanOrEqual(MAX_DIAGNOSTICS_PER_PROJECT);
  });

  it("returns an empty array when no diagnostics have been recorded", async () => {
    const listed = await fileDiagnosticStore.listDiagnostics({ projectId: "nonexistent" });
    expect(listed).toEqual([]);
  });
});
