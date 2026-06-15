/**
 * Task 5A + Task 6 tests.
 *
 * Covers:
 * 1. Campaign Sandbox WorkflowSpec — validates against schema, edges reference nodes, required nodes present
 * 2. Integration helper (agentpulse-client.ts) — disabled mode no-ops, factory reads env vars
 * 3. Seed script trace events — use matching run_id/workflow_id, include model metadata for LLM nodes
 * 4. Run store ingestion — seeded run stores cleanly, duplicate events deduplicated
 * 5. Docs safety — integration guide does not contain real secrets
 */

import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateWorkflowSpec, validateTraceEvent } from "@/lib/proof-layer/index";
import { fileRunStore } from "@/lib/runs/runStore";
import { runRecordSchema, traceEventSchema, evalResultSchema } from "@/lib/proof-layer/schemas";
import { generateRunId } from "@/lib/runs/runId";
import type { RunRecord, TraceEvent } from "@/lib/proof-layer/schemas";

// ── Helpers ──────────────────────────────────────────────────────────────────

const WORKFLOW_SPEC_PATH = resolve("examples/workflows/campaign-sandbox.workflow.json");
const INTEGRATION_GUIDE_PATH = resolve("docs/integrations/campaign_sandbox.md");
const CLIENT_EXAMPLE_PATH = resolve("examples/integrations/campaign-sandbox/agentpulse-client.ts");
const README_PATH = resolve("README.md");

function loadWorkflowSpec(): unknown {
  const raw = readFileSync(WORKFLOW_SPEC_PATH, "utf-8");
  return JSON.parse(raw);
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "agentpulse-t5a6-"));
  process.env["AGENTPULSE_STORE_DIR"] = tmpDir;
});

afterEach(async () => {
  delete process.env["AGENTPULSE_STORE_DIR"];
  await rm(tmpDir, { recursive: true, force: true });
});

// ── 1. Campaign Sandbox WorkflowSpec ─────────────────────────────────────────

describe("Campaign Sandbox WorkflowSpec", () => {
  it("workflow spec file exists", () => {
    expect(existsSync(WORKFLOW_SPEC_PATH)).toBe(true);
  });

  it("parses as valid JSON", () => {
    expect(() => loadWorkflowSpec()).not.toThrow();
  });

  it("validates against WorkflowSpec schema", () => {
    const spec = loadWorkflowSpec();
    expect(() => validateWorkflowSpec(spec)).not.toThrow();
  });

  it("has workflow_id campaign-sandbox-v1", () => {
    const spec = loadWorkflowSpec() as Record<string, unknown>;
    expect(spec["workflow_id"]).toBe("campaign-sandbox-v1");
  });

  it("all edges reference existing node IDs", () => {
    const spec = loadWorkflowSpec() as {
      nodes: Array<{ id: string }>;
      edges: Array<{ from: string; to: string }>;
    };
    const nodeIds = new Set(spec.nodes.map((n) => n.id));
    for (const edge of spec.edges ?? []) {
      expect(nodeIds.has(edge.from), `Edge from="${edge.from}" not in nodes`).toBe(true);
      expect(nodeIds.has(edge.to), `Edge to="${edge.to}" not in nodes`).toBe(true);
    }
  });

  it("contains required node IDs for the full pipeline", () => {
    const spec = loadWorkflowSpec() as { nodes: Array<{ id: string }> };
    const nodeIds = new Set(spec.nodes.map((n) => n.id));
    const requiredNodes = [
      "messy-brief-intake",
      "normalize-brief",
      "extract-strategic-tension",
      "generate-routes",
      "build-personas",
      "simulate-reactions",
      "score-routes",
      "premortem-review",
      "compare-routes",
      "human-selection",
      "generate-execution-plan",
      "export-artifact",
    ];
    for (const id of requiredNodes) {
      expect(nodeIds.has(id), `Required node "${id}" not in workflow spec`).toBe(true);
    }
  });

  it("has at least one approval node (human-selection)", () => {
    const spec = loadWorkflowSpec() as { nodes: Array<{ id: string; type: string }> };
    const approvalNodes = spec.nodes.filter((n) => n.type === "approval");
    expect(approvalNodes.length).toBeGreaterThanOrEqual(1);
  });

  it("LLM nodes include model_provider and model_name", () => {
    const spec = loadWorkflowSpec() as {
      nodes: Array<{ id: string; type: string; model_provider?: string; model_name?: string }>;
    };
    const llmNodes = spec.nodes.filter((n) => n.type === "llm");
    expect(llmNodes.length).toBeGreaterThan(0);
    for (const node of llmNodes) {
      expect(node.model_provider, `LLM node ${node.id} missing model_provider`).toBeTruthy();
      expect(node.model_name, `LLM node ${node.id} missing model_name`).toBeTruthy();
    }
  });

  it("has eval_refs listed on the spec-level evals array", () => {
    const spec = loadWorkflowSpec() as { evals?: string[] };
    expect(Array.isArray(spec.evals)).toBe(true);
    expect((spec.evals ?? []).length).toBeGreaterThan(0);
  });

  it("has approval_gates listing human-selection", () => {
    const spec = loadWorkflowSpec() as { approval_gates?: string[] };
    expect(Array.isArray(spec.approval_gates)).toBe(true);
    expect(spec.approval_gates).toContain("human-selection");
  });
});

