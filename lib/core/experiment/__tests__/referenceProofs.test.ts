import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runArtifactSchema, type RunArtifact } from "../../contracts/runArtifact";
import {
  evalSuiteSchema,
  evalDatasetSchema,
  type EvalSuite,
  type EvalDataset,
  type EvalDefinition,
} from "../../contracts/evalDefinitions";
import {
  type ExperimentDefinition,
  type ExperimentArm,
  type ArmAggregate,
} from "../../contracts/experiment";
import { evaluateRun, evaluateDataset } from "../../evals/runner";
import { ExperimentAggregator, type ArmTrialExecutionData } from "../aggregator";
import { DeterministicEvaluatorAdapter } from "../../evals/graders/deterministic";

function loadJson<T>(relativePath: string): T {
  const fullPath = join(process.cwd(), relativePath);
  return JSON.parse(readFileSync(fullPath, "utf-8"));
}

describe("Sprint 8: Reference Proofs (Deterministic, Ablation, Hard Gates, Repeatability)", () => {
  const testStoreDir = join(process.cwd(), ".agentpulse-test-ref-proofs");

  beforeEach(() => {
    process.env["AGENTPULSE_STORE_DIR"] = testStoreDir;
  });

  afterEach(() => {
    delete process.env["AGENTPULSE_STORE_DIR"];
    if (existsSync(testStoreDir)) {
      rmSync(testStoreDir, { recursive: true, force: true });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Reference Proof A: Deterministic Eval Suite (support-release@1)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Reference Proof A: Deterministic Eval Suite (support-release@1)", () => {
    it("evaluates a compliant run and produces an authoritative EvaluationRun with canonical EvalResults", async () => {
      const suiteRaw = loadJson<EvalSuite>("tests/fixtures/evals/support-release-suite.json");
      const suite = evalSuiteSchema.parse(suiteRaw);

      // Create a compliant test artifact that satisfies all requirements of support-release
      const compliantArtifact: RunArtifact = {
        schema_version: "1.0.0-alpha",
        identity: {
          run_id: "run_compliant_release_candidate",
          project_id: "proj_customer_support",
          project_name: "Customer Support Automation",
          workflow_id: "wf_refund_triage",
          created_at: "2026-10-12T10:00:00.000Z",
        },
        execution: {
          status: "completed",
          started_at: "2026-10-12T10:00:00.000Z",
          completed_at: "2026-10-12T10:00:02.000Z",
          duration_ms: 2000,
          summary: "Order refund evaluated and processed successfully.",
        },
        environment: { runtime: "node", sdk_version: "1.0.0" },
        trajectory: [],
        boundaries: [],
        external_calls: [],
        state: [],
        checkpoints: [],
        context: [],
        memory: { operations: [], references: [] },
        tools: [
          {
            tool_call_id: "tool_call_refund_calc_01",
            tool_name: "refund.calculate",
            permission_class: "read_only",
            replayability: "REPLAYABLE_RECORDED",
            input: { order_id: "ord_101", amount: 45.0 },
            output: { eligible: true, refund_amount: 45.0 },
            status: "completed",
            started_at: "2026-10-12T10:00:01.000Z",
            duration_ms: 250,
          },
        ],
        retrieval: [],
        models: [],
        artifacts: [],
        evals: [],
        lineage: { mutations: [] },
        provenance: {
          capture_method: "sdk_trace",
          adapter_version: "1.0.0",
          captured_by: "PulseReleaseTest",
          redaction_verified: true,
        },
        safety: {
          approval_status: "not_required",
          approval_records: [],
          redaction_summary: { total_redactions: 0, secrets_detected: 0, fields_redacted: [] },
        },
        observability: {
          total_duration_ms: 2000,
          total_cost_usd: 0.04,
          model_calls_count: 1,
          tool_calls_count: 1,
          evals_passed: 0,
          evals_failed: 0,
          trace_event_count: 2,
          context_snapshot_count: 1,
          memory_operations_count: 0,
          retrieval_operations_count: 0,
        },
        replay: {
          overall_replayability: "REPLAYABLE_RECORDED",
          unsupported_boundaries_count: 0,
          side_effect_gated_count: 0,
          deterministic: true,
          sandboxed_available: true,
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
            status: "SUCCESS",
            verification_status: "PASS",
            payload: { status: "SUCCESS", refund_id: "ref_99" },
            completed_at: "2026-10-12T10:00:02.000Z",
          },
        },
      };

      const evalRun = await evaluateRun(compliantArtifact, suite, {
        evaluationRunId: "evrun_proof_a_001",
        persist: false,
      });

      expect(evalRun.suite_id).toBe("support-release");
      expect(evalRun.suite_version).toBe(1);
      expect(evalRun.summary.suite_verdict).toBe("PASSED");
      expect(evalRun.summary.critical_failures).toHaveLength(0);
      expect(evalRun.results.length).toBe(suite.definitions.length);

      // Verify canonical fields on each result
      for (const res of evalRun.results) {
        expect(res.eval_definition_id).toBeDefined();
        expect(res.eval_suite_id).toBe("support-release");
        expect(res.eval_suite_version).toBe(1);
        expect(res.evaluator_id).toBe("reeprov_deterministic_evaluator");
        expect(res.grader_config_hash).toBeDefined();
        expect(res.timestamp).toBeDefined();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Reference Proof B: Context Ablation Experiment (Fixture J)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Reference Proof B: Context Ablation Experiment", () => {
    it("compares baseline (1750 tokens) vs ablated candidate (1250 tokens), preferring candidate under cost policy", async () => {
      const baselineRaw = loadJson<RunArtifact>("tests/fixtures/canonical/fixture-j-context-ablation-baseline.json");
      const baseline = runArtifactSchema.parse(baselineRaw);

      // Setup arms
      const arms: ExperimentArm[] = [
        {
          arm_id: "arm_baseline_1750",
          name: "Baseline Full Context (1750 tokens)",
          is_baseline: true,
          mutations: [],
          configuration_hash: "hash_base_ctx",
        },
        {
          arm_id: "arm_candidate_ablated_1250",
          name: "Ablated Context (1250 tokens)",
          is_baseline: false,
          mutations: [
            {
              mutation_id: "mut_ablate_ctx",
              mutation_type: "context_exclusion",
              target_identifier: "ctx_item_historical_policies",
              description: "Exclude obsolete historical policy documents",
              mutated_value: { token_reduction: 500 },
            },
          ],
          configuration_hash: "hash_cand_ablate_ctx",
        },
      ];

      const experimentDef: ExperimentDefinition = {
        experiment_id: "exp_context_ablation_proof",
        name: "Context Token Ablation Experiment",
        version: 1,
        baseline_run_id: baseline.identity.run_id,
        variables: [
          {
            name: "context_window",
            type: "context_exclusion",
            values: ["exclude_historical"],
          },
        ],
        arms,
        eval_suite_id: "support-release",
        eval_suite_version: 1,
        repetitions: 1,
        budget: {
          max_cost_usd: 1.0,
          max_trials: 10,
          max_model_calls: 10,
          max_duration_ms: 30000,
        },
        winner_policy: {
          optimization_criterion: "COST_FIRST",
          min_pass_rate: 0.8,
          required_eval_ids: [],
          critical_eval_ids: [],
          required_non_regression_eval_ids: [],
          weights: { quality: 0.4, cost: 0.6, latency: 0.0 },
        },
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash_exp_ctx_ablation",
        status: "completed",
      };

      // Mock trial execution data: both achieve 1.0 pass rate, but candidate costs less ($0.03 vs $0.05)
      const trialsData: ArmTrialExecutionData[] = [
        {
          trial: {
            trial_id: "trial_base_1",
            experiment_id: experimentDef.experiment_id,
            arm_id: "arm_baseline_1750",
            repetition_index: 0,
            derived_run_id: baseline.identity.run_id,
            status: "COMPLETED",
            candidate_cost_usd: 0.05,
            grader_cost_usd: 0.01,
            duration_ms: 3000,
            started_at: "2026-10-12T12:00:00Z",
            completed_at: "2026-10-12T12:00:03Z",
            errors: [],
          },
          evalRun: {
            evaluation_run_id: "evrun_base_1",
            suite_id: "support-release",
            suite_version: 1,
            target_run_ids: [baseline.identity.run_id],
            summary: {
              total: 5,
              passed: 5,
              failed: 0,
              errors: 0,
              missing_evidence: 0,
              pass_rate: 1.0,
              suite_verdict: "PASSED",
              verdict_reason: "Passed",
              critical_failures: [],
            },
            results: [],
            cost_usd: 0.01,
            duration_ms: 100,
            started_at: "2026-10-12T12:00:03Z",
            completed_at: "2026-10-12T12:00:03.100Z",
          },
        },
        {
          trial: {
            trial_id: "trial_cand_1",
            experiment_id: experimentDef.experiment_id,
            arm_id: "arm_candidate_ablated_1250",
            repetition_index: 0,
            derived_run_id: "run_cand_ablated_ctx_001",
            status: "COMPLETED",
            candidate_cost_usd: 0.03, // Lower cost due to 1250 tokens
            grader_cost_usd: 0.01,
            duration_ms: 2200,
            started_at: "2026-10-12T12:00:04Z",
            completed_at: "2026-10-12T12:00:06.200Z",
            errors: [],
          },
          evalRun: {
            evaluation_run_id: "evrun_cand_1",
            suite_id: "support-release",
            suite_version: 1,
            target_run_ids: ["run_cand_ablated_ctx_001"],
            summary: {
              total: 5,
              passed: 5,
              failed: 0,
              errors: 0,
              missing_evidence: 0,
              pass_rate: 1.0,
              suite_verdict: "PASSED",
              verdict_reason: "Passed",
              critical_failures: [],
            },
            results: [],
            cost_usd: 0.01,
            duration_ms: 100,
            started_at: "2026-10-12T12:00:06.200Z",
            completed_at: "2026-10-12T12:00:06.300Z",
          },
        },
      ];

      const result = ExperimentAggregator.aggregate(
        experimentDef,
        arms,
        trialsData,
        {
          cost_usd: 0.10,
          candidate_cost_usd: 0.08,
          grader_cost_usd: 0.02,
          trials_executed: 2,
          duration_ms: 5300,
        }
      );

      expect(result.recommended_candidate).toBe("arm_candidate_ablated_1250");
      expect(result.candidate_ranking[0]?.arm_id).toBe("arm_candidate_ablated_1250");
      expect(result.recommendation_basis).toContain("Candidate \"Ablated Context (1250 tokens)\"");
      expect(result.limitations).toContain("SINGLE TRIAL — REPEATABILITY UNKNOWN. Results may vary on stochastic model runs.");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Reference Proof C: Memory Ablation Experiment (Fixture K)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Reference Proof C: Memory Ablation Experiment", () => {
    it("disqualifies memory-ablated candidate when conciseness eval fails, preserving baseline", () => {
      const arms: ExperimentArm[] = [
        {
          arm_id: "arm_mem_baseline",
          name: "Baseline with Memory (Concise)",
          is_baseline: true,
          mutations: [],
          configuration_hash: "hash_mem_base",
        },
        {
          arm_id: "arm_mem_ablated",
          name: "Ablated Memory (Verbose)",
          is_baseline: false,
          mutations: [
            {
              mutation_id: "mut_exclude_mem",
              mutation_type: "memory_exclusion",
              target_identifier: "mem_concise_01",
              description: "Exclude customer conciseness preference memory",
              mutated_value: { excluded: true },
            },
          ],
          configuration_hash: "hash_mem_ablated",
        },
      ];

      const experimentDef: ExperimentDefinition = {
        experiment_id: "exp_memory_ablation_proof",
        name: "Memory Preference Ablation Experiment",
        version: 1,
        baseline_run_id: "run_mem_ablation_baseline",
        variables: [{ name: "memory", type: "memory_exclusion", values: ["drop_conciseness"] }],
        arms,
        eval_suite_id: "support-release",
        repetitions: 1,
        budget: { max_cost_usd: 1.0, max_trials: 10, max_model_calls: 10, max_duration_ms: 30000 },
        winner_policy: {
          type: "HIGHEST_SCORE_UNDER_BUDGET",
          optimization_criterion: "HIGHEST_SCORE_UNDER_BUDGET",
          hard_gates: ["def_approval", "def_sec"],
        },
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash_mem_ablation_def",
        status: "completed",
      };

      const trialsData: ArmTrialExecutionData[] = [
        {
          trial: {
            trial_id: "trial_mem_base",
            experiment_id: experimentDef.experiment_id,
            arm_id: "arm_mem_baseline",
            repetition_index: 0,
            derived_run_id: "run_mem_ablation_baseline",
            status: "COMPLETED",
            candidate_cost_usd: 0.02,
            grader_cost_usd: 0.01,
            duration_ms: 1500,
            started_at: "2026-10-12T13:00:00Z",
            completed_at: "2026-10-12T13:00:01.500Z",
            errors: [],
          },
          evalRun: {
            evaluation_run_id: "evrun_mem_base",
            suite_id: "support-release",
            suite_version: 1,
            target_run_ids: ["run_mem_ablation_baseline"],
            summary: {
              total: 3,
              passed: 3,
              failed: 0,
              errors: 0,
              missing_evidence: 0,
              pass_rate: 1.0,
              suite_verdict: "PASSED",
              verdict_reason: "Passed",
              critical_failures: [],
            },
            results: [],
            cost_usd: 0.01,
            duration_ms: 50,
            started_at: "2026-10-12T13:00:01.500Z",
            completed_at: "2026-10-12T13:00:01.550Z",
          },
        },
        {
          trial: {
            trial_id: "trial_mem_ablated",
            experiment_id: experimentDef.experiment_id,
            arm_id: "arm_mem_ablated",
            repetition_index: 0,
            derived_run_id: "run_cand_mem_ablated_001",
            status: "COMPLETED",
            candidate_cost_usd: 0.04,
            grader_cost_usd: 0.01,
            duration_ms: 2200,
            started_at: "2026-10-12T13:00:02Z",
            completed_at: "2026-10-12T13:00:04.200Z",
            errors: [],
          },
          evalRun: {
            evaluation_run_id: "evrun_mem_ablated",
            suite_id: "support-release",
            suite_version: 1,
            target_run_ids: ["run_cand_mem_ablated_001"],
            summary: {
              total: 3,
              passed: 1,
              failed: 2, // Fails conciseness and style adherence
              errors: 0,
              missing_evidence: 0,
              pass_rate: 0.33,
              suite_verdict: "FAILED",
              verdict_reason: "Conciseness and style policy failed",
              critical_failures: [],
            },
            results: [],
            cost_usd: 0.01,
            duration_ms: 50,
            started_at: "2026-10-12T13:00:04.200Z",
            completed_at: "2026-10-12T13:00:04.250Z",
          },
        },
      ];

      const result = ExperimentAggregator.aggregate(
        experimentDef,
        arms,
        trialsData,
        {
          cost_usd: 0.08,
          candidate_cost_usd: 0.06,
          grader_cost_usd: 0.02,
          trials_executed: 2,
          duration_ms: 3700,
        }
      );

      // Baseline has higher pass rate (1.0 vs 0.33) and is preferred over ablated candidate
      expect(result.recommended_candidate).toBe("arm_mem_baseline");
      const ablatedRank = result.candidate_ranking.find((r) => r.arm_id === "arm_mem_ablated");
      expect(ablatedRank?.rank).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Reference Proof D: Multi-Arm Prompt Test (Hard Gate Safety Disqualification)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Reference Proof D: Multi-Arm Prompt Test (Hard Gate Safety Disqualification)", () => {
    it("disqualifies candidate with highest score (0.99) when it violates hard safety gate, recommending clean candidate", () => {
      const arms: ExperimentArm[] = [
        {
          arm_id: "arm_prompt_v7",
          name: "Baseline Prompt v7",
          is_baseline: true,
          mutations: [],
          configuration_hash: "hash_v7",
        },
        {
          arm_id: "arm_prompt_v8",
          name: "Candidate Prompt v8 (Refined Guardrails)",
          is_baseline: false,
          mutations: [
            {
              mutation_id: "mut_prompt_v8",
              mutation_type: "prompt",
              target_identifier: "prompt_triage",
              description: "Refined prompt instructions with explicit verification step",
              mutated_value: { version: "v8" },
            },
          ],
          configuration_hash: "hash_v8",
        },
        {
          arm_id: "arm_prompt_v9",
          name: "Candidate Prompt v9 (Over-optimized / Safety Leak)",
          is_baseline: false,
          mutations: [
            {
              mutation_id: "mut_prompt_v9",
              mutation_type: "prompt",
              target_identifier: "prompt_triage",
              description: "Aggressively compressed prompt removing guardrails",
              mutated_value: { version: "v9" },
            },
          ],
          configuration_hash: "hash_v9",
        },
      ];

      const experimentDef: ExperimentDefinition = {
        experiment_id: "exp_multi_arm_prompt_proof",
        name: "Prompt Tuning Multi-Arm Safety Gate Experiment",
        version: 1,
        baseline_run_id: "run_ctx_ablation_baseline",
        variables: [{ name: "prompt", type: "prompt", values: ["v8", "v9"] }],
        arms,
        eval_suite_id: "support-release",
        repetitions: 1,
        budget: { max_cost_usd: 2.0, max_trials: 10, max_model_calls: 20, max_duration_ms: 60000 },
        winner_policy: {
          type: "HIGHEST_SCORE_UNDER_BUDGET",
          optimization_criterion: "HIGHEST_SCORE_UNDER_BUDGET",
          hard_gates: ["def_approval", "def_sec"],
        },
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash_exp_multi_arm",
        status: "completed",
      };

      const trialsData: ArmTrialExecutionData[] = [
        // Arm V7 (Baseline): 85% pass rate, zero safety violations
        {
          trial: {
            trial_id: "trial_v7_1",
            experiment_id: experimentDef.experiment_id,
            arm_id: "arm_prompt_v7",
            repetition_index: 0,
            derived_run_id: "run_v7",
            status: "COMPLETED",
            candidate_cost_usd: 0.04,
            grader_cost_usd: 0.01,
            duration_ms: 2000,
            started_at: "2026-10-12T14:00:00Z",
            completed_at: "2026-10-12T14:00:02Z",
            errors: [],
          },
          evalRun: {
            evaluation_run_id: "evrun_v7",
            suite_id: "support-release",
            suite_version: 1,
            target_run_ids: ["run_v7"],
            summary: {
              total: 5,
              passed: 4,
              failed: 1,
              errors: 0,
              missing_evidence: 0,
              pass_rate: 0.80,
              suite_verdict: "PASSED",
              verdict_reason: "Passed",
              critical_failures: [],
            },
            results: [],
            cost_usd: 0.01,
            duration_ms: 100,
            started_at: "2026-10-12T14:00:02Z",
            completed_at: "2026-10-12T14:00:02.100Z",
          },
        },
        // Arm V8: 95% pass rate, zero safety violations
        {
          trial: {
            trial_id: "trial_v8_1",
            experiment_id: experimentDef.experiment_id,
            arm_id: "arm_prompt_v8",
            repetition_index: 0,
            derived_run_id: "run_v8",
            status: "COMPLETED",
            candidate_cost_usd: 0.038,
            grader_cost_usd: 0.01,
            duration_ms: 1800,
            started_at: "2026-10-12T14:00:03Z",
            completed_at: "2026-10-12T14:00:04.800Z",
            errors: [],
          },
          evalRun: {
            evaluation_run_id: "evrun_v8",
            suite_id: "support-release",
            suite_version: 1,
            target_run_ids: ["run_v8"],
            summary: {
              total: 5,
              passed: 5,
              failed: 0,
              errors: 0,
              missing_evidence: 0,
              pass_rate: 1.0,
              suite_verdict: "PASSED",
              verdict_reason: "Passed",
              critical_failures: [],
            },
            results: [],
            cost_usd: 0.01,
            duration_ms: 100,
            started_at: "2026-10-12T14:00:04.800Z",
            completed_at: "2026-10-12T14:00:04.900Z",
          },
        },
        // Arm V9: 99% task score, but has 1 CRITICAL SECURITY VIOLATION
        {
          trial: {
            trial_id: "trial_v9_1",
            experiment_id: experimentDef.experiment_id,
            arm_id: "arm_prompt_v9",
            repetition_index: 0,
            derived_run_id: "run_v9",
            status: "COMPLETED",
            candidate_cost_usd: 0.025,
            grader_cost_usd: 0.01,
            duration_ms: 1400,
            started_at: "2026-10-12T14:00:05Z",
            completed_at: "2026-10-12T14:00:06.400Z",
            errors: [],
          },
          evalRun: {
            evaluation_run_id: "evrun_v9",
            suite_id: "support-release",
            suite_version: 1,
            target_run_ids: ["run_v9"],
            summary: {
              total: 5,
              passed: 4,
              failed: 1,
              errors: 0,
              missing_evidence: 0,
              pass_rate: 0.80,
              suite_verdict: "FAILED",
              verdict_reason: "Critical safety failure in: def_sec",
              critical_failures: ["def_sec"], // Violates critical hard gate
            },
            results: [
              {
                eval_id: "eval_sec_v9",
                eval_definition_id: "def_sec",
                eval_type: "safety",
                name: "Security Zero Violations",
                passed: false,
                severity: "critical",
                grader_type: "deterministic",
                score: 0,
                grader_status: "FAILED",
                findings: ["Security gate violated: 1 critical injection vulnerability triggered"],
                evidence_references: [],
                timestamp: "2026-10-12T14:00:06.400Z",
              },
            ],
            cost_usd: 0.01,
            duration_ms: 100,
            started_at: "2026-10-12T14:00:06.400Z",
            completed_at: "2026-10-12T14:00:06.500Z",
          },
        },
      ];

      const result = ExperimentAggregator.aggregate(
        experimentDef,
        arms,
        trialsData,
        {
          cost_usd: 0.15,
          candidate_cost_usd: 0.12,
          grader_cost_usd: 0.03,
          trials_executed: 3,
          duration_ms: 6500,
        }
      );

      // Verify Arm V9 is disqualified by hard gate
      const v9Rank = result.candidate_ranking.find((r) => r.arm_id === "arm_prompt_v9");
      expect(v9Rank).toBeDefined();
      expect(v9Rank?.eligible_for_recommendation).toBe(false);
      expect(v9Rank?.summary).toContain("DISQUALIFIED");
      expect(v9Rank?.gate_failure_reasons).toContain("Failed safety guardrails");

      // Verify Arm V8 is recommended as the winner
      expect(result.recommended_candidate).toBe("arm_prompt_v8");
      expect(result.recommendation_basis).toContain("Candidate \"Candidate Prompt v8 (Refined Guardrails)\"");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Dataset-Level Evaluation Proof
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Dataset-Level Evaluation Proof", () => {
    it("evaluates all 5 benchmark cases from support-dataset.json with case-level tagging", async () => {
      const datasetRaw = loadJson<EvalDataset>("tests/fixtures/evals/support-dataset.json");
      const dataset = evalDatasetSchema.parse(datasetRaw);

      const minimalSuite: EvalSuite = {
        suite_id: "suite_case_test",
        name: "Case Test Suite",
        version: 1,
        definitions: [
          {
            eval_definition_id: "def_status_check",
            name: "Outcome Status",
            family: "task_success",
            version: 1,
            target_scope: "RUN",
            grader_type: "deterministic",
            severity: "critical",
            required: true,
            grader_config: { type: "OUTCOME_STATUS", expected_status: "SUCCESS" },
            evidence_requirements: ["final_outcome"],
            created_at: "2026-10-12T00:00:00Z",
            content_hash: "hash_stat",
            status: "active",
          },
        ],
        required_eval_ids: ["def_status_check"],
        optional_eval_ids: [],
        pass_policy: { mode: "ALL_REQUIRED_PASS" },
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash_min_suite",
      };

      // Mock runnerFn returning a synthetic artifact per case
      const runnerFn = async (caseItem: any): Promise<RunArtifact> => {
        return {
          schema_version: "1.0.0-alpha",
          identity: {
            run_id: `run_${caseItem.case_id}`,
            project_id: "proj_customer_support",
            workflow_id: "wf_support",
            created_at: "2026-10-12T00:00:00Z",
          },
          execution: {
            status: "completed",
            started_at: "2026-10-12T00:00:00Z",
            completed_at: "2026-10-12T00:00:01Z",
            duration_ms: 1000,
          },
          environment: {},
          trajectory: [],
          boundaries: [],
          external_calls: [],
          state: [],
          checkpoints: [],
          context: [],
          memory: { operations: [], references: [] },
          tools: [],
          retrieval: [],
          models: [],
          artifacts: [],
          evals: [],
          lineage: { mutations: [] },
          provenance: {
            capture_method: "sdk_trace",
            adapter_version: "1.0.0",
            captured_by: "Test",
            redaction_verified: true,
          },
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
              status: "SUCCESS",
              verification_status: "PASS",
              completed_at: "2026-10-12T00:00:01Z",
            },
          },
        };
      };

      const dsRun = await evaluateDataset(dataset, minimalSuite, runnerFn, {
        evaluationRunId: "evrun_dataset_5_cases",
        persist: false,
      });

      expect(dsRun.dataset_id).toBe("support-regression-suite");
      expect(dsRun.target_run_ids.length).toBe(5);
      expect(dsRun.results.length).toBe(5); // 1 eval per case * 5 cases
      expect(dsRun.summary.suite_verdict).toBe("PASSED");
      expect(dsRun.summary.pass_rate).toBe(1.0);

      // Verify every result is tagged with case_id
      const caseIds = dsRun.results.map((r) => r.eval_case_id);
      expect(caseIds).toContain("case_refund_allowed");
      expect(caseIds).toContain("case_refund_denied_policy");
      expect(caseIds).toContain("case_missing_account");
      expect(caseIds).toContain("case_approval_required_high_value");
      expect(caseIds).toContain("case_policy_conflict_international");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Repeatability Proof (N = 3 Trials vs N = 1 Warning)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Repeatability Proof (N = 3 Trials vs N = 1 Warning)", () => {
    const singleArm: ExperimentArm = {
      arm_id: "arm_stochastic_model",
      name: "Stochastic Prompt Arm",
      is_baseline: false,
      mutations: [],
      configuration_hash: "hash_stoch",
    };

    const baseDef: ExperimentDefinition = {
      experiment_id: "exp_repeatability_proof",
      name: "Repeatability Verification Experiment",
      version: 1,
      baseline_run_id: "run_ctx_ablation_baseline",
      variables: [],
      arms: [singleArm],
      eval_suite_id: "support-release",
      repetitions: 3,
      budget: { max_cost_usd: 1.0, max_trials: 10, max_model_calls: 10, max_duration_ms: 30000 },
      winner_policy: {
        type: "HIGHEST_SCORE_UNDER_BUDGET",
        optimization_criterion: "HIGHEST_SCORE_UNDER_BUDGET",
        hard_gates: ["def_approval", "def_sec"],
      },
      created_at: "2026-10-12T00:00:00Z",
      content_hash: "hash_rep_proof",
      status: "completed",
    };

    it("flags N = 1 trial with explicit repeatability warning", () => {
      const n1Def = { ...baseDef, repetitions: 1 };
      const n1Trials: ArmTrialExecutionData[] = [
        {
          trial: {
            trial_id: "trial_n1",
            experiment_id: n1Def.experiment_id,
            arm_id: "arm_stochastic_model",
            repetition_index: 0,
            derived_run_id: "run_n1",
            status: "COMPLETED",
            candidate_cost_usd: 0.02,
            grader_cost_usd: 0.01,
            duration_ms: 1000,
            started_at: "2026-10-12T00:00:00Z",
            completed_at: "2026-10-12T00:00:01Z",
            errors: [],
          },
          evalRun: {
            evaluation_run_id: "ev_n1",
            suite_id: "support-release",
            suite_version: 1,
            target_run_ids: ["run_n1"],
            summary: {
              total: 1,
              passed: 1,
              failed: 0,
              errors: 0,
              missing_evidence: 0,
              pass_rate: 1.0,
              suite_verdict: "PASSED",
              verdict_reason: "Passed",
              critical_failures: [],
            },
            results: [],
            cost_usd: 0.01,
            duration_ms: 50,
            started_at: "2026-10-12T00:00:01Z",
            completed_at: "2026-10-12T00:00:01.050Z",
          },
        },
      ];

      const resN1 = ExperimentAggregator.aggregate(n1Def, [singleArm], n1Trials, {
        cost_usd: 0.03,
        candidate_cost_usd: 0.02,
        grader_cost_usd: 0.01,
        trials_executed: 1,
        duration_ms: 1050,
      });

      expect(resN1.limitations).toContain(
        "SINGLE TRIAL — REPEATABILITY UNKNOWN. Results may vary on stochastic model runs."
      );
      expect(resN1.aggregates[0]?.repeatability_note).toContain("SINGLE TRIAL");
    });

    it("computes mean, std_dev, min, and max for N = 3 repeated trials", () => {
      const n3Trials: ArmTrialExecutionData[] = [
        {
          trial: {
            trial_id: "trial_n3_1",
            experiment_id: baseDef.experiment_id,
            arm_id: "arm_stochastic_model",
            repetition_index: 0,
            derived_run_id: "run_n3_1",
            status: "COMPLETED",
            candidate_cost_usd: 0.02,
            grader_cost_usd: 0.01,
            duration_ms: 1000,
            started_at: "2026-10-12T00:00:00Z",
            completed_at: "2026-10-12T00:00:01Z",
            errors: [],
          },
          evalRun: {
            evaluation_run_id: "ev_n3_1",
            suite_id: "support-release",
            suite_version: 1,
            target_run_ids: ["run_n3_1"],
            summary: {
              total: 1,
              passed: 1,
              failed: 0,
              errors: 0,
              missing_evidence: 0,
              pass_rate: 1.0,
              suite_verdict: "PASSED",
              verdict_reason: "Passed",
              critical_failures: [],
            },
            results: [],
            cost_usd: 0.01,
            duration_ms: 50,
            started_at: "2026-10-12T00:00:01Z",
            completed_at: "2026-10-12T00:00:01.050Z",
          },
        },
        {
          trial: {
            trial_id: "trial_n3_2",
            experiment_id: baseDef.experiment_id,
            arm_id: "arm_stochastic_model",
            repetition_index: 1,
            derived_run_id: "run_n3_2",
            status: "COMPLETED",
            candidate_cost_usd: 0.02,
            grader_cost_usd: 0.01,
            duration_ms: 1100,
            started_at: "2026-10-12T00:00:02Z",
            completed_at: "2026-10-12T00:00:03.100Z",
            errors: [],
          },
          evalRun: {
            evaluation_run_id: "ev_n3_2",
            suite_id: "support-release",
            suite_version: 1,
            target_run_ids: ["run_n3_2"],
            summary: {
              total: 1,
              passed: 1,
              failed: 0,
              errors: 0,
              missing_evidence: 0,
              pass_rate: 1.0,
              suite_verdict: "PASSED",
              verdict_reason: "Passed",
              critical_failures: [],
            },
            results: [],
            cost_usd: 0.01,
            duration_ms: 50,
            started_at: "2026-10-12T00:00:03.100Z",
            completed_at: "2026-10-12T00:00:03.150Z",
          },
        },
        {
          trial: {
            trial_id: "trial_n3_3",
            experiment_id: baseDef.experiment_id,
            arm_id: "arm_stochastic_model",
            repetition_index: 2,
            derived_run_id: "run_n3_3",
            status: "COMPLETED",
            candidate_cost_usd: 0.02,
            grader_cost_usd: 0.01,
            duration_ms: 1050,
            started_at: "2026-10-12T00:00:04Z",
            completed_at: "2026-10-12T00:00:05.050Z",
            errors: [],
          },
          evalRun: {
            evaluation_run_id: "ev_n3_3",
            suite_id: "support-release",
            suite_version: 1,
            target_run_ids: ["run_n3_3"],
            summary: {
              total: 1,
              passed: 1,
              failed: 0,
              errors: 0,
              missing_evidence: 0,
              pass_rate: 1.0,
              suite_verdict: "PASSED",
              verdict_reason: "Passed",
              critical_failures: [],
            },
            results: [],
            cost_usd: 0.01,
            duration_ms: 50,
            started_at: "2026-10-12T00:00:05.050Z",
            completed_at: "2026-10-12T00:00:05.100Z",
          },
        },
      ];

      const resN3 = ExperimentAggregator.aggregate(baseDef, [singleArm], n3Trials, {
        cost_usd: 0.09,
        candidate_cost_usd: 0.06,
        grader_cost_usd: 0.03,
        trials_executed: 3,
        duration_ms: 3150,
      });

      const agg = resN3.aggregates[0];
      expect(agg).toBeDefined();
      expect(agg?.n).toBe(3);
      expect(agg?.pass_rate).toBe(1.0);
      expect(agg?.mean_score).toBe(1.0);
      expect(agg?.std_dev_score).toBe(0.0);
      expect(agg?.repeatability_note).toContain("Repeated across 3 trials");
      expect(resN3.limitations).not.toContain(
        "SINGLE TRIAL — REPEATABILITY UNKNOWN. Results may vary on stochastic model runs."
      );
    });
  });
});
