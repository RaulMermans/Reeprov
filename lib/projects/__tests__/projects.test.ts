import { beforeAll, describe, expect, it } from "vitest";
import { ProjectStore } from "../projectStore";
import { ProjectExporter } from "../projectExport";
import { ProjectDeletionManager } from "../projectDelete";
import { computeCaptureReadiness } from "../captureReadiness";
import type { RunArtifact } from "@/lib/core/contracts/runArtifact";

describe("Canonical Project Store & Model", () => {
  beforeAll(async () => {
    try {
      await ProjectDeletionManager.confirmDelete("autonomous-support-bot", "autonomous-support-bot");
    } catch {
      // ignore
    }
  });

  it("creates a new project and generates an ingest key preview", async () => {
    const { project, rawIngestKey } = await ProjectStore.createProject({
      name: "Autonomous Support Bot",
      description: "Handles customer refunds and tier-1 questions.",
      language: "typescript",
      framework: "langgraph",
    });

    expect(project.id).toBe("autonomous-support-bot");
    expect(project.name).toBe("Autonomous Support Bot");
    expect(project.status).toBe("waiting_for_first_event");
    expect(rawIngestKey).toMatch(/^ree_live_[0-9a-f]{48}$/);
    expect(project.ingestKeyPreview).toMatch(/^ree_live_\.\.\.[0-9a-f]{8}$/);
  });

  it("lists projects including newly created project", async () => {
    const list = await ProjectStore.listProjects();
    expect(list.some((p) => p.id === "autonomous-support-bot")).toBe(true);
  });

  it("retrieves project by id", async () => {
    const proj = await ProjectStore.getProject("autonomous-support-bot");
    expect(proj).not.toBeNull();
    expect(proj?.name).toBe("Autonomous Support Bot");
  });

  it("updates project metadata", async () => {
    const updated = await ProjectStore.updateProject("autonomous-support-bot", {
      description: "Updated description for test.",
    });
    expect(updated?.description).toBe("Updated description for test.");
  });

  it("rotates ingest key and returns new raw key", async () => {
    const res = await ProjectStore.rotateIngestKey("autonomous-support-bot");
    expect(res).not.toBeNull();
    expect(res?.rawIngestKey).toMatch(/^ree_live_[0-9a-f]{48}$/);
  });
});

describe("Safe Project Export & Deletion", () => {
  it("exports sanitized project bundle without exposing raw keys", async () => {
    const bundle = await ProjectExporter.exportProject("autonomous-support-bot");
    expect(bundle.project.id).toBe("autonomous-support-bot");
    expect(bundle.project).not.toHaveProperty("ingestKeyPreview");
    expect(bundle.version).toBe("1.0.0");
    expect(Array.isArray(bundle.runs)).toBe(true);
  });

  it("previews deletion impact with resource counts", async () => {
    const preview = await ProjectDeletionManager.previewDeletion("autonomous-support-bot");
    expect(preview.projectId).toBe("autonomous-support-bot");
    expect(preview.confirmationRequired).toBe("autonomous-support-bot");
    expect(preview.estimatedDiskKb).toBeGreaterThan(0);
  });

  it("rejects deletion when confirmation input does not match", async () => {
    await expect(
      ProjectDeletionManager.confirmDelete("autonomous-support-bot", "wrong-name")
    ).rejects.toThrow("Confirmation mismatch");
  });

  it("successfully deletes project upon matching confirmation", async () => {
    const result = await ProjectDeletionManager.confirmDelete(
      "autonomous-support-bot",
      "autonomous-support-bot"
    );
    expect(result.success).toBe(true);

    const check = await ProjectStore.getProject("autonomous-support-bot");
    expect(check).toBeNull();
  });
});

