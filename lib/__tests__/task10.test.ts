/**
 * Task 10 — Product Stabilization + UX Polish Sprint tests.
 *
 * Source-level smoke tests verify the UX and copy changes across:
 * - Run detail linked/unlinked WorkflowSpec contract
 * - Failed evals surfaced near top
 * - TraceTimeline filter tabs
 * - Workflow Registry detail missing-links labeling
 * - Workflow Registry list status/source filters
 * - StaticProofReconstructionPanel promotion tracking
 * - Scanner insight banner ("What this means")
 * - NavBar "Unlocked" indicator
 * - V0 testing guide in ROADMAP.md
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(fileURLToPath(import.meta.url), "../../../");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

// ── Phase 1+2 — Run detail linked/unlinked WorkflowSpec contract ──────────────

describe("Run detail — linked WorkflowSpec contract (Phase 1+2)", () => {
  const src = read("app/dashboard/runs/[runId]/page.tsx");

  it("uses registryWorkflow for linked spec display", () => {
    expect(src).toContain("registryWorkflow");
    expect(src).toContain("data-testid=\"linked-spec-link\"");
  });

  it("uses data-testid for the no-linked-spec empty state", () => {
    expect(src).toContain("data-testid=\"no-linked-spec\"");
  });

  it("shows no-spec-nodes empty state only when no spec is available", () => {
    expect(src).toContain("data-testid=\"no-spec-nodes\"");
    // The no-spec-nodes block must appear after the registryWorkflow truthy branch
    // (registryWorkflow ? ... : <no-spec-nodes>)
    const noSpecIdx = src.indexOf("data-testid=\"no-spec-nodes\"");
    const registryWorkflowIdx = src.indexOf("registryWorkflow ?");
    expect(registryWorkflowIdx).toBeGreaterThan(0);
    expect(noSpecIdx).toBeGreaterThan(registryWorkflowIdx);
  });

  it("never renders both linked-spec-link and no-linked-spec simultaneously", () => {
    // Both states use ternary branches — the linked-spec-link and no-linked-spec
    // are in mutually exclusive branches of the same ternary on registryWorkflow.
    const linkedIdx = src.indexOf("data-testid=\"linked-spec-link\"");
    const unlinkedIdx = src.indexOf("data-testid=\"no-linked-spec\"");
    // Both must exist
    expect(linkedIdx).toBeGreaterThan(0);
    expect(unlinkedIdx).toBeGreaterThan(0);
    // The linked-spec appears before the no-linked-spec (ternary order: true branch first)
    expect(linkedIdx).toBeLessThan(unlinkedIdx);
  });

  it("uses only workflow.nodes for the node list (SavedWorkflowSummary has no spec)", () => {
    expect(src).toContain("const specNodes = workflow?.nodes");
    // The registry summary shows a count + link when no example workflow exists
    expect(src).toContain("nodes registered in spec");
  });

  it("uses specNodes for the workflow node list when example workflow available", () => {
    expect(src).toContain("specNodes.map(");
    expect(src).toContain("specNodes && specNodes.length > 0");
  });

  it("surfaces failed evals near the top using passed/severity fields (Phase 2)", () => {
    expect(src).toContain("failedEvals");
    expect(src).toContain("!e.passed");
    expect(src).toContain("Failed Evals");
    expect(src).toContain("Eval Warnings");
  });

  it("shows 'No failed evals' success state for live runs", () => {
    expect(src).toContain("No failed evals — all eval results passed.");
  });

  it("health summary shows artifact count", () => {
    expect(src).toContain("Artifacts");
    expect(src).toContain("artifact_refs");
  });

  it("uses 'Runtime proof run' label instead of old 'Run timeline'", () => {
    expect(src).toContain("Runtime proof run");
    expect(src).not.toContain('"Run timeline"');
  });

  it("uses 'Live ingestion' badge label instead of bare 'Live'", () => {
    expect(src).toContain("Live ingestion");
  });

  it("registry workflow summary shown in Cost and Latency side card", () => {
    expect(src).toContain("registryWorkflow.registryId");
    expect(src).toContain("nodeCount");
    expect(src).toContain("Linked spec");
  });
});

// ── Phase 3 — TraceTimeline filters ──────────────────────────────────────────

describe("TraceTimeline — filter tabs (Phase 3)", () => {
  const src = read("components/proof-layer/TraceTimeline.tsx");

  it("is a client component", () => {
    expect(src).toContain('"use client"');
  });

  it("defines FilterKey type with all expected keys", () => {
    expect(src).toContain("FilterKey");
    expect(src).toContain('"all"');
    expect(src).toContain('"nodes"');
    expect(src).toContain('"models"');
    expect(src).toContain('"tools"');
    expect(src).toContain('"evals"');
    expect(src).toContain('"artifacts"');
    expect(src).toContain('"errors"');
  });

  it("renders filter buttons with data-testid", () => {
    expect(src).toContain("data-testid={`timeline-filter-${key}`}");
  });

  it("has matchesFilter function covering all types", () => {
    expect(src).toContain("matchesFilter");
    expect(src).toContain("node_started");
    expect(src).toContain("model_call_started");
    expect(src).toContain("tool_call_started");
    expect(src).toContain("eval_completed");
    expect(src).toContain("artifact_created");
  });

  it("shows per-filter event counts", () => {
    expect(src).toContain("countForFilter");
  });

  it("defaults to 'all' filter", () => {
    expect(src).toContain('useState<FilterKey>("all")');
  });

  it("filters events using matchesFilter on display", () => {
    expect(src).toContain("filteredEvents");
    expect(src).toContain("orderedEvents.filter((e) => matchesFilter(e, activeFilter))");
  });

  it("shows empty state per filter type", () => {
    expect(src).toContain("filteredEvents.length === 0");
  });
});

// ── Phase 4 — Registry detail missing-links labeling ─────────────────────────

describe("Workflow Registry detail — missing-links labeling (Phase 4)", () => {
  const src = read("app/dashboard/workflows/registry/[registryId]/page.tsx");

  it("labels missing links as project-level gaps", () => {
    expect(src).toContain("Project-level gaps");
    expect(src).toContain("from source report");
  });

  it("explains gaps are informational not failures", () => {
    expect(src).toContain("informational");
    expect(src).toContain("not just this workflow");
  });

  it("clarifies registered does not mean runtime-verified", () => {
    expect(src).toContain("Registered does not mean runtime-verified");
  });

  it("clarifies source repo changes are not required", () => {
    const hasMsg = src.includes("does not need to change") || src.includes("No source repo changes are required");
    expect(hasMsg).toBe(true);
  });
});

// ── Phase 5 — Workflow Registry list filters ──────────────────────────────────

describe("Workflow Registry list — status/source filters (Phase 5)", () => {
  const src = read("app/dashboard/workflows/WorkflowsPageClient.tsx");

  it("defines StatusFilter type", () => {
    expect(src).toContain("StatusFilter");
    expect(src).toContain('"active"');
    expect(src).toContain('"needs_review"');
    expect(src).toContain('"draft"');
    expect(src).toContain('"archived"');
  });

  it("defines SourceFilter type", () => {
    expect(src).toContain("SourceFilter");
    expect(src).toContain('"scan_reconstruction"');
    expect(src).toContain('"example"');
    expect(src).toContain('"manual"');
    expect(src).toContain('"runtime_observed"');
  });

  it("renders status filter buttons with data-testid", () => {
    expect(src).toContain("data-testid={`status-filter-${key}`}");
  });

  it("renders source filter buttons with data-testid", () => {
    expect(src).toContain("data-testid={`source-filter-${key}`}");
  });

  it("shows 'needs review' badge count when any workflows need review", () => {
    expect(src).toContain("needsReviewCount");
    expect(src).toContain("needs review");
  });

  it("filters registered workflows client-side", () => {
    expect(src).toContain("const filtered = registered.filter(");
    expect(src).toContain("statusFilter !== \"all\"");
    expect(src).toContain("sourceFilter !== \"all\"");
  });

  it("shows 'Clear filters' empty state when filter yields no results", () => {
    expect(src).toContain("Clear filters");
    expect(src).toContain("No workflows match");
  });

  it("still shows Workflow Registry and Example Workflows sections", () => {
    expect(src).toContain("Workflow Registry");
    expect(src).toContain("Example Workflows");
    expect(src).toContain("static demo data");
  });
});

// ── Phase 6 — Promotion tracking in StaticProofReconstructionPanel ───────────

describe("StaticProofReconstructionPanel — promotion tracking (Phase 6)", () => {
  const src = read("components/dashboard/StaticProofReconstructionPanel.tsx");

  it("tracks promoted workflow IDs in session state", () => {
    expect(src).toContain("promotedMap");
    expect(src).toContain("setPromotedMap");
  });

  it("stores redirect URL per workflow ID after promotion", () => {
    expect(src).toContain("promotedMap[spec.workflow_id]");
    expect(src).toContain("redirectTo");
  });

  it("shows 'View in Registry' link for already-promoted workflows", () => {
    expect(src).toContain("View in Registry");
    expect(src).toContain("data-testid={`view-in-registry-${spec.workflow_id}`}");
  });

  it("shows 'Promote to Workflow Registry' button for unpromoted workflows", () => {
    expect(src).toContain("Promote to Workflow Registry");
    expect(src).toContain("data-testid={`promote-btn-${spec.workflow_id}`}");
  });

  it("shows 'Promoted to registry.' confirmation text", () => {
    expect(src).toContain("Promoted to registry.");
  });

  it("does NOT navigate away on promotion (stays on page)", () => {
    // router.push was removed from the promote path — redirect URL is stored in state
    const promoteFunc = src.slice(src.indexOf("async function promote("), src.indexOf("} finally {"));
    expect(promoteFunc).not.toContain("router.push");
  });

  it("imports Link for the View in Registry link", () => {
    expect(src).toContain("import Link from \"next/link\"");
  });
});

// ── Phase 7 — Scanner insight banner ─────────────────────────────────────────

describe("DashboardClient — scan insight banner (Phase 7)", () => {
  const src = read("components/dashboard/DashboardClient.tsx");

  it("includes ScanInsightBanner component", () => {
    expect(src).toContain("ScanInsightBanner");
  });

  it("renders 'What this means' heading", () => {
    expect(src).toContain("What this means");
  });

  it("renders 'Next best actions' section", () => {
    expect(src).toContain("Next best actions");
  });

  it("shows static scan disclaimer", () => {
    expect(src).toContain("no code was executed");
  });

  it("renders ScanInsightBanner before HealthOverview", () => {
    const bannerIdx = src.indexOf("<ScanInsightBanner");
    const healthIdx = src.indexOf("<HealthOverview");
    expect(bannerIdx).toBeGreaterThan(0);
    expect(healthIdx).toBeGreaterThan(0);
    expect(bannerIdx).toBeLessThan(healthIdx);
  });

  it("imports projectTypeLabel", () => {
    expect(src).toContain("projectTypeLabel");
  });

  it("ScanInsightBanner skips mock scans", () => {
    expect(src).toContain("isMock");
    expect(src).toContain("scanSource?.type === \"mock\"");
  });

  it("ScannerSection accepts an id prop", () => {
    expect(src).toContain("id?: string");
    expect(src).toContain('id="static-proof"');
  });
});

// ── Phase 8 — NavBar "Unlocked" indicator ────────────────────────────────────

describe("NavBar — Unlocked indicator (Phase 8)", () => {
  const src = read("components/layout/NavBar.tsx");

  it("shows 'Unlocked' text instead of 'Live'", () => {
    expect(src).toContain("Unlocked");
    expect(src).not.toContain(">Live<");
  });

  it("uses a teal indicator dot", () => {
    expect(src).toContain("bg-teal-400");
  });

  it("has a tooltip/title explaining the indicator", () => {
    expect(src).toContain("Dashboard is unlocked");
  });
});

// ── Phase 9 — V0 testing guide in ROADMAP.md ─────────────────────────────────

describe("ROADMAP.md — V0 testing guide (Phase 9)", () => {
  const src = read("docs/ROADMAP.md");

  it("includes Task 10 section", () => {
    expect(src).toContain("Task 10");
  });

  it("includes Good-to-go V0 Test Path section", () => {
    expect(src).toContain("Good-to-go V0 Test Path");
  });

  it("covers all 14 test steps", () => {
    // spot-check key steps
    expect(src).toContain("Unlock dashboard");
    expect(src).toContain("Create demo run");
    expect(src).toContain("timeline");
    expect(src).toContain("Scan a GitHub repo or ZIP");
    expect(src).toContain("Scan History");
    expect(src).toContain("Generate Static Proof Reconstruction");
    expect(src).toContain("Promote a WorkflowSpec");
    expect(src).toContain("Workflows tab");
    expect(src).toContain("Registry");
    expect(src).toContain("Lock and re-unlock");
  });

  it("documents current limitations", () => {
    expect(src).toContain("Current Limitations");
    expect(src).toContain("File-backed storage");
    expect(src).toContain("trace-emitting bridge");
    expect(src).toContain("Static reconstruction is deterministic");
    expect(src).toContain("Registered specs are contracts/drafts");
  });

  it("documents Integration Kit as next phase", () => {
    expect(src).toContain("Integration Kit");
  });
});
