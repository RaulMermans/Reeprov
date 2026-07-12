/**
 * Anti-hardcoding + production-fixture generality tests for the Integration
 * Workflow Blueprint.
 *
 * The BlogAgent WorkflowSpec/runs and the customer-support-triage fixture are
 * allowed *fixtures* — these tests prove the generic blueprint builder and
 * its source files handle them correctly. What they forbid is any code path
 * that special-cases either fixture by project_id, workflow_id, or stage
 * name/id. Mirrors lib/visualGraph/__tests__/genericity.test.ts and
 * customerSupportTriageGenericity.test.ts for the Visual Execution Canvas.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EvalResult, RunRecord, ToolCallRecord, TraceEvent } from "@/lib/proof-layer/schemas";
import type { SavedRun } from "@/lib/runs/runTypes";
import { buildIntegrationBlueprint } from "@/lib/integrations/buildIntegrationBlueprint";
import {
  BLOG_AGENT_PROJECT_ID,
  BLOG_AGENT_STAGE_ORDER,
  BLOG_AGENT_WORKFLOW_ID,
  BLOG_AGENT_WORKFLOW_SPEC,
} from "@/lib/workflows/builtInWorkflowSpecs";

const root = path.resolve(fileURLToPath(import.meta.url), "../../../../");

const SOURCE_FILES = [
  "lib/integrations/integrationBlueprintTypes.ts",
  "lib/integrations/buildIntegrationBlueprint.ts",
  "app/api/integrations/[integrationId]/blueprint/route.ts",
  "components/proof-layer/IntegrationWorkflowBlueprint.tsx",
  "components/proof-layer/IntegrationBlueprintInspector.tsx",
  "components/proof-layer/IntegrationHealthSummary.tsx",
];

// ── No hardcoding ─────────────────────────────────────────────────────────────

describe("Integration Workflow Blueprint — no BlogAgent/GEO-specific branches", () => {
  const forbiddenLiterals = [
    BLOG_AGENT_PROJECT_ID,
    BLOG_AGENT_WORKFLOW_ID,
    ...BLOG_AGENT_STAGE_ORDER,
    ...BLOG_AGENT_WORKFLOW_SPEC.nodes.map((n) => n.label),
    "geo-aeo-auditor",
    "geo-aeo-audit-v1",
  ];

  const forbiddenPatterns = [
    /project_id\s*===/,
    /projectId\s*===/,
    /workflow_id\s*===/,
    /workflowId\s*===/,
  ];

  it.each(SOURCE_FILES)("%s contains no fixture-specific literal", (relativePath) => {
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

// ── BlogAgent fixture — registered_spec mode across multiple runs ────────────

function makeBlogAgentEvent(
  runId: string,
  partial: Partial<TraceEvent> & Pick<TraceEvent, "event_id" | "event_type" | "timestamp" | "node_id">,
): TraceEvent {
  return { run_id: runId, workflow_id: BLOG_AGENT_WORKFLOW_ID, ...partial };
}

function makeBlogAgentRun(runId: string, dayOffset: number): SavedRun {
  const day = `2026-06-0${dayOffset}`;
  const runRecord: RunRecord = {
    run_id: runId,
    workflow_id: BLOG_AGENT_WORKFLOW_ID,
    project_id: BLOG_AGENT_PROJECT_ID,
    project_name: "BlogAgent",
    status: "completed",
    started_at: `${day}T10:00:00.000Z`,
    completed_at: `${day}T10:20:00.000Z`,
    model_calls_count: 1,
    tool_calls_count: 1,
    evals_passed: 1,
    evals_failed: 0,
    artifact_refs: ["article-markdown"],
    summary: "BlogAgent production run fixture.",
  };

  const traceEvents: TraceEvent[] = BLOG_AGENT_STAGE_ORDER.flatMap((stageId, index) => {
    const base = `${day}T10:0${index}:00.000Z`;
    const events: TraceEvent[] = [
      makeBlogAgentEvent(runId, { event_id: `${runId}-${stageId}-start`, event_type: "node_started", node_id: stageId, timestamp: base }),
      makeBlogAgentEvent(runId, { event_id: `${runId}-${stageId}-end`, event_type: "node_completed", node_id: stageId, timestamp: base }),
    ];
    if (stageId === "extract_webpages") {
      events.push(makeBlogAgentEvent(runId, { event_id: `${runId}-${stageId}-tool`, event_type: "tool_call_completed", node_id: stageId, timestamp: base }));
    }
    if (stageId === "draft_writing") {
      events.push(makeBlogAgentEvent(runId, { event_id: `${runId}-${stageId}-model`, event_type: "model_call_completed", node_id: stageId, timestamp: base, metadata: { model_name: "gemini-2.5-flash" } }));
    }
    if (stageId === "final_article_packaging") {
      events.push(makeBlogAgentEvent(runId, { event_id: `${runId}-${stageId}-artifact`, event_type: "artifact_created", node_id: stageId, timestamp: base, metadata: { artifact_ref: "article-markdown" } }));
    }
    return events;
  });

  const toolCalls: ToolCallRecord[] = [
    { run_id: runId, tool_call_id: `${runId}-tc-1`, node_id: "extract_webpages", tool_name: "webpage_extractor", permission_class: "read_only", status: "completed", started_at: `${day}T10:03:00.000Z` },
  ];

  const evalResults: EvalResult[] = [
    { run_id: runId, eval_id: `${runId}-eval-1`, node_id: "reviewer_critic_pass", name: "Factual grounding", type: "source_grounding", passed: true, severity: "info", findings: [] },
  ];

  return {
    runRecord,
    traceEvents,
    toolCalls,
    evalResults,
    artifactRefs: ["article-markdown"],
    createdAt: `${day}T10:00:00.000Z`,
    updatedAt: `${day}T10:20:00.000Z`,
  };
}

describe("Integration Workflow Blueprint — BlogAgent production fixture (registered_spec)", () => {
  const runs = [makeBlogAgentRun("blog-agent-run-2", 2), makeBlogAgentRun("blog-agent-run-1", 1)];

  it("builds a full blueprint with all 10 declared stages, aggregated across both runs", () => {
    const blueprint = buildIntegrationBlueprint({
      integrationId: "integ-blogagent",
      projectId: BLOG_AGENT_PROJECT_ID,
      runs,
      workflowSpec: BLOG_AGENT_WORKFLOW_SPEC,
    });

    expect(blueprint.mode).toBe("registered_spec");
    const primaryNodes = blueprint.nodes.filter((n) => n.role === "primary");
    expect(primaryNodes).toHaveLength(BLOG_AGENT_STAGE_ORDER.length);
    expect(primaryNodes.every((n) => n.frequency === 2)).toBe(true);
    expect(primaryNodes.every((n) => n.statusSummary.completedRuns === 2)).toBe(true);

    expect(blueprint.evidenceSummary.modelCount).toBeGreaterThan(0);
    expect(blueprint.evidenceSummary.toolCount).toBeGreaterThan(0);
    expect(blueprint.evidenceSummary.artifactCount).toBeGreaterThan(0);
    expect(blueprint.healthSummary.runCount).toBe(2);
    expect(blueprint.healthSummary.completedCount).toBe(2);
  });
});

// ── Customer-support-triage fixture — inferred mode ───────────────────────────

interface FixtureFile {
  runRecord: RunRecord;
  traceEvents: TraceEvent[];
  toolCalls: ToolCallRecord[];
  evalResults: EvalResult[];
}

function loadCustomerSupportFixture(): FixtureFile {
  const raw = readFileSync(
    path.join(root, "examples/integrations/fixtures/customer-support-triage-run.json"),
    "utf-8",
  );
  return JSON.parse(raw) as FixtureFile;
}

describe("Integration Workflow Blueprint — customer-support-triage fixture (inferred_from_runs)", () => {
  const fixture = loadCustomerSupportFixture();
  const savedRun: SavedRun = {
    runRecord: fixture.runRecord,
    traceEvents: fixture.traceEvents,
    toolCalls: fixture.toolCalls,
    evalResults: fixture.evalResults,
    artifactRefs: fixture.runRecord.artifact_refs,
    createdAt: fixture.runRecord.started_at,
    updatedAt: fixture.runRecord.completed_at ?? fixture.runRecord.started_at,
  };

  it("builds an inferred-mode blueprint with stages discovered from the trace, no spec required", () => {
    const blueprint = buildIntegrationBlueprint({
      integrationId: "integ-support",
      projectId: fixture.runRecord.project_id,
      runs: [savedRun],
    });

    expect(blueprint.mode).toBe("inferred_from_runs");
    const primaryNodes = blueprint.nodes.filter((n) => n.role === "primary");
    expect(primaryNodes.length).toBe(6);
    expect(primaryNodes.every((n) => n.frequency === 1)).toBe(true);
  });
});
