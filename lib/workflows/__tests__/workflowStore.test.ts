/**
 * Task 9 — Workflow Registry store tests.
 *
 * Uses a real temp directory per test run so we verify actual I/O behavior.
 * Overrides AGENTPULSE_STORE_DIR so tests don't pollute .agentpulse/workflows.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileWorkflowStore } from "@/lib/workflows/workflowStore";
import type { SaveWorkflowInput } from "@/lib/workflows/workflowTypes";
import type { WorkflowSpec } from "@/lib/proof-layer/schemas";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "agentpulse-workflows-test-"));
  process.env["AGENTPULSE_STORE_DIR"] = tmpDir;
});

afterEach(async () => {
  delete process.env["AGENTPULSE_STORE_DIR"];
  await rm(tmpDir, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeSpec(id: string, name: string): WorkflowSpec {
  return {
    workflow_id: id,
    name,
    architecture_type: "single_agent",
    nodes: [
      { id: "trigger", type: "trigger", label: "Trigger" },
      { id: "agent", type: "agent", label: "Agent" },
    ],
    edges: [{ from: "trigger", to: "agent" }],
  };
}

function makeInput(overrides: Partial<SaveWorkflowInput> = {}): SaveWorkflowInput {
  return {
    workflowId: "test-workflow-v1",
    projectId: "proj_test",
    projectName: "Test Project",
    name: "Test Workflow",
    source: "scan_reconstruction",
    confidence: "medium",
    status: "needs_review",
    evidencePaths: ["agents.yaml"],
    missingFields: ["model_provider"],
    spec: makeSpec("test-workflow-v1", "Test Workflow"),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("fileWorkflowStore", () => {

  describe("saveWorkflow", () => {
    it("saves a workflow and returns a SavedWorkflowSpec", async () => {
      const saved = await fileWorkflowStore.saveWorkflow(makeInput());
      expect(saved.registryId).toMatch(/^wfr_/);
      expect(saved.workflowId).toBe("test-workflow-v1");
      expect(saved.name).toBe("Test Workflow");
      expect(saved.status).toBe("needs_review");
      expect(saved.confidence).toBe("medium");
      expect(saved.source).toBe("scan_reconstruction");
      expect(saved.missingFields).toEqual(["model_provider"]);
      expect(saved.spec.workflow_id).toBe("test-workflow-v1");
    });

    it("assigns version from spec if not set", async () => {
      const saved = await fileWorkflowStore.saveWorkflow(makeInput());
      expect(saved.version).toBe("1.0");
    });

    it("deduplicates by workflowId + sourceReportId — updates existing entry", async () => {
      const input = makeInput({ sourceReportId: "rpt_abc123" });
      const first = await fileWorkflowStore.saveWorkflow(input);

      // Save again with same workflowId + sourceReportId — should update not create a new entry.
      const second = await fileWorkflowStore.saveWorkflow({
        ...input,
        status: "active",
        missingFields: [],
      });

      expect(second.registryId).toBe(first.registryId);
      expect(second.status).toBe("active");
      expect(second.missingFields).toEqual([]);

      const list = await fileWorkflowStore.listWorkflows();
      expect(list).toHaveLength(1);
    });

    it("does NOT deduplicate entries without sourceReportId", async () => {
      const input = makeInput(); // no sourceReportId
      await fileWorkflowStore.saveWorkflow(input);
      await fileWorkflowStore.saveWorkflow(input);
      const list = await fileWorkflowStore.listWorkflows();
      expect(list).toHaveLength(2);
    });
  });

  describe("listWorkflows", () => {
    it("returns all workflows newest first", async () => {
      await fileWorkflowStore.saveWorkflow(makeInput({ workflowId: "wf-1", name: "First" }));
      await fileWorkflowStore.saveWorkflow(makeInput({ workflowId: "wf-2", name: "Second" }));
      const list = await fileWorkflowStore.listWorkflows();
      expect(list).toHaveLength(2);
      expect(list[0]!.workflowId).toBe("wf-2");
      expect(list[1]!.workflowId).toBe("wf-1");
    });

    it("filters by status", async () => {
      await fileWorkflowStore.saveWorkflow(makeInput({ workflowId: "wf-a", status: "active" }));
      await fileWorkflowStore.saveWorkflow(makeInput({ workflowId: "wf-b", status: "needs_review" }));
      const active = await fileWorkflowStore.listWorkflows({ status: "active" });
      expect(active).toHaveLength(1);
      expect(active[0]!.workflowId).toBe("wf-a");
    });

    it("filters by confidence", async () => {
      await fileWorkflowStore.saveWorkflow(makeInput({ workflowId: "wf-h", confidence: "high" }));
      await fileWorkflowStore.saveWorkflow(makeInput({ workflowId: "wf-l", confidence: "low" }));
      const high = await fileWorkflowStore.listWorkflows({ confidence: "high" });
      expect(high).toHaveLength(1);
      expect(high[0]!.workflowId).toBe("wf-h");
    });

    it("filters by workflowId", async () => {
      await fileWorkflowStore.saveWorkflow(makeInput({ workflowId: "wf-x" }));
      await fileWorkflowStore.saveWorkflow(makeInput({ workflowId: "wf-y" }));
      const found = await fileWorkflowStore.listWorkflows({ workflowId: "wf-x" });
      expect(found).toHaveLength(1);
      expect(found[0]!.workflowId).toBe("wf-x");
    });

    it("respects limit", async () => {
      for (let i = 0; i < 5; i++) {
        await fileWorkflowStore.saveWorkflow(makeInput({ workflowId: `wf-${i}` }));
      }
      const limited = await fileWorkflowStore.listWorkflows({ limit: 3 });
      expect(limited).toHaveLength(3);
    });

    it("returns empty array when store is empty", async () => {
      const list = await fileWorkflowStore.listWorkflows();
      expect(list).toEqual([]);
    });
  });

  describe("getWorkflow", () => {
    it("returns the full saved workflow spec", async () => {
      const saved = await fileWorkflowStore.saveWorkflow(makeInput());
      const fetched = await fileWorkflowStore.getWorkflow(saved.registryId);
      expect(fetched).not.toBeNull();
      expect(fetched!.registryId).toBe(saved.registryId);
      expect(fetched!.spec.workflow_id).toBe("test-workflow-v1");
    });

    it("returns null for unknown registryId", async () => {
      const result = await fileWorkflowStore.getWorkflow("wfr_does_not_exist");
      expect(result).toBeNull();
    });
  });

  describe("getWorkflowByWorkflowId", () => {
    it("returns the workflow matching workflowId", async () => {
      await fileWorkflowStore.saveWorkflow(makeInput({ workflowId: "find-me" }));
      const found = await fileWorkflowStore.getWorkflowByWorkflowId("find-me");
      expect(found).not.toBeNull();
      expect(found!.workflowId).toBe("find-me");
    });

    it("returns null when workflowId not registered", async () => {
      const found = await fileWorkflowStore.getWorkflowByWorkflowId("does-not-exist");
      expect(found).toBeNull();
    });
  });

  describe("updateWorkflowStatus", () => {
    it("updates status and updatedAt", async () => {
      const saved = await fileWorkflowStore.saveWorkflow(makeInput({ status: "needs_review" }));
      const before = saved.updatedAt;

      await new Promise((r) => setTimeout(r, 5)); // ensure time advances
      const updated = await fileWorkflowStore.updateWorkflowStatus(saved.registryId, "active");

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("active");
      expect(updated!.updatedAt).not.toBe(before);
    });

    it("returns null for unknown registryId", async () => {
      const result = await fileWorkflowStore.updateWorkflowStatus("wfr_ghost", "active");
      expect(result).toBeNull();
    });

    it("updates the index as well", async () => {
      const saved = await fileWorkflowStore.saveWorkflow(makeInput({ status: "draft" }));
      await fileWorkflowStore.updateWorkflowStatus(saved.registryId, "archived");
      const list = await fileWorkflowStore.listWorkflows({ status: "archived" });
      expect(list).toHaveLength(1);
    });
  });

  describe("deleteWorkflow", () => {
    it("removes from store and index", async () => {
      const saved = await fileWorkflowStore.saveWorkflow(makeInput());
      const deleted = await fileWorkflowStore.deleteWorkflow(saved.registryId);
      expect(deleted).toBe(true);

      const list = await fileWorkflowStore.listWorkflows();
      expect(list).toHaveLength(0);

      const fetched = await fileWorkflowStore.getWorkflow(saved.registryId);
      expect(fetched).toBeNull();
    });

    it("returns false for unknown registryId", async () => {
      const result = await fileWorkflowStore.deleteWorkflow("wfr_ghost");
      expect(result).toBe(false);
    });
  });

  describe("summary accuracy", () => {
    it("summary reflects node/edge/tool/eval counts", async () => {
      const spec: WorkflowSpec = {
        workflow_id: "summary-test",
        name: "Summary Test",
        architecture_type: "workflow_tools",
        nodes: [
          { id: "n1", type: "trigger", label: "T1" },
          { id: "n2", type: "tool", label: "T2" },
          { id: "n3", type: "approval", label: "T3" },
        ],
        edges: [{ from: "n1", to: "n2" }, { from: "n2", to: "n3" }],
        allowed_tools: ["tool_a", "tool_b"],
        evals: ["eval_x", "eval_y", "eval_z"],
      };

      const saved = await fileWorkflowStore.saveWorkflow({
        ...makeInput(),
        workflowId: "summary-test",
        spec,
        missingFields: ["model_provider", "prompt"],
      });

      const list = await fileWorkflowStore.listWorkflows();
      const summary = list[0]!;
      expect(summary.nodeCount).toBe(3);
      expect(summary.edgeCount).toBe(2);
      expect(summary.toolCount).toBe(2);
      expect(summary.evalCount).toBe(3);
      expect(summary.missingFieldCount).toBe(2);
    });
  });
});
