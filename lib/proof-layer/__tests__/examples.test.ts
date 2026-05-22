import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getExampleEvalResults,
  getExampleRuns,
  getExampleTraceEvents,
  getExampleWorkflows,
  getRunById,
  getWorkflowById,
} from "@/lib/proof-layer/examples";
import {
  evalResultSchema,
  runRecordSchema,
  traceEventSchema,
  workflowSpecSchema,
  type EvalResult,
  type RunRecord,
  type TraceEvent,
  type WorkflowSpec,
} from "@/lib/proof-layer/schemas";

const examplesDir = join(process.cwd(), "examples");

function readJsonFiles<T>(directory: string, parse: (value: unknown) => T | T[]): T[] {
  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".json"))
    .flatMap((fileName) => {
      const raw = JSON.parse(readFileSync(join(directory, fileName), "utf8")) as unknown;
      return parse(raw);
    });
}

describe("example JSON validation", () => {
  it("validates every workflow, trace event, eval result, and run record", () => {
    const workflows = readJsonFiles<WorkflowSpec>(
      join(examplesDir, "workflows"),
      (value) => workflowSpecSchema.parse(value),
    );
    const traceEvents = readJsonFiles<TraceEvent>(
      join(examplesDir, "traces"),
      (value) => traceEventSchema.array().parse(value),
    );
    const evalResults = readJsonFiles<EvalResult>(
      join(examplesDir, "evals"),
      (value) => evalResultSchema.array().parse(value),
    );
    const runs = readJsonFiles<RunRecord>(
      join(examplesDir, "runs"),
      (value) => runRecordSchema.parse(value),
    );

    expect(workflows.length).toBeGreaterThanOrEqual(3);
    expect(traceEvents.length).toBeGreaterThan(0);
    expect(evalResults.length).toBeGreaterThan(0);
    expect(runs.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps run_id and workflow_id consistent across example runs, traces, evals, and workflow specs", () => {
    const workflows = readJsonFiles<WorkflowSpec>(
      join(examplesDir, "workflows"),
      (value) => workflowSpecSchema.parse(value),
    );
    const traceEvents = readJsonFiles<TraceEvent>(
      join(examplesDir, "traces"),
      (value) => traceEventSchema.array().parse(value),
    );
    const evalResults = readJsonFiles<EvalResult>(
      join(examplesDir, "evals"),
      (value) => evalResultSchema.array().parse(value),
    );
    const runs = readJsonFiles<RunRecord>(
      join(examplesDir, "runs"),
      (value) => runRecordSchema.parse(value),
    );

    const workflowIds = new Set(workflows.map((workflow) => workflow.workflow_id));
    const runIds = new Set(runs.map((run) => run.run_id));

    for (const run of runs) {
      expect(workflowIds.has(run.workflow_id)).toBe(true);
      expect(traceEvents.some((event) => event.run_id === run.run_id)).toBe(true);
      expect(evalResults.some((result) => result.run_id === run.run_id)).toBe(true);

      const runTraceEvents = traceEvents.filter((event) => event.run_id === run.run_id);
      expect(runTraceEvents.every((event) => event.workflow_id === run.workflow_id)).toBe(true);

      const workflow = workflows.find((item) => item.workflow_id === run.workflow_id);
      const nodeIds = new Set(workflow?.nodes.map((node) => node.id) ?? []);
      const runEvalResults = evalResults.filter((result) => result.run_id === run.run_id);
      expect(runEvalResults.every((result) => !result.node_id || nodeIds.has(result.node_id))).toBe(true);
    }

    expect(traceEvents.every((event) => runIds.has(event.run_id))).toBe(true);
    expect(evalResults.every((result) => runIds.has(result.run_id))).toBe(true);
  });
});

describe("proof-layer example loader", () => {
  it("returns the required example workflows", () => {
    const workflowNames = getExampleWorkflows().map((workflow) => workflow.name);
    expect(workflowNames).toContain("Website Auditor");
    expect(workflowNames).toContain("Campaign Sandbox");
    expect(workflowNames).toContain("Content Trend Analyzer");
  });

  it("returns valid run records", () => {
    const runs = getExampleRuns();
    expect(runs.length).toBeGreaterThanOrEqual(3);
    expect(() => runs.forEach((run) => runRecordSchema.parse(run))).not.toThrow();
  });

  it("getRunById returns a matching run or undefined", () => {
    expect(getRunById("wa-run-001")?.run_id).toBe("wa-run-001");
    expect(getRunById("missing-run")).toBeUndefined();
  });

  it("getExampleTraceEvents returns only events for that run", () => {
    const events = getExampleTraceEvents("wa-run-001");
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.run_id === "wa-run-001")).toBe(true);
  });

  it("getExampleEvalResults returns only evals for that run", () => {
    const evals = getExampleEvalResults("cs-run-001");
    expect(evals.length).toBeGreaterThan(0);
    expect(evals.every((result) => result.run_id === "cs-run-001")).toBe(true);
  });

  it("getWorkflowById returns a matching workflow or undefined", () => {
    expect(getWorkflowById("campaign-sandbox-v1")?.name).toBe("Campaign Sandbox");
    expect(getWorkflowById("missing-workflow")).toBeUndefined();
  });
});