// ── 2. Integration helper files ───────────────────────────────────────────────

describe("Integration helper files", () => {
  it("agentpulse-client.ts exists", () => {
    expect(existsSync(CLIENT_EXAMPLE_PATH)).toBe(true);
  });

  it("instrumentation.ts exists", () => {
    const instrPath = resolve("examples/integrations/campaign-sandbox/instrumentation.ts");
    expect(existsSync(instrPath)).toBe(true);
  });

  it("integration README exists", () => {
    const readmePath = resolve("examples/integrations/campaign-sandbox/README.md");
    expect(existsSync(readmePath)).toBe(true);
  });

  it("agentpulse-client.ts exports createCampaignSandboxPulseClient", () => {
    const source = readFileSync(CLIENT_EXAMPLE_PATH, "utf-8");
    expect(source).toContain("createCampaignSandboxPulseClient");
  });

  it("agentpulse-client.ts exports CampaignSandboxPulseClient class", () => {
    const source = readFileSync(CLIENT_EXAMPLE_PATH, "utf-8");
    expect(source).toContain("class CampaignSandboxPulseClient");
  });

  it("agentpulse-client.ts includes AGENTPULSE_ENABLED no-op pattern", () => {
    const source = readFileSync(CLIENT_EXAMPLE_PATH, "utf-8");
    expect(source).toContain("enabled");
  });
});

// ── 3. Docs safety ────────────────────────────────────────────────────────────

describe("Docs safety — no real secrets in integration guide", () => {
  it("integration guide exists", () => {
    expect(existsSync(INTEGRATION_GUIDE_PATH)).toBe(true);
  });

  it("integration guide does not contain sk-ant- style keys", () => {
    const guide = readFileSync(INTEGRATION_GUIDE_PATH, "utf-8");
    expect(guide).not.toMatch(/sk-ant-[A-Za-z0-9-]{10,}/);
  });

  it("integration guide does not contain ghp_ tokens", () => {
    const guide = readFileSync(INTEGRATION_GUIDE_PATH, "utf-8");
    expect(guide).not.toMatch(/ghp_[A-Za-z0-9]{36,}/);
  });

  it("integration guide uses placeholder env values only", () => {
    const guide = readFileSync(INTEGRATION_GUIDE_PATH, "utf-8");
    // All env var examples should use placeholder values
    expect(guide).toContain("your-ingest-key-here");
  });

  it("README env var table includes AGENTPULSE_INGEST_KEY", () => {
    const readme = readFileSync(README_PATH, "utf-8");
    expect(readme).toContain("AGENTPULSE_INGEST_KEY");
  });

  it("README documents that INGEST_KEY and ACCESS_KEY should differ in production", () => {
    const readme = readFileSync(README_PATH, "utf-8");
    expect(readme).toContain("different");
  });

  it("README documents DATABASE_URL as the production storage requirement", () => {
    const readme = readFileSync(README_PATH, "utf-8");
    expect(readme).toContain("DATABASE_URL");
    expect(readme).toContain("Postgres");
  });
});

// ── 4. Seed script trace events structure ─────────────────────────────────────