describe("Capture Readiness Engine & Replay Projection", () => {
  it("evaluates empty/null run as INSUFFICIENT with score 0", async () => {
    const report = await computeCaptureReadiness(null);
    expect(report.overallScore).toBe(0);
    expect(report.rating).toBe("INSUFFICIENT");
    expect(report.replayProjection.projectedMode).toBe("UNSUPPORTED");
  });

  it("evaluates run with lifecycle and models accurately", async () => {
    const mockRun: RunArtifact = {
      schema_version: "1.0.0-alpha",
      identity: {
        run_id: "mock_test_001",
        project_id: "test-proj",
        project_name: "Test Project",
        workflow_id: "wf-1",
        created_at: new Date().toISOString(),
      },
      execution: {
        status: "completed",
        started_at: "2026-10-13T10:00:00.000Z",
        completed_at: "2026-10-13T10:00:05.000Z",
        duration_ms: 5000,
        summary: "Completed successfully",
      },
      trajectory: [
        {
          step_id: "s1",
          step_index: 0,
          step_type: "model_call",
          name: "agent_llm",
          started_at: "2026-10-13T10:00:01.000Z",
          status: "completed",
          boundary_ids: [],
          tool_invocation_ids: [],
          model_call_ids: ["m1"],
          retrieval_operation_ids: [],
          eval_result_ids: [],
          artifact_ids: [],
        },
      ],
      model_calls: [
        {
          call_id: "m1",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          status: "COMPLETED",
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          cost_usd: 0.001,
          duration_ms: 800,
          created_at: "2026-10-13T10:00:01.000Z",
        },
      ],
      boundaries: [],
      tool_invocations: [],
      retrieval_operations: [],
      state_checkpoints: [],
      eval_results: [],
      observability: {
        input_tokens: 100,
        output_tokens: 50,
        total_cost_usd: 0.001,
      },
      configuration_snapshot: {
        snapshot_id: "cfg_1",
        run_id: "mock_test_001",
        captured_at: new Date().toISOString(),
        declaration_type: "EFFECTIVE",
        config_hash: "hash123456789",
      },
      integrity_hash: "sha256:abcd",
    };

    const report = await computeCaptureReadiness(mockRun);
    expect(report.overallScore).toBeGreaterThan(40);
    expect(report.dimensions.some((d) => d.category === "MODEL" && d.level === "COMPLETE")).toBe(true);
    expect(report.dimensions.some((d) => d.category === "STATE" && d.level === "ABSENT")).toBe(true);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });
});

describe("Sprint 10: Demo Project & Local CLI Parity", () => {
  it("initializes deterministic demo project with success, failure, baseline, and gate report", async () => {
    const { DemoProjectManager, DEMO_PROJECT_ID } = await import("../demoProject");
    const result = await DemoProjectManager.setupDemoProject();

    expect(result.project.id).toBe(DEMO_PROJECT_ID);
    expect(result.successRunId).toBe("demo_run_success_001");
    expect(result.failureRunId).toBe("demo_run_failure_002");
    expect(result.baselineId).toBeDefined();

    const storedProject = await ProjectStore.getProject(DEMO_PROJECT_ID);
    expect(storedProject).not.toBeNull();
    expect(storedProject?.id).toBe(DEMO_PROJECT_ID);
  });

  it("resets demo project cleanly", async () => {
    const { DemoProjectManager, DEMO_PROJECT_ID } = await import("../demoProject");
    await DemoProjectManager.resetDemoProject();
    const storedProject = await ProjectStore.getProject(DEMO_PROJECT_ID);
    expect(storedProject).not.toBeNull();
  });

  it("runs pulse data-path and pulse projects-list via runCli", async () => {
    const { runCli, parseArgs } = await import("../../../scripts/pulse-cli");

    const dataPathArgs = parseArgs(["data-path", "--json"]);
    expect(dataPathArgs).toEqual({ command: "data-path", json: true });

    const code1 = await runCli(["data-path", "--json"]);
    expect(code1).toBe(0);

    const projListArgs = parseArgs(["projects", "list", "--json"]);
    expect(projListArgs).toEqual({ command: "projects-list", json: true });

    const code2 = await runCli(["projects", "list", "--json"]);
    expect(code2).toBe(0);

    const exportArgs = parseArgs(["export", "project", "demo-support-agent", "--json"]);
    expect(exportArgs).toEqual({
      command: "project-export",
      projectId: "demo-support-agent",
      outPath: undefined,
      json: true,
    });

    const code3 = await runCli(["export", "project", "demo-support-agent", "--json"]);
    expect(code3).toBe(0);
  });
});
