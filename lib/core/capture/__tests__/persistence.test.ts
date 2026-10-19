import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { saveCanonicalRun, getCanonicalRun } from "../persistence";
import { CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION, type RunArtifact } from "../../contracts/runArtifact";
import { hasDatabaseUrl } from "@/lib/db/client";
import { fileRunStore } from "@/lib/runs/runStore";
import { normalizeBoundary } from "../normalizeBoundary";

describe("Canonical Run & Boundary Persistence", () => {
  const testStoreDir = join(process.cwd(), ".agentpulse-test-runs");
  const origStoreDir = process.env["AGENTPULSE_STORE_DIR"];

  beforeEach(() => {
    process.env["AGENTPULSE_STORE_DIR"] = testStoreDir;
  });

  afterEach(async () => {
    if (origStoreDir) process.env["AGENTPULSE_STORE_DIR"] = origStoreDir;
    else delete process.env["AGENTPULSE_STORE_DIR"];

    try {
      await rm(testStoreDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("persists a canonical RunArtifact and reloads it deterministically from file store", async () => {
    const artifact: RunArtifact = {
      schema_version: CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION,
      identity: {
        run_id: "run_persist_test_001",
        project_id: "test_project",
        project_name: "Test Project",
        workflow_id: "wf_persist_01",
        created_at: new Date().toISOString(),
      },
      execution: {
        status: "completed",
        started_at: "2026-10-10T09:00:00.000Z",
        completed_at: "2026-10-10T09:00:02.000Z",
        duration_ms: 2000,
        summary: "Execution of test persistence workflow",
      },
      environment: { runtime: "node", sdk_version: "1.0.0" },
      trajectory: [
        {
          step_id: "step_0",
          step_index: 0,
          step_type: "model_call",
          name: "Model step",
          started_at: "2026-10-10T09:00:00.000Z",
          status: "completed",
          boundary_ids: ["bnd_0"],
          tool_invocation_ids: [],
          model_invocation_ids: ["model_0"],
          memory_operation_ids: [],
          retrieval_operation_ids: [],
          eval_result_ids: [],
          artifact_ids: [],
        },
      ],
      boundaries: [
        {
          boundary_id: "bnd_0",
          run_id: "run_persist_test_001",
          sequence_index: 0,
          boundary_type: "model_call",
          name: "openai/gpt-4o",
          status: "completed",
          input: { captured: true, content: "Hello", summary: "Hello", redaction_status: "none" },
          output: { captured: true, content: "World", summary: "World", redaction_status: "none" },
          replayability: "REPLAYABLE_RECORDED",
          side_effect_class: "read_only",
          idempotency: { is_idempotent: false },
          captured_content_availability: "CAPTURED",
          redaction_status: "none",
          timestamp: "2026-10-10T09:00:00.000Z",
        },
      ],
      external_calls: [],
      state: [],
      context: [],
      memory: { operations: [], references: [] },
      tools: [],
      retrieval: [],
      models: [
        {
          invocation_id: "model_0",
          model_name: "gpt-4o",
          provider: "openai",
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          raw_captured: true,
          started_at: "2026-10-10T09:00:00.000Z",
        },
      ],
      artifacts: [],
      evals: [],
      lineage: { mutations: [] },
      provenance: {
        capture_method: "sdk_trace",
        adapter_version: "1.0.0",
        redaction_verified: true,
      },
      safety: {
        approval_status: "not_required",
        approval_records: [],
        redaction_summary: { total_redactions: 0, secrets_detected: 0, fields_redacted: [] },
      },
      observability: {
        model_calls_count: 1,
        tool_calls_count: 0,
        evals_passed: 0,
        evals_failed: 0,
        trace_event_count: 1,
        context_snapshot_count: 0,
        memory_operations_count: 0,
        retrieval_operations_count: 0,
      },
      replay: {
        overall_replayability: "REPLAYABLE_RECORDED",
        unsupported_boundaries_count: 0,
        side_effect_gated_count: 0,
        deterministic: false,
        sandboxed_available: false,
        missing_recordings: [],
        notes: [],
      },
    };

    const secret = ["sk", "abcdefghijklmnopqrstuvwxyz0123456789ABCD"].join("-");
    artifact.boundaries[0] = await normalizeBoundary({
      boundaryId: "bnd_0",
      runId: "run_persist_test_001",
      stepId: "step_0",
      sequenceIndex: 0,
      boundaryType: "model_call",
      name: "openai/gpt-4o",
      input: `prompt ${secret}`,
      inputSummary: `summary ${secret}`,
      output: `response ${secret}`,
      outputSummary: `summary ${secret}`,
      error: { message: `error ${secret}` },
      metadata: { note: secret },
    });

    const saveRes = await saveCanonicalRun(artifact);
    expect(saveRes.success).toBe(true);

    const reloaded = await getCanonicalRun("run_persist_test_001");
    expect(reloaded).not.toBeNull();
    expect(reloaded?.identity.run_id).toBe("run_persist_test_001");
    expect(reloaded?.boundaries).toHaveLength(1);
    expect(reloaded?.boundaries[0].name).toBe("openai/gpt-4o");
    expect(reloaded?.models).toHaveLength(1);
    expect(JSON.stringify(reloaded)).not.toContain(secret);
    const exportedJson = await readFile(join(testStoreDir, "runs", "run_persist_test_001.canonical.json"), "utf8");
    expect(exportedJson).not.toContain(secret);
  });

  it("transparently adapts legacy runs when no canonical file exists (backward compatibility)", async () => {
    // Create legacy run in the store
    const legacyRunId = "run_legacy_compat_001";
    await fileRunStore.createRun({
      run_id: legacyRunId,
      project_id: "proj_legacy",
      project_name: "Legacy Project",
      workflow_id: "legacy_wf",
      status: "completed",
      started_at: "2026-05-01T12:00:00.000Z",
      completed_at: "2026-05-01T12:00:05.000Z",
      summary: "A legacy run without canonical contracts",
      model_calls_count: 0,
      tool_calls_count: 0,
      evals_passed: 0,
      evals_failed: 0,
      artifact_refs: [],
    });

    const adapted = await getCanonicalRun(legacyRunId);
    expect(adapted).not.toBeNull();
    expect(adapted?.schema_version).toBe(CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION);
    expect(adapted?.identity.run_id).toBe(legacyRunId);
    expect(adapted?.provenance.capture_method).toBe("legacy_adaptation");
  });

  it("handles Postgres persistence or skips gracefully when scratch Postgres is unavailable", async () => {
    if (!hasDatabaseUrl()) {
      console.info("SKIPPED: Postgres persistence integration test skipped because DATABASE_URL is not set.");
      expect(true).toBe(true);
      return;
    }

    // If DATABASE_URL is present, run live round-trip test
    const pgArtifact: RunArtifact = {
      schema_version: CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION,
      identity: {
        run_id: "run_pg_integration_001",
        project_id: "pg_test",
        project_name: "Postgres Test",
        workflow_id: "wf_pg",
        created_at: new Date().toISOString(),
      },
      execution: {
        status: "completed",
        started_at: new Date().toISOString(),
        summary: "Postgres integration test",
      },
      environment: {},
      trajectory: [],
      boundaries: [],
      external_calls: [],
      state: [],
      context: [],
      memory: { operations: [], references: [] },
      tools: [],
      retrieval: [],
      models: [],
      artifacts: [],
      evals: [],
      lineage: { mutations: [] },
      provenance: { capture_method: "sdk_trace", redaction_verified: true },
      safety: {
        approval_status: "not_required",
        approval_records: [],
        redaction_summary: { total_redactions: 0, secrets_detected: 0, fields_redacted: [] },
      },
      observability: {
        model_calls_count: 0,
        tool_calls_count: 0,
        evals_passed: 0,
        evals_failed: 0,
        trace_event_count: 0,
        context_snapshot_count: 0,
        memory_operations_count: 0,
        retrieval_operations_count: 0,
      },
      replay: {
        overall_replayability: "UNKNOWN",
        unsupported_boundaries_count: 0,
        side_effect_gated_count: 0,
        deterministic: false,
        sandboxed_available: false,
        missing_recordings: [],
        notes: [],
      },
    };

    const res = await saveCanonicalRun(pgArtifact);
    expect(res.success).toBe(true);

    const loaded = await getCanonicalRun("run_pg_integration_001");
    expect(loaded?.identity.run_id).toBe("run_pg_integration_001");
  });
});
