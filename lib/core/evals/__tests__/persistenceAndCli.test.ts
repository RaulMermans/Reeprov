import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  saveEvalDefinition,
  getEvalDefinition,
  listEvalDefinitions,
  saveEvalSuite,
  getEvalSuite,
  listEvalSuites,
  saveEvalDataset,
  getEvalDataset,
  listEvalDatasets,
  getEvalCase,
  saveEvaluationRun,
  getEvaluationRun,
  listEvaluationRuns,
  saveRunAsEvalCase,
} from "../persistence";
import {
  saveExperimentDefinition,
  getExperimentDefinition,
  listExperimentDefinitions,
  saveExperimentResult,
  getExperimentResult,
  listExperimentResults,
} from "../../experiment/persistence";
import { saveCanonicalRun } from "../../capture/persistence";
import { parseArgs, runCli } from "../../../../scripts/pulse-cli";
import type { EvalDefinition, EvalSuite, EvalDataset, EvalCase, EvaluationRun } from "../../contracts/evalDefinitions";
import type { ExperimentDefinition, ExperimentResult } from "../../contracts/experiment";
import type { RunArtifact } from "../../contracts/runArtifact";

describe("Sprint 8: Persistence & CLI Commands", () => {
  const testStoreDir = join(process.cwd(), ".agentpulse-test-persistence-cli");

  beforeEach(() => {
    process.env["AGENTPULSE_STORE_DIR"] = testStoreDir;
  });

  afterEach(() => {
    delete process.env["AGENTPULSE_STORE_DIR"];
    if (existsSync(testStoreDir)) {
      rmSync(testStoreDir, { recursive: true, force: true });
    }
  });

  describe("1. Eval Definitions, Suites, and Datasets Persistence", () => {
    it("persists and retrieves versioned EvalDefinition", async () => {
      const def: EvalDefinition = {
        eval_definition_id: "def_persist_test",
        name: "Persistence Test Eval",
        family: "schema_validity",
        version: 1,
        target_scope: "RUN",
        grader_type: "deterministic",
        severity: "fail",
        required: true,
        grader_config: { type: "SCHEMA_VALIDITY", required_keys: ["id"] },
        evidence_requirements: [],
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash_persist_def",
        status: "active",
      };

      await saveEvalDefinition(def);
      const retrieved = await getEvalDefinition("def_persist_test", 1);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.eval_definition_id).toBe("def_persist_test");
      expect(retrieved?.version).toBe(1);

      const list = await listEvalDefinitions();
      expect(list.some((d) => d.eval_definition_id === "def_persist_test")).toBe(true);
    });

    it("persists and retrieves versioned EvalSuite", async () => {
      const suite: EvalSuite = {
        suite_id: "suite_persist_test",
        name: "Persistence Test Suite",
        version: 1,
        definitions: [],
        required_eval_ids: [],
        optional_eval_ids: [],
        pass_policy: { mode: "ALL_REQUIRED_PASS" },
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash_persist_suite",
      };

      await saveEvalSuite(suite);
      const retrieved = await getEvalSuite("suite_persist_test", 1);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.suite_id).toBe("suite_persist_test");

      const list = await listEvalSuites();
      expect(list.some((s) => s.suite_id === "suite_persist_test")).toBe(true);
    });

    it("persists and retrieves EvalDataset and individual EvalCases", async () => {
      const caseItem: EvalCase = {
        case_id: "case_001",
        name: "Test Case 1",
        input: { query: "hello" },
        expected: { reply: "world" },
        artifact_refs: [],
        tags: ["smoke"],
      };

      const dataset: EvalDataset = {
        dataset_id: "ds_persist_test",
        name: "Test Dataset",
        version: 1,
        cases: [caseItem],
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash_ds",
      };

      await saveEvalDataset(dataset);
      const retrievedDs = await getEvalDataset("ds_persist_test", 1);
      expect(retrievedDs).not.toBeNull();
      expect(retrievedDs?.cases.length).toBe(1);

      const retrievedCase = await getEvalCase("ds_persist_test", "case_001", 1);
      expect(retrievedCase).not.toBeNull();
      expect(retrievedCase?.name).toBe("Test Case 1");
    });
  });

  describe("2. Historical Run to Curated EvalCase (saveRunAsEvalCase)", () => {
    it("creates a curated EvalCase from a recorded RunArtifact and appends to dataset", async () => {
      const artifact: RunArtifact = {
        schema_version: "1.0.0-alpha",
        identity: {
          run_id: "run_prod_failure_101",
          project_id: "proj_checkout",
          workflow_id: "wf_payment",
          created_at: "2026-10-12T00:00:00Z",
        },
        execution: {
          status: "failed",
          started_at: "2026-10-12T00:00:00Z",
          completed_at: "2026-10-12T00:00:01Z",
          duration_ms: 1000,
          summary: "Stripe token expired during processing",
        },
        environment: {},
        trajectory: [
          {
            step_id: "step_0",
            step_index: 0,
            step_type: "node",
            name: "Initiate Checkout",
            started_at: "2026-10-12T00:00:00Z",
            completed_at: "2026-10-12T00:00:00.500Z",
            status: "completed",
            input_summary: "Customer purchase request for item SKU_99",
            boundary_ids: [],
            tool_invocation_ids: [],
            model_invocation_ids: [],
            memory_operation_ids: [],
            retrieval_operation_ids: [],
            eval_result_ids: [],
            artifact_ids: [],
          },
        ],
        boundaries: [],
        external_calls: [],
        state: [],
        checkpoints: [{ checkpoint_id: "chk_pre_pay", step_id: "step_0", state_snapshot_id: "snap_0", timestamp: "2026-10-12T00:00:00Z" }],
        context: [],
        memory: { operations: [], references: [] },
        tools: [],
        retrieval: [],
        models: [],
        artifacts: [{ artifact_id: "art_error_log", type: "log", uri: "logs/error.txt" }],
        evals: [],
        lineage: { mutations: [] },
        provenance: { capture_method: "sdk_trace", adapter_version: "1.0.0", captured_by: "Test", redaction_verified: true },
        safety: { approval_status: "not_required", approval_records: [], redaction_summary: { total_redactions: 0, secrets_detected: 0, fields_redacted: [] } },
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
        evidence: {
          verification_events: [],
          test_results: [],
          review_results: [],
          approval_events: [],
          security_events: [],
          final_outcome: {
            status: "FAILED",
            verification_status: "FAIL",
            payload: { error_code: "EXPIRED_TOKEN" },
            completed_at: "2026-10-12T00:00:01Z",
          },
        },
      };

      await saveCanonicalRun(artifact);

      const curatedCase = await saveRunAsEvalCase("run_prod_failure_101", {
        datasetId: "ds_payment_regressions",
        datasetVersion: 1,
        caseName: "Expired Stripe Token Failure Regression",
        checkpointId: "chk_pre_pay",
        tags: ["payment", "token_expiry"],
      });

      expect(curatedCase.case_id).toBeDefined();
      expect(curatedCase.name).toBe("Expired Stripe Token Failure Regression");
      expect(curatedCase.source_run_id).toBe("run_prod_failure_101");
      expect(curatedCase.source_checkpoint_id).toBe("chk_pre_pay");
      expect(curatedCase.tags).toContain("token_expiry");
      expect(curatedCase.artifact_refs).toContain("logs/error.txt");

      const ds = await getEvalDataset("ds_payment_regressions", 1);
      expect(ds).not.toBeNull();
      expect(ds?.cases.some((c) => c.source_run_id === "run_prod_failure_101")).toBe(true);
    });
  });

  describe("3. Experiment Persistence", () => {
    it("persists and lists ExperimentDefinition and ExperimentResult", async () => {
      const expDef: ExperimentDefinition = {
        experiment_id: "exp_persist_001",
        name: "Persistence Experiment",
        version: 1,
        baseline_run_id: "run_base",
        variables: [],
        arms: [],
        eval_suite_id: "suite_1",
        repetitions: 1,
        budget: { max_cost_usd: 1.0, max_trials: 5, max_model_calls: 10, max_duration_ms: 10000 },
        winner_policy: {
          optimization_criterion: "QUALITY_FIRST",
          min_pass_rate: 0.8,
          required_eval_ids: [],
          critical_eval_ids: [],
          required_non_regression_eval_ids: [],
          weights: { quality: 0.6, cost: 0.2, latency: 0.2 },
        },
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash_exp_def",
        status: "DRAFT",
      };

      await saveExperimentDefinition(expDef);
      const retrievedDef = await getExperimentDefinition("exp_persist_001");
      expect(retrievedDef?.experiment_id).toBe("exp_persist_001");

      const expRes: ExperimentResult = {
        experiment_id: "exp_persist_001",
        status: "COMPLETED",
        baseline_arm_id: "arm_base",
        arms: [],
        trial_summaries: [],
        aggregates: [],
        eval_summary: { eval_suite_id: "suite_1", eval_suite_version: 1, total_trials: 0 },
        comparison_refs: [],
        budget_consumed: { cost_usd: 0, candidate_cost_usd: 0, grader_cost_usd: 0, trials_executed: 0, duration_ms: 0 },
        candidate_ranking: [],
        recommendation_basis: "All passed",
        limitations: [],
        created_at: "2026-10-12T00:00:00Z",
        completed_at: "2026-10-12T00:00:01Z",
      };

      await saveExperimentResult(expRes);
      const retrievedRes = await getExperimentResult("exp_persist_001");
      expect(retrievedRes?.status).toBe("COMPLETED");

      const listRes = await listExperimentResults();
      expect(listRes.some((r) => r.experiment_id === "exp_persist_001")).toBe(true);
    });
  });

  describe("4. CLI Command Parsing and Dispatch", () => {
    it("parses pulse eval list and pulse eval run args", () => {
      const listOpts = parseArgs(["eval", "list", "--json"]);
      expect(listOpts).toEqual({ command: "eval-list", json: true });

      const runOpts = parseArgs(["eval", "run", "run_101", "--suite", "suite_support", "--json"]);
      expect(runOpts).toEqual({
        command: "eval-run",
        runIdOrPath: "run_101",
        suiteIdOrPath: "suite_support",
        json: true,
      });
    });

    it("parses pulse dataset list args", () => {
      const dsOpts = parseArgs(["dataset", "list"]);
      expect(dsOpts).toEqual({ command: "dataset-list", json: false });
    });

    it("parses pulse experiment subcommands (plan, run, show)", () => {
      const planOpts = parseArgs(["experiment", "plan", "exp_def_01"]);
      expect(planOpts).toEqual({ command: "experiment-plan", definitionPathOrId: "exp_def_01", json: false });

      const showOpts = parseArgs(["experiment", "show", "exp_res_01", "--json"]);
      expect(showOpts).toEqual({ command: "experiment-show", experimentId: "exp_res_01", json: true });
    });

    it("executes pulse eval list CLI command cleanly", async () => {
      const exitCode = await runCli(["eval", "list", "--json"]);
      expect(exitCode).toBe(0);
    });

    it("executes pulse dataset list CLI command cleanly", async () => {
      const exitCode = await runCli(["dataset", "list", "--json"]);
      expect(exitCode).toBe(0);
    });
  });
});
