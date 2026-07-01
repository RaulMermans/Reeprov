/**
 * Anti-hardcoding + production-fixture generality tests for the Visual
 * Execution Canvas.
 *
 * The BlogAgent WorkflowSpec/run is an allowed *fixture* — these tests prove
 * the generic visual graph model and canvas source handle it correctly. What
 * they forbid is any code path that special-cases BlogAgent by project_id,
 * workflow_id, or stage name.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EvalResult, RunRecord, ToolCallRecord, TraceEvent } from "@/lib/proof-layer/schemas";
import { buildRunGraph } from "@/lib/runs/runGraph";
import { buildVisualRunGraph } from "@/lib/visualGraph/buildVisualRunGraph";
import {
  BLOG_AGENT_PROJECT_ID,
  BLOG_AGENT_STAGE_ORDER,
  BLOG_AGENT_WORKFLOW_ID,
  BLOG_AGENT_WORKFLOW_SPEC,
} from "@/lib/workflows/builtInWorkflowSpecs";

const root = path.resolve(fileURLToPath(import.meta.url), "../../../../");

const SOURCE_FILES = [
  "lib/visualGraph/types.ts",
  "lib/visualGraph/nodeRegistry.tsx",
  "lib/visualGraph/iconResolvers.ts",
  "lib/visualGraph/metadataDisplay.ts",
  "lib/visualGraph/buildVisualRunGraph.ts",
  "lib/visualGraph/replay.ts",
  "lib/visualGraph/filters.ts",
  "components/proof-layer/CanvasFilters.tsx",
  "components/proof-layer/ReplayControls.tsx",
  "components/proof-layer/VisualExecutionCanvas.tsx",
];

// ── No hardcoding ─────────────────────────────────────────────────────────────

describe("Visual Execution Canvas — no BlogAgent-specific branches", () => {
  const forbiddenLiterals = [
    BLOG_AGENT_PROJECT_ID,
    BLOG_AGENT_WORKFLOW_ID,
    ...BLOG_AGENT_STAGE_ORDER,
    ...BLOG_AGENT_WORKFLOW_SPEC.nodes.map((n) => n.label),
  ];

  const forbiddenPatterns = [
    /project_id\s*===/,
    /projectId\s*===/,
    /workflow_id\s*===/,
    /workflowId\s*===/,
  ];

  it.each(SOURCE_FILES)("%s contains no BlogAgent-specific literal", (relativePath) => {
    const contents = readFileSync(path.join(root, relativePath), "utf-8");
    for (const literal of forbiddenLiterals) {
      expect(contents.includes(literal)).toBe(false);
    }
  });

  it.each(SOURCE_FILES)("%s contains no project/workflow identity branching", (relativePath) => {
    const contents = readFileSync(path.join(root, relativePath), "utf-8");
    for (const pattern of forbiddenPatterns) {
      expect(pattern.test(contents)).toBe(false);
    }
  });
});

// ── Production fixture generality ─────────────────────────────────────────────

function makeEvent(partial: Partial<TraceEvent> & Pick<TraceEvent, "event_id" | "event_type" | "timestamp" | "node_id">): TraceEvent {
  return { run_id: "blog-agent-run-1", workflow_id: BLOG_AGENT_WORKFLOW_ID, ...partial };
}

describe("Visual Execution Canvas — BlogAgent production fixture renders generically", () => {
  const run: RunRecord = {
    run_id: "blog-agent-run-1",
    workflow_id: BLOG_AGENT_WORKFLOW_ID,
    project_id: BLOG_AGENT_PROJECT_ID,
    project_name: "BlogAgent",
    status: "completed",
    started_at: "2026-06-01T10:00:00.000Z",
    completed_at: "2026-06-01T10:20:00.000Z",
    model_calls_count: 5,
    tool_calls_count: 1,
    evals_passed: 1,
    evals_failed: 0,
    artifact_refs: ["article-markdown"],
    summary: "BlogAgent production run fixture.",
  };

  const traceEvents: TraceEvent[] = BLOG_AGENT_STAGE_ORDER.flatMap((stageId, index) => {
    const base = `2026-06-01T10:0${index}:00.000Z`;
    const events: TraceEvent[] = [
      makeEvent({ event_id: `${stageId}-start`, event_type: "node_started", node_id: stageId, timestamp: base }),
      makeEvent({ event_id: `${stageId}-end`, event_type: "node_completed", node_id: stageId, timestamp: base }),
    ];
    if (stageId === "extract_webpages") {
      events.push(makeEvent({ event_id: `${stageId}-tool`, event_type: "tool_call_completed", node_id: stageId, timestamp: base }));
    }
    if (stageId === "draft_writing") {
      events.push(makeEvent({ event_id: `${stageId}-model`, event_type: "model_call_completed", node_id: stageId, timestamp: base, metadata: { model_name: "gemini-2.5-flash" } }));
    }
    if (stageId === "final_article_packaging") {
      events.push(makeEvent({ event_id: `${stageId}-artifact`, event_type: "artifact_created", node_id: stageId, timestamp: base, metadata: { artifact_ref: "article-markdown" } }));
    }
    return events;
  });

  const toolCalls: ToolCallRecord[] = [
    { run_id: run.run_id, tool_call_id: "tc-1", node_id: "extract_webpages", tool_name: "webpage_extractor", permission_class: "read_only", status: "completed", started_at: "2026-06-01T10:03:00.000Z" },
  ];

  const evalResults: EvalResult[] = [
    { run_id: run.run_id, eval_id: "eval-1", node_id: "reviewer_critic_pass", name: "Factual grounding", type: "source_grounding", passed: true, severity: "info", findings: [] },
  ];

  it("builds a full VisualRunGraph with 10 primary nodes and no crash", () => {
    const runGraph = buildRunGraph({
      runRecord: run,
      traceEvents,
      toolCalls,
      evalResults,
      specNodes: BLOG_AGENT_WORKFLOW_SPEC.nodes,
      specEdges: BLOG_AGENT_WORKFLOW_SPEC.edges,
      templateName: BLOG_AGENT_WORKFLOW_SPEC.name,
    });
    const visualGraph = buildVisualRunGraph({ runGraph, traceEvents });

    expect(visualGraph.mode).toBe("registered_spec");
    expect(visualGraph.primaryNodes).toHaveLength(BLOG_AGENT_STAGE_ORDER.length);
    expect(visualGraph.primaryNodes.every((n) => n.status === "completed")).toBe(true);
    expect(visualGraph.evidenceNodes.some((n) => n.type === "tool")).toBe(true);
    expect(visualGraph.evidenceNodes.some((n) => n.type === "model")).toBe(true);
    expect(visualGraph.evidenceNodes.some((n) => n.type === "eval")).toBe(true);
    expect(visualGraph.evidenceNodes.some((n) => n.type === "artifact")).toBe(true);
    expect(visualGraph.internalNodes).toHaveLength(0);
  });
});