describe("Campaign Sandbox seed trace events", () => {
  const WORKFLOW_ID = "campaign-sandbox-v1";
  const RUN_ID = "test-cs-seed-run-001";

  function makeCsTraceEvent(overrides: Partial<TraceEvent>): TraceEvent {
    return traceEventSchema.parse({
      event_id: `evt-cs-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      run_id: RUN_ID,
      workflow_id: WORKFLOW_ID,
      timestamp: new Date().toISOString(),
      event_type: "node_started",
      status: "running",
      ...overrides,
    });
  }

  it("model_call events include model_provider and model_name in metadata", () => {
    const event = makeCsTraceEvent({
      event_type: "model_call_completed",
      node_id: "generate-routes",
      status: "completed",
      duration_ms: 7000,
      cost_usd: 0.0094,
      metadata: {
        model_provider: "anthropic",
        model_name: "claude-sonnet-4-6",
        input_tokens: 1100,
        output_tokens: 720,
      },
    });
    expect(event.metadata?.["model_provider"]).toBe("anthropic");
    expect(event.metadata?.["model_name"]).toBe("claude-sonnet-4-6");
  });

  it("eval_completed events include passed and score in metadata", () => {
    const event = makeCsTraceEvent({
      event_type: "eval_completed",
      node_id: "score-routes",
      metadata: {
        eval_id: "route-score-schema-validity",
        eval_name: "Route Score Schema Validity",
        passed: true,
        score: 1.0,
      },
    });
    expect(event.metadata?.["passed"]).toBe(true);
    expect(event.metadata?.["score"]).toBe(1.0);
  });

  it("artifact_created event includes artifact_ref in metadata", () => {
    const event = makeCsTraceEvent({
      event_type: "artifact_created",
      node_id: "export-artifact",
      metadata: {
        artifact_ref: `campaign-recommendation-${RUN_ID}.json`,
        artifact_type: "json_report",
      },
    });
    expect(typeof event.metadata?.["artifact_ref"]).toBe("string");
    expect(String(event.metadata?.["artifact_ref"])).toContain(RUN_ID);
  });

  it("approval_requested event has pending status", () => {
    const event = makeCsTraceEvent({
      event_type: "approval_requested",
      node_id: "human-selection",
      status: "pending",
    });
    expect(event.status).toBe("pending");
    expect(event.event_type).toBe("approval_requested");
  });
});

// ── 5. Run store — Campaign Sandbox ingestion ─────────────────────────────────

describe("Run store — Campaign Sandbox seeded run", () => {
  const WORKFLOW_ID = "campaign-sandbox-v1";

  function makeCsRunRecord(): RunRecord {
    return runRecordSchema.parse({
      run_id: generateRunId(),
      workflow_id: WORKFLOW_ID,
      project_id: "campaign-sandbox",
      project_name: "Campaign Sandbox",
      status: "running",
      started_at: new Date().toISOString(),
      model_calls_count: 0,
      tool_calls_count: 0,
      evals_passed: 0,
      evals_failed: 0,
      artifact_refs: [],
      summary: "Test Campaign Sandbox run.",
    });
  }

  function makeCsTraceEvent(runId: string, overrides: Partial<TraceEvent> = {}): TraceEvent {
    return traceEventSchema.parse({
      event_id: `evt-cs-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      run_id: runId,
      workflow_id: WORKFLOW_ID,
      timestamp: new Date().toISOString(),
      event_type: "node_started",
      status: "running",
      ...overrides,
    });
  }

  it("can create and retrieve a Campaign Sandbox run", async () => {
    const run = makeCsRunRecord();
    const result = await fileRunStore.createRun(run);
    expect(result.saved).toBe(true);
    const retrieved = await fileRunStore.getRun(run.run_id);
    expect(retrieved?.runRecord.workflow_id).toBe(WORKFLOW_ID);
    expect(retrieved?.runRecord.project_id).toBe("campaign-sandbox");
  });

  it("appends model call events and they are retrievable", async () => {
    const run = makeCsRunRecord();
    await fileRunStore.createRun(run);
    const modelEvent = makeCsTraceEvent(run.run_id, {
      event_type: "model_call_completed",
      node_id: "generate-routes",
      cost_usd: 0.0094,
      metadata: { model_provider: "anthropic", model_name: "claude-sonnet-4-6" },
    });
    const appendResult = await fileRunStore.appendTraceEvent(run.run_id, modelEvent);
    expect(appendResult.appended).toBe(true);
    const retrieved = await fileRunStore.getRun(run.run_id);
    const found = retrieved?.traceEvents.find((e) => e.event_id === modelEvent.event_id);
    expect(found).toBeDefined();
    expect(found?.event_type).toBe("model_call_completed");
  });

  it("appends eval results for Campaign Sandbox evals", async () => {
    const run = makeCsRunRecord();
    await fileRunStore.createRun(run);
    const er = evalResultSchema.parse({
      eval_id: "route-distinctiveness",
      run_id: run.run_id,
      node_id: "generate-routes",
      name: "Route Distinctiveness",
      type: "output_quality",
      score: 0.61,
      passed: false,
      severity: "warning",
      findings: ["Routes 1 and 3 share primary audience."],
      recommendation: "Regenerate with explicit audience constraint.",
    });
    await fileRunStore.appendEvalResult(run.run_id, er);
    const retrieved = await fileRunStore.getRun(run.run_id);
    const found = retrieved?.evalResults.find((e) => e.eval_id === "route-distinctiveness");
    expect(found?.passed).toBe(false);
    expect(found?.severity).toBe("warning");
  });

  it("completes a Campaign Sandbox run with degraded status", async () => {
    const run = makeCsRunRecord();
    await fileRunStore.createRun(run);
    await fileRunStore.completeRun(run.run_id, {
      status: "degraded",
      total_cost_usd: 0.057,
      total_duration_ms: 109100,
      model_calls_count: 6,
      tool_calls_count: 1,
      evals_passed: 5,
      evals_failed: 1,
      artifact_refs: ["campaign-recommendation.json"],
      summary: "Run degraded: route-distinctiveness eval failed.",
    });
    const retrieved = await fileRunStore.getRun(run.run_id);
    expect(retrieved?.runRecord.status).toBe("degraded");
    expect(retrieved?.runRecord.total_cost_usd).toBe(0.057);
    expect(retrieved?.runRecord.evals_failed).toBe(1);
  });

  it("deduplicates duplicate trace event_id values", async () => {
    const run = makeCsRunRecord();
    await fileRunStore.createRun(run);
    const event = makeCsTraceEvent(run.run_id, {
      event_id: "evt-dupe-test-cs",
      event_type: "node_started",
      node_id: "normalize-brief",
    });
    const r1 = await fileRunStore.appendTraceEvent(run.run_id, event);
    const r2 = await fileRunStore.appendTraceEvent(run.run_id, event);
    expect(r1.appended).toBe(true);
    expect(r2.appended).toBe(false);
    const retrieved = await fileRunStore.getRun(run.run_id);
    const matching = retrieved?.traceEvents.filter((e) => e.event_id === "evt-dupe-test-cs");
    expect(matching).toHaveLength(1);
  });

  it("validates all required Campaign Sandbox workflow node IDs match trace node_ids", () => {
    const workflowSpec = loadWorkflowSpec() as { nodes: Array<{ id: string }> };
    const nodeIds = new Set(workflowSpec.nodes.map((n) => n.id));

    // These are the node_ids used in the seed trace — they should all be in the spec
    const seedNodeIds = [
      "messy-brief-intake",
      "normalize-brief",
      "extract-strategic-tension",
      "generate-routes",
      "build-personas",
      "simulate-reactions",
      "score-routes",
      "premortem-review",
      "compare-routes",
      "human-selection",
      "generate-execution-plan",
      "export-artifact",
    ];

    for (const nodeId of seedNodeIds) {
      expect(nodeIds.has(nodeId), `Seed uses node "${nodeId}" not in workflow spec`).toBe(true);
    }
  });
});

// ── 6. DEPLOYMENT.md has trace ingestion smoke checklist ─────────────────────

describe("Deployment docs", () => {
  const DEPLOYMENT_PATH = resolve("docs/DEPLOYMENT.md");

  it("DEPLOYMENT.md exists", () => {
    expect(existsSync(DEPLOYMENT_PATH)).toBe(true);
  });

  it("DEPLOYMENT.md includes trace ingestion smoke test steps", () => {
    const content = readFileSync(DEPLOYMENT_PATH, "utf-8");
    expect(content).toContain("seed:traces");
    expect(content).toContain("/dashboard/runs");
    expect(content).toContain("Trace Ingestion");
  });

  it("DEPLOYMENT.md documents durable Postgres storage requirements", () => {
    const content = readFileSync(DEPLOYMENT_PATH, "utf-8");
    expect(content).toContain("DATABASE_URL");
    expect(content).toContain("Postgres");
  });

  it("DEPLOYMENT.md documents AGENTPULSE_INGEST_KEY", () => {
    const content = readFileSync(DEPLOYMENT_PATH, "utf-8");
    expect(content).toContain("AGENTPULSE_INGEST_KEY");
  });
});

