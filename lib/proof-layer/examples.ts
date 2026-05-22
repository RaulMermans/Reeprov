import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  evalResultSchema,
  runRecordSchema,
  traceEventSchema,
  workflowSpecSchema,
  type EvalResult,
  type RunRecord,
  type TraceEvent,
  type WorkflowSpec,
} from "./schemas";

const examplesDir = join(process.cwd(), "examples");

const workflows = [
  readWorkflow("website-auditor.json"),
  readWorkflow("campaign-sandbox.json"),
  readWorkflow("content-trend-analyzer.json"),
];

const runs = [
  readRun("website-auditor-run-001.json"),
  readRun("campaign-sandbox-run-001.json"),
  readRun("content-trend-analyzer-run-001.json"),
];

const traceEvents = [
  ...readTraceEvents("website-auditor-run-001.json"),
  ...readTraceEvents("campaign-sandbox-run-001.json"),
  ...readTraceEvents("content-trend-analyzer-run-001.json"),
];

const evalResults = [
  ...readEvalResults("website-auditor-evals.json"),
  ...readEvalResults("campaign-sandbox-evals.json"),
  ...readEvalResults("content-trend-analyzer-evals.json"),
];

export interface WorkflowGalleryItem {
  workflow: WorkflowSpec;
  latestRun?: RunRecord;
  evalResults: EvalResult[];
  averageEvalScore: number | null;
}

export interface ProofLayerMetrics {
  totalRuns: number;
  successfulRuns: number;
  failedOrDegradedRuns: number;
  averageEvalScore: number;
  totalModelCost: number;
  averageLatencyMs: number;
  totalModelCalls: number;
  totalToolCalls: number;
}

export function getExampleWorkflows(): WorkflowSpec[] {
  return [...workflows];
}

export function getExampleRuns(): RunRecord[] {
  return [...runs].sort((a, b) => b.started_at.localeCompare(a.started_at));
}

export function getExampleTraceEvents(runId: string): TraceEvent[] {
  return traceEvents
    .filter((event) => event.run_id === runId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function getExampleEvalResults(runId: string): EvalResult[] {
  return evalResults.filter((result) => result.run_id === runId);
}

export function getWorkflowById(workflowId: string): WorkflowSpec | undefined {
  return workflows.find((workflow) => workflow.workflow_id === workflowId);
}

export function getRunById(runId: string): RunRecord | undefined {
  return runs.find((run) => run.run_id === runId);
}

export function getWorkflowGalleryItems(): WorkflowGalleryItem[] {
  return workflows.map((workflow) => {
    const workflowRuns = runs
      .filter((run) => run.workflow_id === workflow.workflow_id)
      .sort((a, b) => b.started_at.localeCompare(a.started_at));
    const latestRun = workflowRuns[0];
    const workflowEvalResults = latestRun ? getExampleEvalResults(latestRun.run_id) : [];

    return {
      workflow,
      latestRun,
      evalResults: workflowEvalResults,
      averageEvalScore: averageScore(workflowEvalResults),
    };
  });
}

export function getProofLayerMetrics(): ProofLayerMetrics {
  const scoredEvals = evalResults.filter((result) => typeof result.score === "number");
  const totalLatency = runs.reduce((sum, run) => sum + (run.total_duration_ms ?? 0), 0);

  return {
    totalRuns: runs.length,
    successfulRuns: runs.filter((run) => run.status === "completed").length,
    failedOrDegradedRuns: runs.filter((run) => run.status === "failed" || run.status === "degraded").length,
    averageEvalScore: scoredEvals.length
      ? scoredEvals.reduce((sum, result) => sum + (result.score ?? 0), 0) / scoredEvals.length
      : 0,
    totalModelCost: runs.reduce((sum, run) => sum + (run.total_cost_usd ?? 0), 0),
    averageLatencyMs: runs.length ? totalLatency / runs.length : 0,
    totalModelCalls: runs.reduce((sum, run) => sum + run.model_calls_count, 0),
    totalToolCalls: runs.reduce((sum, run) => sum + run.tool_calls_count, 0),
  };
}

function readWorkflow(fileName: string): WorkflowSpec {
  return workflowSpecSchema.parse(readJson(join(examplesDir, "workflows", fileName)));
}

function readRun(fileName: string): RunRecord {
  return runRecordSchema.parse(readJson(join(examplesDir, "runs", fileName)));
}

function readTraceEvents(fileName: string): TraceEvent[] {
  return traceEventSchema.array().parse(readJson(join(examplesDir, "traces", fileName)));
}

function readEvalResults(fileName: string): EvalResult[] {
  return evalResultSchema.array().parse(readJson(join(examplesDir, "evals", fileName)));
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function averageScore(results: EvalResult[]): number | null {
  const scored = results.filter((result) => typeof result.score === "number");
  if (!scored.length) {
    return null;
  }

  return scored.reduce((sum, result) => sum + (result.score ?? 0), 0) / scored.length;
}
