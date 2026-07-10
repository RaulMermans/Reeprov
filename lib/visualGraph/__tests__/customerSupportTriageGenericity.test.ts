/**
 * Proves the generic Visual Execution Canvas pipeline (buildRunGraph →
 * buildVisualRunGraph) renders the customer-support-triage fixture correctly
 * in INFERRED mode (no registered WorkflowSpec) — the second, non-BlogAgent
 * fixture required by the integration onboarding sprint.
 *
 * This loads the real fixture file used by the fixture importer
 * (app/api/fixtures/[fixtureId]/import/route.ts) so the two stay in sync.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildRunGraph } from "@/lib/runs/runGraph";
import { buildVisualRunGraph } from "@/lib/visualGraph/buildVisualRunGraph";
import type { EvalResult, RunRecord, ToolCallRecord, TraceEvent } from "@/lib/proof-layer/schemas";

const root = path.resolve(fileURLToPath(import.meta.url), "../../../../");

interface FixtureFile {
  runRecord: RunRecord;
  traceEvents: TraceEvent[];
  toolCalls: ToolCallRecord[];
  evalResults: EvalResult[];
}

function loadFixture(): FixtureFile {
  const raw = readFileSync(
    path.join(root, "examples/integrations/fixtures/customer-support-triage-run.json"),
    "utf-8",
  );
  return JSON.parse(raw) as FixtureFile;
}

describe("Visual Execution Canvas — customer-support-triage fixture renders generically", () => {
  const fixture = loadFixture();

  it("builds an inferred-mode RunGraph with 6 stages observed from the trace", () => {
    const runGraph = buildRunGraph({
      runRecord: fixture.runRecord,
      traceEvents: fixture.traceEvents,
      toolCalls: fixture.toolCalls,
      evalResults: fixture.evalResults,
      // No specNodes/specEdges: this fixture is documented as inferred-mode only.
    });

    expect(runGraph.mode).toBe("inferred");
    expect(runGraph.nodes.length).toBe(6);
  });

  it("builds a VisualRunGraph with model/tool/eval/artifact evidence and a degraded/recovered stage", () => {
    const runGraph = buildRunGraph({
      runRecord: fixture.runRecord,
      traceEvents: fixture.traceEvents,
      toolCalls: fixture.toolCalls,
      evalResults: fixture.evalResults,
    });
    const visualGraph = buildVisualRunGraph({ runGraph, traceEvents: fixture.traceEvents });

    expect(visualGraph.mode).toBe("inferred");
    expect(visualGraph.primaryNodes).toHaveLength(6);

    const primaryIds = visualGraph.primaryNodes.map((n) => n.id);
    expect(primaryIds).toEqual([
      "normalize-request",
      "classify-intent",
      "enrich-account",
      "quality-check",
      "route-queue",
      "summarize-handoff",
    ]);

    // enrich-account failed a read-only tool call and recovered with cached
    // context — the generic engine should surface this as a non-"completed"
    // status without any special-casing for this project.
    const enrichAccount = visualGraph.primaryNodes.find((n) => n.id === "enrich-account");
    expect(enrichAccount?.status).not.toBe("completed");

    expect(visualGraph.evidenceNodes.some((n) => n.type === "model")).toBe(true);
    expect(visualGraph.evidenceNodes.some((n) => n.type === "tool")).toBe(true);
    expect(visualGraph.evidenceNodes.some((n) => n.type === "eval")).toBe(true);
    expect(visualGraph.evidenceNodes.some((n) => n.type === "artifact")).toBe(true);
  });

  it("never branches on this fixture's project_id or workflow_id in the graph/canvas engine", () => {
    const sourceFiles = [
      "lib/runs/runGraph.ts",
      "lib/visualGraph/buildVisualRunGraph.ts",
      "lib/visualGraph/metadataDisplay.ts",
      "components/proof-layer/VisualExecutionCanvas.tsx",
    ];
    for (const relativePath of sourceFiles) {
      const contents = readFileSync(path.join(root, relativePath), "utf-8");
      expect(contents.includes(fixture.runRecord.project_id)).toBe(false);
      expect(contents.includes(fixture.runRecord.workflow_id)).toBe(false);
    }
  });
});
