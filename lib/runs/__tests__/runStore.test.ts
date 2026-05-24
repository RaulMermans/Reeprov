/**
 * Task 5 — Run store tests.
 *
 * Uses a real temp directory per test run so we verify actual I/O behavior.
 * Overrides AGENTPULSE_STORE_DIR so tests don't pollute .agentpulse/runs.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileRunStore } from "@/lib/runs/runStore";
import { runRecordSchema, traceEventSchema, evalResultSchema, toolCallRecordSchema } from "@/lib/proof-layer/schemas";
import { generateRunId } from "@/lib/runs/runId";
import type { RunRecord, TraceEvent, EvalResult, ToolCallRecord } from "@/lib/proof-layer/schemas";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "agentpulse-runs-test-"));
  process.env["AGENTPULSE_STORE_DIR"] = tmpDir;
});

afterEach(async () => {
  delete process.env["AGENTPULSE_STORE_DIR"];
  await rm(tmpDir, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return runRecordSchema.parse({
    run_id: generateRunId(),
    workflow_id: "test-workflow-v1",
    project_id: "test-project",
    project_name: "Test Project",
    status: "running",
    started_at: new Date().toISOString(),
    model_calls_count: 0,
    tool_calls_count: 0,
    evals_passed: 0,
    evals_failed: 0,
    artifact_refs: [],
    summary: "Test run.",
    ...overrides,
  });
}

function makeTraceEvent(runId: string, overrides: Partial<TraceEvent> = {}): TraceEvent {
  return traceEventSchema.parse({
    event_id: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    run_id: runId,
    workflow_id: "test-workflow-v1",
    timestamp: new Date().toISOString(),
    event_type: "node_started",
    status: "running",
    ...overrides,
  });
}

function makeEvalResult(runId: string, overrides: Partial<EvalResult> = {}): EvalResult {
  return evalResultSchema.parse({
    eval_id: `eval-${Date.now()}`,
    run_id: runId,
    name: "Test Eval",
    type: "output_quality",
    passed: true,
    severity: "info",
    findings: [],
    ...overrides,
  });
}

function makeToolCallRecord(runId: string, overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return toolCallRecordSchema.parse({
    tool_call_id: `tc-${Date.now()}`,
    run_id: runId,
    node_id: "test-node",
    tool_name: "test_tool",
    permission_class: "read_only",
    status: "completed",
    started_at: new Date().toISOString(),
    ...overrides,
  });
}

// ── createRun ──────────────────────────────────────────────────────────────────

describe("fileRunStore.createRun", () => {
  it("returns saved: true on success", async () => {
    const run = makeRunRecord();
    const result = await fileRunStore.createRun(run);
    expect(result.saved).toBe(true);
    expect(result.run_id).toBe(run.run_id);
  });

  it("created run can be retrieved", async () => {
    const run = makeRunRecord();
    await fileRunStore.createRun(run);
    const retrieved = await fileRunStore.getRun(run.run_id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.runRecord.run_id).toBe(run.run_id);
  });

  it("created run has empty trace events by default", async () => {
    const run = makeRunRecord();
    await fileRunStore.createRun(run);
    const retrieved = await fileRunStore.getRun(run.run_id);
    // Only the auto-appended run_started event
    expect(retrieved?.traceEvents.length).toBe(0);
  });

  it("fails gracefully when store dir is a file (ENOTDIR — no exception thrown)", async () => {
    // Write a regular file into tmpDir and point AGENTPULSE_STORE_DIR at it.
    // Trying to create a subdirectory inside a file always fails with ENOTDIR
    // regardless of OS or file-system permissions — this is deterministic.
    const blockingFile = join(tmpDir, "not-a-dir.txt");
    await writeFile(blockingFile, "i am a file, not a directory");
    process.env["AGENTPULSE_STORE_DIR"] = blockingFile;
    const run = makeRunRecord();
    const result = await fileRunStore.createRun(run);
    expect(result.saved).toBe(false);
    expect(result.warning).toBeTruthy();
  });
});

// ── listRuns ───────────────────────────────────────────────────────────────────

describe("fileRunStore.listRuns", () => {
  it("returns empty array when no runs", async () => {
    const runs = await fileRunStore.listRuns();
    expect(runs).toEqual([]);
  });

  it("lists saved runs newest first", async () => {
    const r1 = makeRunRecord({ project_name: "Project A" });
    const r2 = makeRunRecord({ project_name: "Project B" });
    await fileRunStore.createRun(r1);
    await fileRunStore.createRun(r2);
    const runs = await fileRunStore.listRuns();
    expect(runs).toHaveLength(2);
    // r2 was created last, should be first.
    expect(runs[0].run_id).toBe(r2.run_id);
  });

  it("filters by projectId", async () => {
    const r1 = makeRunRecord({ project_id: "proj-a" });
    const r2 = makeRunRecord({ project_id: "proj-b" });
    await fileRunStore.createRun(r1);
    await fileRunStore.createRun(r2);
    const runs = await fileRunStore.listRuns({ projectId: "proj-a" });
    expect(runs).toHaveLength(1);
    expect(runs[0].run_id).toBe(r1.run_id);
  });

  it("filters by workflowId", async () => {
    const r1 = makeRunRecord({ workflow_id: "wf-1" });
    const r2 = makeRunRecord({ workflow_id: "wf-2" });
    await fileRunStore.createRun(r1);
    await fileRunStore.createRun(r2);
    const runs = await fileRunStore.listRuns({ workflowId: "wf-2" });
    expect(runs).toHaveLength(1);
    expect(runs[0].run_id).toBe(r2.run_id);
  });

  it("filters by status", async () => {
    const r1 = makeRunRecord({ status: "completed" });
    const r2 = makeRunRecord({ status: "failed" });
    await fileRunStore.createRun(r1);
    await fileRunStore.createRun(r2);
    const failed = await fileRunStore.listRuns({ status: "failed" });
    expect(failed).toHaveLength(1);
    expect(failed[0].run_id).toBe(r2.run_id);
  });

  it("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await fileRunStore.createRun(makeRunRecord());
    }
    const runs = await fileRunStore.listRuns({ limit: 3 });
    expect(runs).toHaveLength(3);
  });
});

// ── getRun ─────────────────────────────────────────────────────────────────────

describe("fileRunStore.getRun", () => {
  it("returns null for unknown runId", async () => {
    const result = await fileRunStore.getRun("run_nonexistent");
    expect(result).toBeNull();
  });

  it("ignores path traversal attempts", async () => {
    const result = await fileRunStore.getRun("../../../etc/passwd");
    expect(result).toBeNull();
  });
});

// ── appendTraceEvent ───────────────────────────────────────────────────────────

describe("fileRunStore.appendTraceEvent", () => {
  it("appends a trace event to an existing run", async () => {
    const run = makeRunRecord();
    await fileRunStore.createRun(run);
    const event = makeTraceEvent(run.run_id);
    await fileRunStore.appendTraceEvent(run.run_id, event);
    const retrieved = await fileRunStore.getRun(run.run_id);
    const found = retrieved?.traceEvents.some((e) => e.event_id === event.event_id);
    expect(found).toBe(true);
  });

  it("duplicate event_id is not re-appended", async () => {
    const run = makeRunRecord();
    await fileRunStore.createRun(run);
    const event = makeTraceEvent(run.run_id);

    const r1 = await fileRunStore.appendTraceEvent(run.run_id, event);
    const r2 = await fileRunStore.appendTraceEvent(run.run_id, event);

    expect(r1.appended).toBe(true);
    expect(r2.appended).toBe(false); // second append is skipped

    const retrieved = await fileRunStore.getRun(run.run_id);
    const matching = retrieved?.traceEvents.filter((e) => e.event_id === event.event_id);
    expect(matching).toHaveLength(1);
  });

  it("returns warning when run not found", async () => {
    const result = await fileRunStore.appendTraceEvent("run_nonexistent", makeTraceEvent("run_nonexistent"));
    expect(result.appended).toBe(false);
    expect(result.warning).toBeTruthy();
  });
});

// ── appendEvalResult ───────────────────────────────────────────────────────────

describe("fileRunStore.appendEvalResult", () => {
  it("appends an eval result", async () => {
    const run = makeRunRecord();
    await fileRunStore.createRun(run);
    const er = makeEvalResult(run.run_id);
    await fileRunStore.appendEvalResult(run.run_id, er);
    const retrieved = await fileRunStore.getRun(run.run_id);
    expect(retrieved?.evalResults.some((e) => e.eval_id === er.eval_id)).toBe(true);
  });

  it("duplicate eval_id is not re-appended", async () => {
    const run = makeRunRecord();
    await fileRunStore.createRun(run);
    const er = makeEvalResult(run.run_id, { eval_id: "eval-dupe" });
    await fileRunStore.appendEvalResult(run.run_id, er);
    await fileRunStore.appendEvalResult(run.run_id, er);
    const retrieved = await fileRunStore.getRun(run.run_id);
    const matching = retrieved?.evalResults.filter((e) => e.eval_id === "eval-dupe");
    expect(matching).toHaveLength(1);
  });
});

// ── appendToolCallRecord ───────────────────────────────────────────────────────

describe("fileRunStore.appendToolCallRecord", () => {
  it("appends a tool call record", async () => {
    const run = makeRunRecord();
    await fileRunStore.createRun(run);
    const tc = makeToolCallRecord(run.run_id);
    await fileRunStore.appendToolCallRecord(run.run_id, tc);
    const retrieved = await fileRunStore.getRun(run.run_id);
    expect(retrieved?.toolCalls.some((t) => t.tool_call_id === tc.tool_call_id)).toBe(true);
  });

  it("duplicate tool_call_id is not re-appended", async () => {
    const run = makeRunRecord();
    await fileRunStore.createRun(run);
    const tc = makeToolCallRecord(run.run_id, { tool_call_id: "tc-dupe" });
    await fileRunStore.appendToolCallRecord(run.run_id, tc);
    await fileRunStore.appendToolCallRecord(run.run_id, tc);
    const retrieved = await fileRunStore.getRun(run.run_id);
    const matching = retrieved?.toolCalls.filter((t) => t.tool_call_id === "tc-dupe");
    expect(matching).toHaveLength(1);
  });
});

// ── completeRun ────────────────────────────────────────────────────────────────

describe("fileRunStore.completeRun", () => {
  it("updates run to completed", async () => {
    const run = makeRunRecord();
    await fileRunStore.createRun(run);
    await fileRunStore.completeRun(run.run_id, {
      summary: "Done.",
      total_cost_usd: 0.05,
      total_duration_ms: 10000,
    });
    const retrieved = await fileRunStore.getRun(run.run_id);
    expect(retrieved?.runRecord.status).toBe("completed");
    expect(retrieved?.runRecord.total_cost_usd).toBe(0.05);
  });

  it("allows degraded status to pass through", async () => {
    const run = makeRunRecord();
    await fileRunStore.createRun(run);
    await fileRunStore.completeRun(run.run_id, {
      status: "degraded",
      summary: "Completed with failing evals.",
    });
    const retrieved = await fileRunStore.getRun(run.run_id);
    expect(retrieved?.runRecord.status).toBe("degraded");
  });

  it("returns false for unknown runId", async () => {
    const result = await fileRunStore.completeRun("run_unknown", {});
    expect(result).toBe(false);
  });
});

// ── failRun ────────────────────────────────────────────────────────────────────

describe("fileRunStore.failRun", () => {
  it("updates run to failed", async () => {
    const run = makeRunRecord();
    await fileRunStore.createRun(run);
    await fileRunStore.failRun(run.run_id, { summary: "Something went wrong." });
    const retrieved = await fileRunStore.getRun(run.run_id);
    expect(retrieved?.runRecord.status).toBe("failed");
    expect(retrieved?.runRecord.summary).toBe("Something went wrong.");
  });

  it("returns false for unknown runId", async () => {
    const result = await fileRunStore.failRun("run_unknown", {});
    expect(result).toBe(false);
  });
});

// ── deleteRun ──────────────────────────────────────────────────────────────────

describe("fileRunStore.deleteRun", () => {
  it("deletes an existing run", async () => {
    const run = makeRunRecord();
    await fileRunStore.createRun(run);
    const deleted = await fileRunStore.deleteRun(run.run_id);
    expect(deleted).toBe(true);
    const retrieved = await fileRunStore.getRun(run.run_id);
    expect(retrieved).toBeNull();
    const list = await fileRunStore.listRuns();
    expect(list.find((s) => s.run_id === run.run_id)).toBeUndefined();
  });

  it("returns false for non-existent runId", async () => {
    const result = await fileRunStore.deleteRun("run_nonexistent_999");
    expect(result).toBe(false);
  });
});
