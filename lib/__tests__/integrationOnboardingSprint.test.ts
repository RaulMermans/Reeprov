import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evalResultSchema,
  runRecordSchema,
  toolCallRecordSchema,
  traceEventSchema,
  type EvalResult,
  type RunRecord,
  type ToolCallRecord,
  type TraceEvent,
} from "@/lib/proof-layer/schemas";
import { buildRunGraph } from "@/lib/runs/runGraph";
import { buildVisualRunGraph } from "@/lib/visualGraph/buildVisualRunGraph";

const root = path.resolve(fileURLToPath(import.meta.url), "../../../");

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

interface Fixture {
  runRecord: RunRecord;
  traceEvents: TraceEvent[];
  toolCalls: ToolCallRecord[];
  evalResults: EvalResult[];
}

function loadFixture(): Fixture {
  const raw = JSON.parse(read("examples/integrations/fixtures/customer-support-triage-run.json")) as Record<string, unknown>;
  return {
    runRecord: runRecordSchema.parse(raw["runRecord"]),
    traceEvents: traceEventSchema.array().parse(raw["traceEvents"]),
    toolCalls: toolCallRecordSchema.array().parse(raw["toolCalls"]),
    evalResults: evalResultSchema.array().parse(raw["evalResults"]),
  };
}

describe("second integration fixture", () => {
  it("is a schema-valid, non-BlogAgent support workflow with complete evidence", () => {
    const fixture = loadFixture();
    expect(fixture.runRecord.project_id).toBe("customer-support-triage");
    expect(fixture.runRecord.workflow_id).toBe("support-triage-v2");
    expect(new Set(fixture.traceEvents.map((event) => event.node_id).filter(Boolean)).size).toBeGreaterThanOrEqual(5);
    expect(fixture.traceEvents.some((event) => event.event_type === "model_call_completed")).toBe(true);
    expect(fixture.traceEvents.some((event) => event.event_type === "tool_call_failed")).toBe(true);
    expect(fixture.traceEvents.some((event) => event.event_type === "eval_completed")).toBe(true);
    expect(fixture.traceEvents.some((event) => event.event_type === "artifact_created")).toBe(true);
    expect(fixture.traceEvents.some((event) => event.event_type === "retry_started")).toBe(true);
  });

  it("renders through the generic inferred Visual Execution Canvas graph", () => {
    const fixture = loadFixture();
    const runGraph = buildRunGraph(fixture);
    const visualGraph = buildVisualRunGraph({ runGraph, traceEvents: fixture.traceEvents });

    expect(runGraph.mode).toBe("inferred");
    expect(runGraph.nodes.length).toBeGreaterThanOrEqual(5);
    expect(runGraph.summary.totalModelCalls).toBe(1);
    expect(runGraph.summary.totalToolCalls).toBe(1);
    expect(runGraph.summary.totalEvals).toBe(1);
    expect(runGraph.summary.totalArtifacts).toBe(1);
    expect(runGraph.summary.totalIssues).toBeGreaterThanOrEqual(1);
    expect(visualGraph.mode).toBe("inferred");
    expect(visualGraph.primaryNodes.length).toBe(runGraph.nodes.length);
    expect(visualGraph.evidenceNodes.some((node) => node.type === "model")).toBe(true);
    expect(visualGraph.evidenceNodes.some((node) => node.type === "tool")).toBe(true);
    expect(visualGraph.evidenceNodes.some((node) => node.type === "eval")).toBe(true);
    expect(visualGraph.evidenceNodes.some((node) => node.type === "artifact")).toBe(true);
  });
});

describe("integration onboarding genericity and safety", () => {
  const onboardingFiles = [
    "app/dashboard/integrations/page.tsx",
    "app/dashboard/integrations/[integrationId]/page.tsx",
    "app/api/integrations/[integrationId]/test-event/route.ts",
  ];

  it.each(onboardingFiles)("%s has no identity-specific rendering branch", (relativePath) => {
    const source = read(relativePath);
    expect(source).not.toMatch(/project_?id\s*===/i);
    expect(source).not.toMatch(/workflow_?id\s*===/i);
    expect(source).not.toContain("extract_webpages");
    expect(source).not.toContain("draft_writing");
    expect(source).not.toContain("final_article_packaging");
  });

  it("documents endpoint, auth, validation, modes, diagnostics, and privacy boundaries", () => {
    const guide = read("docs/INTEGRATION_GUIDE.md");
    expect(guide).toContain("/api/runs/start");
    expect(guide).toContain("/api/traces/events");
    expect(guide).toContain("/api/runs/complete");
    expect(guide).toContain("x-agentpulse-key");
    expect(guide).toContain("WorkflowSpec");
    expect(guide).toContain("inferred mode");
    expect(guide).toContain("Unknown event type");
    expect(guide).toContain("Privacy boundary");
    expect(guide).not.toMatch(/(?:ghp_|sk-ant-|sk-proj-)[A-Za-z0-9_-]{12,}/);
  });

  it("keeps ingest-key examples masked and out of browser-readable values", () => {
    const detail = read("app/dashboard/integrations/[integrationId]/page.tsx");
    expect(detail).toContain("<your-ingest-key>");
    expect(detail).not.toMatch(/AGENTPULSE_INGEST_KEY=[A-Za-z0-9_-]{16,}/);
    expect(detail).not.toContain("NEXT_PUBLIC_AGENTPULSE_INGEST_KEY");
  });
});
