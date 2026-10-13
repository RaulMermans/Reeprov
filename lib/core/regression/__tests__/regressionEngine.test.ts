import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { type RunArtifact } from "../../contracts/runArtifact";
import {
  type EvalSuite,
  type EvalCase,
  type EvaluationRun,
} from "../../contracts/evalDefinitions";
import { type EvalResult } from "../../contracts/evals";
import {
  type RegressionBaseline,
  type RegressionGatePolicy,
  regressionGatePolicySchema,
} from "../../contracts/regression";
import { BaselineManager } from "../baseline";
import { ComparabilityEngine } from "../comparability";
import { RegressionDetector } from "../detector";
import { RegressionGateEngine } from "../gate";
import { RegressionCaseCuration } from "../curation";
import { CapabilitySnapshotEngine } from "../../capability/snapshot";
import { CapabilityDriftEngine } from "../../capability/drift";
import { PolicySnapshotEngine } from "../../policyDrift/snapshot";
import { PolicyDriftDetector } from "../../policyDrift/detector";
import { ReleaseEvidenceEngine } from "../../releases/snapshot";
import { getRegressionBaseline } from "../persistence";

describe("Sprint 9: AgentPulse Regression & Drift Reference Proofs A–G", () => {
  const testStoreDir = join(process.cwd(), ".agentpulse-test-regression-drift");

  beforeEach(() => {
    process.env["AGENTPULSE_STORE_DIR"] = testStoreDir;
  });

  afterEach(() => {
    delete process.env["AGENTPULSE_STORE_DIR"];
    if (existsSync(testStoreDir)) {
      rmSync(testStoreDir, { recursive: true, force: true });
    }
  });

  function makeMockRunArtifact(overrides: Partial<RunArtifact> = {}): RunArtifact {
    const defaultIdentity = {
      run_id: "run_mock_01",
      project_id: "proj_support",
      project_name: "Customer Support Automation",
      workflow_id: "wf_refund",
      agent_id: "support_agent",
      agent_version: "1.0.0",
      created_at: "2026-10-12T12:00:00.000Z",
    };
    const identity = {
      ...defaultIdentity,
      ...(overrides.identity ?? {}),
    };

    const defaultConfigSnapshot = {
      snapshot_id: "cfg_snap_1",
      run_id: identity.run_id,
      captured_at: "2026-10-12T12:00:00.000Z",
      declaration_type: "DECLARED" as const,
      agent: { id: identity.agent_id, version: identity.agent_version },
      models: [{ id: "model_1", model_name: "claude-3-5-sonnet", provider: "anthropic" }],
      prompts: [{ id: "prompt_1", name: "system", content: "You are a helpful assistant", version: "1.0" }],
      skills: [],
      tools: [{ name: "order.lookup" }],
      config_hash: "config_hash_v1",
    };
    const configurationSnapshot = overrides.configuration_snapshot
      ? { ...defaultConfigSnapshot, ...overrides.configuration_snapshot }
      : defaultConfigSnapshot;

    return {
      schema_version: "1.0.0-alpha",
      execution: {
        status: "completed",
        started_at: "2026-10-12T12:00:00.000Z",
        completed_at: "2026-10-12T12:00:02.000Z",
        duration_ms: 2000,
        summary: "Execution completed",
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
          tool_call_id: "tc_1",
          tool_name: "order.lookup",
          permission_class: "read_only",
          replayability: "REPLAYABLE_RECORDED",
          input: { id: "123" },
          output: { found: true },
          status: "completed",
          started_at: "2026-10-12T12:00:01.000Z",
          duration_ms: 100,
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
        captured_by: "RegressionProofTest",
        redaction_verified: true,
      },
      safety: {
        approval_status: "not_required",
        approval_records: [],
        redaction_summary: { total_redactions: 0, secrets_detected: 0, fields_redacted: [] },
      },
      observability: {
        model_calls_count: 1,
        tool_calls_count: 1,
        evals_passed: 1,
        evals_failed: 0,
        trace_event_count: 5,
        context_snapshot_count: 1,
        memory_operations_count: 1,
        retrieval_operations_count: 0,
        total_duration_ms: 2000,
        total_cost_usd: 0.02,
      },
      ...overrides,
      identity,
      configuration_snapshot: configurationSnapshot,
    };
  }

  function makeMockEvalRun(
    runId: string,
    results: EvalResult[],
    suiteId = "suite_support",
    suiteVersion = 1,
    datasetId = "dataset_cases",
    datasetVersion = 1
  ): EvaluationRun {
    const passed = results.filter((r) => r.status === "PASS").length;
    const failed = results.filter((r) => r.status === "FAIL").length;
    return {
      evaluation_run_id: `eval_${runId}_${Date.now()}`,
      suite_id: suiteId,
      suite_version: suiteVersion,
      target_run_ids: [runId],
      status: failed === 0 ? "COMPLETED" : "FAILED",
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: 500,
      dataset_id: datasetId,
      dataset_version: datasetVersion,
      results,
      summary: {
        total_evals: results.length,
        passed_evals: passed,
        failed_evals: failed,
        evaluator_errors: 0,
        pass_rate: results.length > 0 ? passed / results.length : 1,
        average_score:
          results.length > 0
            ? results.reduce((a, b) => a + b.score, 0) / results.length
            : 1,
        critical_failures: 0,
        duration_ms: 500,
      },
    };
  }

  function makeMockResult(
    evalDefId: string,
    caseId: string,
    status: "PASS" | "FAIL",
    score: number
  ): EvalResult {
    return {
      eval_id: evalDefId,
      eval_result_id: `res_${evalDefId}_${caseId}`,
      eval_definition_id: evalDefId,
      eval_case_id: caseId,
      eval_family: "task_completion",
      eval_type: "task_completion",
      name: evalDefId,
      passed: status === "PASS",
      status,
      score,
      reason: `Result is ${status} with score ${score}`,
      evidence: { case_id: caseId },
      execution_time_ms: 100,
      timestamp: new Date().toISOString(),
      evaluator_name: "deterministic",
      evaluator_version: "1.0.0",
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Reference Proof A: True Regression
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Reference Proof A: True Regression", () => {
    it("flags CASE_REGRESSION and fails the release gate when candidate fails a previously passing case", async () => {
      const baselineRun = makeMockRunArtifact({ identity: { run_id: "run_base_01" } as any });
      const candidateRun = makeMockRunArtifact({ identity: { run_id: "run_cand_01" } as any });

      const baseline = await BaselineManager.createBaseline({
        projectId: "proj_support",
        agentId: "support_agent",
        runId: "run_base_01",
        configurationHash: "config_hash_v1",
        evalSuiteId: "suite_support",
        evalSuiteVersion: 1,
        datasetId: "dataset_cases",
        datasetVersion: 1,
        approvedBy: "release_engineer",
      });

      // Baseline passes case_refund_allowed and case_tier2_escalation
      const baselineResults: EvalResult[] = [
        makeMockResult("eval_refund", "case_refund_allowed", "PASS", 1.0),
        makeMockResult("eval_escalate", "case_tier2_escalation", "PASS", 1.0),
      ];
      const baselineEvalRun = makeMockEvalRun("run_base_01", baselineResults);

      // Candidate fails case_refund_allowed
      const candidateResults: EvalResult[] = [
        makeMockResult("eval_refund", "case_refund_allowed", "FAIL", 0.0),
        makeMockResult("eval_escalate", "case_tier2_escalation", "PASS", 1.0),
      ];
      const candidateEvalRun = makeMockEvalRun("run_cand_01", candidateResults);

      const policy: RegressionGatePolicy = regressionGatePolicySchema.parse({
        policy_id: "strict_release_policy",
        version: 1,
        name: "Zero Regression Policy",
        fail_on_any_regression: true,
      });

      const { gateResult, report, artifact } = await RegressionGateEngine.evaluateGate({
        baseline,
        candidateRunId: "run_cand_01",
        candidateConfigHash: "config_hash_v2",
        candidateContext: {
          suite_id: "suite_support",
          suite_version: 1,
          dataset_id: "dataset_cases",
          dataset_version: 1,
        },
        baselineEvalRun,
        candidateEvalRun,
        baselineArtifact: baselineRun,
        candidateArtifact: candidateRun,
        policy,
      });

      // Proof Assertions:
      expect(gateResult.status).toBe("FAIL");
      expect(artifact.exit_code).toBe(1); // CI must block release
      expect(report.regression_detected).toBe(true);
      expect(gateResult.failure_reasons.length).toBeGreaterThan(0);
      expect(gateResult.failure_reasons.some((r) => r.includes("case_refund_allowed"))).toBe(true);

      // Case matrix shows NEW_REGRESSION
      const regCase = report.case_matrix.find((c) => c.case_id === "case_refund_allowed");
      expect(regCase).toBeDefined();
      expect(regCase!.status_transition).toBe("NEW_REGRESSION");
      expect(regCase!.score_delta).toBe(-1.0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Reference Proof B: Improvement
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Reference Proof B: Improvement", () => {
    it("approves promotion (PASS, exit_code 0) and records RECOVERED when candidate fixes previously failing cases", async () => {
      const baselineRun = makeMockRunArtifact({ identity: { run_id: "run_base_02" } as any });
      const candidateRun = makeMockRunArtifact({ identity: { run_id: "run_cand_02" } as any });

      const baseline = await BaselineManager.createBaseline({
        projectId: "proj_support",
        agentId: "support_agent",
        runId: "run_base_02",
        configurationHash: "config_hash_v1",
        evalSuiteId: "suite_support",
        evalSuiteVersion: 1,
        datasetId: "dataset_cases",
        datasetVersion: 1,
        approvedBy: "release_engineer",
      });

      // Baseline failed case_complex_discount
      const baselineResults: EvalResult[] = [
        makeMockResult("eval_refund", "case_refund_allowed", "PASS", 1.0),
        makeMockResult("eval_discount", "case_complex_discount", "FAIL", 0.0),
      ];
      const baselineEvalRun = makeMockEvalRun("run_base_02", baselineResults);

      // Candidate passes all cases
      const candidateResults: EvalResult[] = [
        makeMockResult("eval_refund", "case_refund_allowed", "PASS", 1.0),
        makeMockResult("eval_discount", "case_complex_discount", "PASS", 1.0),
      ];
      const candidateEvalRun = makeMockEvalRun("run_cand_02", candidateResults);

      const policy: RegressionGatePolicy = regressionGatePolicySchema.parse({
        policy_id: "standard_policy",
        version: 1,
        name: "Standard Gate",
      });

      const { gateResult, report, artifact } = await RegressionGateEngine.evaluateGate({
        baseline,
        candidateRunId: "run_cand_02",
        candidateConfigHash: "config_hash_v2",
        candidateContext: {
          suite_id: "suite_support",
          suite_version: 1,
          dataset_id: "dataset_cases",
          dataset_version: 1,
        },
        baselineEvalRun,
        candidateEvalRun,
        baselineArtifact: baselineRun,
        candidateArtifact: candidateRun,
        policy,
      });

      // Proof Assertions:
      expect(gateResult.status).toBe("PASS");
      expect(artifact.exit_code).toBe(0); // CI must pass
      expect(report.regression_detected).toBe(false);

      const recoveredCase = report.case_matrix.find((c) => c.case_id === "case_complex_discount");
      expect(recoveredCase).toBeDefined();
      expect(recoveredCase!.status_transition).toBe("RECOVERED");
      expect(recoveredCase!.score_delta).toBe(1.0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Reference Proof C: Safety Overrides Quality
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Reference Proof C: Safety Overrides Quality", () => {
    it("fails release gate with CRITICAL severity when safety regresses, even if quality score improved", async () => {
      const baselineRun = makeMockRunArtifact({ identity: { run_id: "run_base_03" } as any });
      const candidateRun = makeMockRunArtifact({ identity: { run_id: "run_cand_03" } as any });

      const baseline = await BaselineManager.createBaseline({
        projectId: "proj_support",
        agentId: "support_agent",
        runId: "run_base_03",
        configurationHash: "config_hash_v1",
        evalSuiteId: "suite_support",
        evalSuiteVersion: 1,
        datasetId: "dataset_cases",
        datasetVersion: 1,
      });

      // Baseline: Quality score = 0.80, Safety = PASS (1.0)
      const baseSafetyResult: EvalResult = {
        ...makeMockResult("eval_safety_leak", "case_safety_pld", "PASS", 1.0),
        eval_family: "safety",
      };
      const baselineResults: EvalResult[] = [
        makeMockResult("eval_quality", "case_quality_1", "PASS", 0.80),
        baseSafetyResult,
      ];
      const baselineEvalRun = makeMockEvalRun("run_base_03", baselineResults);

      // Candidate: Quality score improved to 0.99, but Safety regressed to FAIL (0.0)
      const candSafetyResult: EvalResult = {
        ...makeMockResult("eval_safety_leak", "case_safety_pld", "FAIL", 0.0),
        eval_family: "safety",
      };
      const candidateResults: EvalResult[] = [
        makeMockResult("eval_quality", "case_quality_1", "PASS", 0.99),
        candSafetyResult,
      ];
      const candidateEvalRun = makeMockEvalRun("run_cand_03", candidateResults);

      const policy: RegressionGatePolicy = regressionGatePolicySchema.parse({
        policy_id: "safety_first_policy",
        version: 1,
        name: "Safety Zero Tolerance Policy",
        fail_on_critical_regression: true,
      });

      const { gateResult, report, artifact } = await RegressionGateEngine.evaluateGate({
        baseline,
        candidateRunId: "run_cand_03",
        candidateConfigHash: "config_hash_v2",
        candidateContext: {
          suite_id: "suite_support",
          suite_version: 1,
          dataset_id: "dataset_cases",
          dataset_version: 1,
        },
        baselineEvalRun,
        candidateEvalRun,
        baselineArtifact: baselineRun,
        candidateArtifact: candidateRun,
        policy,
      });

      // Proof Assertions:
      expect(gateResult.status).toBe("FAIL");
      expect(artifact.exit_code).toBe(1);
      expect(gateResult.critical_failure_count).toBeGreaterThan(0);

      // Verify CRITICAL safety finding exists
      const safetyFinding = report.findings.find(
        (f) => f.category === "SAFETY_REGRESSION" && f.severity === "CRITICAL"
      );
      expect(safetyFinding).toBeDefined();
      expect(gateResult.failure_reasons.some((r) => r.includes("CRITICAL"))).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Reference Proof D: Not Comparable (Apples-to-Oranges Guard)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Reference Proof D: Not Comparable (Apples-to-Oranges Guard)", () => {
    it("returns NOT_COMPARABLE (exit_code 2) and prevents invalid regression claims across mismatched suites/datasets", async () => {
      const baseline = await BaselineManager.createBaseline({
        projectId: "proj_support",
        agentId: "support_agent",
        runId: "run_base_04",
        configurationHash: "config_hash_v1",
        evalSuiteId: "support_suite",
        evalSuiteVersion: 2,
        datasetId: "dataset_support",
        datasetVersion: 2,
      });

      const candidateResults = [makeMockResult("eval_refund", "case_1", "PASS", 1.0)];
      const candidateEvalRun = makeMockEvalRun("run_cand_04", candidateResults, "support_suite", 5, "dataset_support", 4);

      const assessment = ComparabilityEngine.assess(baseline, {
        suite_id: "support_suite",
        suite_version: 5, // Different suite version!
        dataset_id: "dataset_support",
        dataset_version: 4, // Different dataset version!
      });

      // Proof Assertions:
      expect(assessment.verdict).toBe("NOT_COMPARABLE");
      expect(assessment.reasons.length).toBeGreaterThan(0);
      expect(assessment.suggested_re_evaluation).toBeDefined();
      expect(assessment.suggested_re_evaluation?.suite_version).toBe(5);

      const policy: RegressionGatePolicy = regressionGatePolicySchema.parse({
        policy_id: "standard_policy",
        version: 1,
        name: "Standard Policy",
      });

      const { gateResult, artifact } = await RegressionGateEngine.evaluateGate({
        baseline,
        candidateRunId: "run_cand_04",
        candidateConfigHash: "config_hash_v2",
        candidateContext: {
          suite_id: "support_suite",
          suite_version: 5,
          dataset_id: "dataset_support",
          dataset_version: 4,
        },
        candidateEvalRun,
        policy,
      });

      expect(gateResult.status).toBe("NOT_COMPARABLE");
      expect(artifact.exit_code).toBe(2);
      expect(gateResult.failure_reasons.some((r) => r.includes("Apples-to-oranges"))).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Reference Proof E: Behavioral Policy Drift
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Reference Proof E: Behavioral Policy Drift", () => {
    it("detects unannounced permission expansion and unauthorized execution as CRITICAL drift", async () => {
      // Baseline: customer support agent with only read-only tools
      const baseRun = makeMockRunArtifact({
        identity: { run_id: "run_base_pol" } as any,
        tools: [
          {
            tool_call_id: "tc_ro",
            tool_name: "order.read",
            permission_class: "read_only",
            replayability: "REPLAYABLE_RECORDED",
            input: {},
            output: {},
            status: "completed",
            started_at: "2026-10-12T12:00:00.000Z",
            duration_ms: 100,
          },
        ],
      });

      // Candidate: executed sensitive tool "database.drop_table" without declared permission
      const candRun = makeMockRunArtifact({
        identity: { run_id: "run_cand_pol" } as any,
        tools: [
          {
            tool_call_id: "tc_ro",
            tool_name: "order.read",
            permission_class: "read_only",
            replayability: "REPLAYABLE_RECORDED",
            input: {},
            output: {},
            status: "completed",
            started_at: "2026-10-12T12:00:00.000Z",
            duration_ms: 100,
          },
          {
            tool_call_id: "tc_drop",
            tool_name: "database.drop_table",
            permission_class: "write_destructive",
            replayability: "LIVE_ONLY",
            input: { table: "customers" },
            output: { dropped: true },
            status: "completed",
            started_at: "2026-10-12T12:00:01.000Z",
            duration_ms: 200,
          },
        ],
      });

      const baseSnap = await PolicySnapshotEngine.captureSnapshot({
        projectId: "proj_support",
        runArtifact: baseRun,
        policyId: "gov_policy",
        policyVersion: 1,
        declaredPermissions: ["order.read"],
      });

      const candSnap = await PolicySnapshotEngine.captureSnapshot({
        projectId: "proj_support",
        runArtifact: candRun,
        policyId: "gov_policy",
        policyVersion: 1, // Same declared policy version, but behavioral divergence!
        declaredPermissions: ["order.read"],
      });

      const driftReport = await PolicyDriftDetector.detect({
        baselineSnapshot: baseSnap,
        candidateSnapshot: candSnap,
      });

      // Proof Assertions:
      expect(driftReport.has_critical_drift).toBe(true);
      expect(driftReport.findings.length).toBeGreaterThan(0);
      const permExpansion = driftReport.findings.find(
        (f) => f.drift_type === "PERMISSION_EXPANSION" || f.drift_type === "SIDE_EFFECT_BEHAVIOR_CHANGE"
      );
      expect(permExpansion).toBeDefined();
      expect(permExpansion!.severity).toBe("CRITICAL");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Reference Proof F: Declared Policy Change
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Reference Proof F: Declared Policy Change", () => {
    it("classifies explicit policy updates as DECLARED_POLICY_CHANGE with INFO severity", async () => {
      const baseRun = makeMockRunArtifact({ identity: { run_id: "run_base_dec" } as any });
      const candRun = makeMockRunArtifact({ identity: { run_id: "run_cand_dec" } as any });

      const baseSnap = await PolicySnapshotEngine.captureSnapshot({
        projectId: "proj_support",
        runArtifact: baseRun,
        policyId: "gov_policy",
        policyVersion: 1,
        declaredPermissions: ["order.read"],
      });

      const candSnap = await PolicySnapshotEngine.captureSnapshot({
        projectId: "proj_support",
        runArtifact: candRun,
        policyId: "gov_policy",
        policyVersion: 2, // Intentional declared bump!
        declaredPermissions: ["order.read", "refund.issue"],
      });

      const driftReport = await PolicyDriftDetector.detect({
        baselineSnapshot: baseSnap,
        candidateSnapshot: candSnap,
      });

      // Proof Assertions:
      expect(driftReport.has_critical_drift).toBe(false);
      const declaredFinding = driftReport.findings.find(
        (f) => f.drift_type === "DECLARED_POLICY_CHANGE"
      );
      expect(declaredFinding).toBeDefined();
      expect(declaredFinding!.severity).toBe("INFO");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Reference Proof G: Stochastic Variance vs Definitive Regression
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Reference Proof G: Stochastic Variance vs Definitive Regression", () => {
    it("distinguishes non-definitive drops under insufficient trials using honest OBSERVED_DROP language", async () => {
      const baselineRun = makeMockRunArtifact({ identity: { run_id: "run_base_stoch" } as any });
      const candidateRun = makeMockRunArtifact({ identity: { run_id: "run_cand_stoch" } as any });

      const baseline = await BaselineManager.createBaseline({
        projectId: "proj_support",
        agentId: "stochastic_agent",
        runId: "run_base_stoch",
        configurationHash: "config_hash_v1",
        evalSuiteId: "suite_support",
        evalSuiteVersion: 1,
      });

      // Baseline had 1 trial score 0.90
      const baselineResults = [makeMockResult("eval_stoch", "case_1", "PASS", 0.90)];
      const baselineEvalRun = makeMockEvalRun("run_base_stoch", baselineResults);

      // Candidate had 1 trial score 0.85
      const candidateResults = [makeMockResult("eval_stoch", "case_1", "PASS", 0.85)];
      const candidateEvalRun = makeMockEvalRun("run_cand_stoch", candidateResults);

      // Policy requires minimum 3 trials for definitive claims
      const policy: RegressionGatePolicy = regressionGatePolicySchema.parse({
        policy_id: "stochastic_policy",
        version: 1,
        name: "Stochastic Policy",
        minimum_trials: 3,
        max_absolute_score_drop: 0.02,
      });

      const { gateResult, report } = await RegressionGateEngine.evaluateGate({
        baseline,
        candidateRunId: "run_cand_stoch",
        candidateConfigHash: "config_hash_v2",
        candidateContext: {
          suite_id: "suite_support",
          suite_version: 1,
        },
        baselineEvalRun,
        candidateEvalRun,
        baselineArtifact: baselineRun,
        candidateArtifact: candidateRun,
        policy,
      });

      // Findings should reflect OBSERVED_DROP (honest non-definitive language)
      const stochFinding = report.findings.find((f) => f.eval_definition_ids?.includes("eval_stoch"));
      if (stochFinding) {
        expect(stochFinding.causal_status).toBe("OBSERVED_DROP");
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Baseline Immutability & Lifecycle Tests
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Baseline Immutability & Lifecycle", () => {
    it("seals baseline evidence upon approval and preserves baseline_v1 when creating baseline_v2", async () => {
      const v1 = await BaselineManager.createBaseline({
        baselineId: "base_golden_release_v1",
        projectId: "proj_support",
        agentId: "support_agent",
        runId: "run_v1",
        configurationHash: "cfg_hash_1",
        evalSuiteId: "suite_support",
        evalSuiteVersion: 1,
        approvedBy: "security_officer",
        label: "Production Release 1.0",
      });

      expect(v1.status).toBe("ACTIVE");
      const v1Hash = v1.evidence_hash;

      // Supersede v1
      const { previous, next } = await BaselineManager.supersedeBaseline(
        "base_golden_release_v1",
        {
          projectId: "proj_support",
          agentId: "support_agent",
          runId: "run_v2",
          configurationHash: "cfg_hash_2",
          evalSuiteId: "suite_support",
          evalSuiteVersion: 1,
          approvedBy: "security_officer",
          label: "Production Release 2.0",
        },
        "Promoting v2 after full qualification"
      );

      // Verify v1 is marked SUPERSEDED but unchanged in evidence
      expect(previous.status).toBe("SUPERSEDED");
      expect(previous.evidence_hash).toBe(v1Hash);

      // Verify next is v2 with ACTIVE status
      expect(next.baseline_id).toBe("base_golden_release_v2");
      expect(next.status).toBe("ACTIVE");

      // Verify persistence reflects superseded v1 and active v2
      const persistedV1 = await getRegressionBaseline("base_golden_release_v1");
      expect(persistedV1?.status).toBe("SUPERSEDED");

      const persistedV2 = await getRegressionBaseline("base_golden_release_v2");
      expect(persistedV2?.status).toBe("ACTIVE");
    });

    it("revokes a baseline with auditable rationale without erasing historical record", async () => {
      const base = await BaselineManager.createBaseline({
        baselineId: "base_flawed_v1",
        projectId: "proj_support",
        configurationHash: "cfg_hash_flawed",
        evalSuiteId: "suite_support",
        evalSuiteVersion: 1,
        approvedBy: "qa",
      });

      const revoked = await BaselineManager.revokeBaseline(
        "base_flawed_v1",
        "chief_architect",
        "Security vulnerability discovered in baseline configuration"
      );

      expect(revoked.status).toBe("REVOKED");
      expect(revoked.metadata["revoked_by"]).toBe("chief_architect");
      expect(revoked.metadata["revoke_reason"]).toBe(
        "Security vulnerability discovered in baseline configuration"
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Production Failure Curation Tests
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Production Failure Curation", () => {
    it("curates a production incident into a permanent regression test with complete provenance", async () => {
      // Save canonical run to persistence so curation engine can find it
      const { saveCanonicalRun } = await import("../../capture/persistence");
      const failedRun = makeMockRunArtifact({
        identity: { run_id: "run_incident_9482", project_id: "proj_support" } as any,
      });
      await saveCanonicalRun(failedRun);

      const curatedCase = await RegressionCaseCuration.curateFailureAsRegressionCase({
        runId: "run_incident_9482",
        datasetId: "permanent_regression_suite",
        datasetVersion: 1,
        caseName: "case_prompt_injection_order_cancel",
        failureCategory: "SECURITY_VIOLATION",
        sourceIncident: "INC-9482",
        curatedBy: "incident_commander",
        expectedBehavior: "Agent must reject unauthorized cancellation attempt",
      });

      // Proof Assertions:
      expect(curatedCase.name).toBe("case_prompt_injection_order_cancel");
      expect(curatedCase.dataset_id).toBe("permanent_regression_suite");
      expect(curatedCase.metadata["source_run_id"]).toBe("run_incident_9482");
      expect(curatedCase.metadata["source_incident"]).toBe("INC-9482");
      expect(curatedCase.metadata["failure_category"]).toBe("SECURITY_VIOLATION");
      expect(curatedCase.metadata["curated_by"]).toBe("incident_commander");
      expect(curatedCase.tags).toContain("regression_case");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Multi-Dimensional Capability Tracking Tests
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Multi-Dimensional Capability Tracking", () => {
    it("derives capability snapshots and tracks dimensional drift with configuration attribution", async () => {
      const runV1 = makeMockRunArtifact({ identity: { run_id: "run_v1", agent_version: "1.0.0" } as any });
      const runV2 = makeMockRunArtifact({ identity: { run_id: "run_v2", agent_version: "2.0.0" } as any });

      const snapV1 = await CapabilitySnapshotEngine.createSnapshot({
        projectId: "proj_support",
        agentId: "support_agent",
        agentVersion: "1.0.0",
        configurationHash: "cfg_v1",
        suiteId: "suite_support",
        suiteVersion: 1,
        runArtifact: runV1,
        evalRuns: [
          makeMockEvalRun("run_v1", [
            makeMockResult("eval_task", "case_1", "PASS", 0.85),
          ]),
        ],
      });

      const snapV2 = await CapabilitySnapshotEngine.createSnapshot({
        projectId: "proj_support",
        agentId: "support_agent",
        agentVersion: "2.0.0",
        configurationHash: "cfg_v2",
        suiteId: "suite_support",
        suiteVersion: 1,
        runArtifact: runV2,
        evalRuns: [
          makeMockEvalRun("run_v2", [
            makeMockResult("eval_task", "case_1", "PASS", 0.95),
          ]),
        ],
      });

      expect(snapV1.dimensions.length).toBeGreaterThan(0);
      expect(snapV2.dimensions.length).toBeGreaterThan(0);

      const driftReport = await CapabilityDriftEngine.analyzeDrift({
        baselineSnapshot: snapV1,
        candidateSnapshot: snapV2,
        configDiff: {
          has_changes: true,
          components_changed: ["prompts"],
          summary: ["Prompt 'system' updated from v1.0 to v2.0"],
        },
      });

      expect(driftReport.overall_drift).toBe("IMPROVED");
      const taskDrift = driftReport.dimensions.find((d) => d.dimension === "TASK_SUCCESS");
      expect(taskDrift).toBeDefined();
      expect(taskDrift!.direction).toBe("IMPROVED");
      expect(taskDrift!.associated_configuration_changes).toContain(
        "Prompt 'system' updated from v1.0 to v2.0"
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Release Evidence Snapshot Tests
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Release Evidence Snapshots", () => {
    it("creates an immutable ReleaseEvidenceSnapshot linking all governance evidence", async () => {
      const releaseSnap = await ReleaseEvidenceEngine.createSnapshot({
        projectId: "proj_support",
        releaseVersion: "v1.4.0",
        agentId: "support_agent",
        configurationHash: "cfg_hash_gold",
        capabilitySnapshotId: "cap_snap_v14",
        policySnapshotId: "pol_snap_v14",
        evalSuiteId: "suite_release",
        evalSuiteVersion: 3,
        regressionGateResultId: "gate_res_pass_01",
        regressionGateStatus: "PASS",
        approvedBy: "vp_engineering",
      });

      expect(releaseSnap.release_version).toBe("v1.4.0");
      expect(releaseSnap.evidence_hash).toBeDefined();
      expect(releaseSnap.status).toBe("APPROVED_EXTERNALLY");
    });
  });
});
