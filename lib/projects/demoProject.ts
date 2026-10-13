/**
 * Deterministic Demo Project for AgentPulse Studio.
 *
 * Provides a self-contained, labeled "Demo Support Agent" with pre-populated:
 *   - Success run with full evidence
 *   - Failed run with memory divergence
 *   - Visual run comparison
 *   - Eval suite & Regression baseline
 *   - Regression gate report showing failure
 *
 * Isolated under project_id: demo-support-agent
 */

import { ProjectStore } from "./projectStore";
import { getRunStore } from "@/lib/db/getStores";
import { saveCanonicalRun } from "@/lib/core/capture/persistence";
import { compareRuns } from "@/lib/core/comparison/comparator";
import { saveRunComparison } from "@/lib/core/comparison/persistence";
import { BaselineManager } from "@/lib/core/regression/baseline";
import { saveEvalSuite } from "@/lib/core/evals/persistence";
import { RegressionGateEngine } from "@/lib/core/regression/gate";
import { regressionGatePolicySchema } from "@/lib/core/contracts/regression";
import { runArtifactSchema, type RunArtifact } from "@/lib/core/contracts/runArtifact";
import type { EvalSuite, EvaluationRun } from "@/lib/core/contracts/evalDefinitions";

export const DEMO_PROJECT_ID = "demo-support-agent";
export const DEMO_PROJECT_NAME = "Demo Support Agent";

export function isDemoProject(projectId: string | null | undefined): boolean {
  if (!projectId) return false;
  return projectId === DEMO_PROJECT_ID || projectId.startsWith("demo-");
}

export class DemoProjectManager {
  /**
   * Sets up or resets the complete demo project and deterministic assets.
   */
  static async setupDemoProject(): Promise<{
    project: ReturnType<typeof ProjectStore.getProject> extends Promise<infer T> ? T : never;
    successRunId: string;
    failureRunId: string;
    baselineId: string;
  }> {
    // 1. Create or get demo project
    let project = await ProjectStore.getProject(DEMO_PROJECT_ID);
    if (!project) {
      const res = await ProjectStore.createProject({
        id: DEMO_PROJECT_ID,
        name: DEMO_PROJECT_NAME,
        description: "Reference customer support agent demonstrating capture, memory divergence, and regression gates.",
        language: "typescript",
        framework: "langgraph",
      });
      project = res.project;
    }

    const runStore = getRunStore();

    // 2. Deterministic Success Run
    const successRunId = "demo_run_success_001";
    const now = new Date();
    const t0 = new Date(now.getTime() - 3600000).toISOString();
    const t1 = new Date(now.getTime() - 3596000).toISOString();

    const successRun: RunArtifact = runArtifactSchema.parse({
      schema_version: "1.0.0-alpha",
      identity: {
        run_id: successRunId,
        project_id: DEMO_PROJECT_ID,
        project_name: DEMO_PROJECT_NAME,
        workflow_id: "customer-refund-v1",
        created_at: t0,
      },
      execution: {
        status: "completed",
        started_at: t0,
        completed_at: t1,
        duration_ms: 4000,
        summary: "Verified order status #48921 and approved eligible refund of $49.00.",
      },
      trajectory: [
        {
          step_id: "step_demo_0",
          step_index: 0,
          step_type: "model_call",
          name: "intent_classification",
          started_at: t0,
          completed_at: t0,
          status: "completed",
          boundary_ids: [],
          tool_invocation_ids: [],
          model_invocation_ids: ["m_demo_1"],
          retrieval_operation_ids: [],
          eval_result_ids: [],
          artifact_ids: [],
        },
        {
          step_id: "step_demo_1",
          step_index: 1,
          step_type: "tool_call",
          name: "verify_order",
          started_at: t0,
          completed_at: t1,
          status: "completed",
          boundary_ids: [],
          tool_invocation_ids: ["t_demo_1"],
          model_invocation_ids: [],
          retrieval_operation_ids: [],
          eval_result_ids: [],
          artifact_ids: [],
        },
      ],
      state: [
        {
          snapshot_id: "snap_success_0",
          step_id: "step_demo_0",
          timestamp: t0,
          state_data: {
            customer_id: "cust_9812",
            order_id: "ord_48921",
            order_status: "DELIVERED",
            refund_requested: 49.0,
            refund_eligible: true,
          },
        },
      ],
      checkpoints: [
        {
          checkpoint_id: "chk_demo_success_0",
          run_id: successRunId,
          step_id: "step_demo_0",
          state_snapshot_id: "snap_success_0",
          state_hash: "sha256:order_processing_state",
          created_at: t0,
        },
      ],
      models: [
        {
          invocation_id: "m_demo_1",
          model_name: "claude-sonnet-4-6",
          provider: "anthropic",
          prompt_tokens: 420,
          completion_tokens: 85,
          total_tokens: 505,
          cost_usd: 0.002,
          duration_ms: 1200,
          started_at: t0,
          completed_at: t0,
        },
      ],
      tools: [
        {
          tool_call_id: "t_demo_1",
          tool_name: "fetch_order_status",
          input: { order_id: "ord_48921" },
          output: { status: "DELIVERED", delivery_date: "2026-10-10" },
          status: "completed",
          duration_ms: 240,
          started_at: t0,
          completed_at: t1,
        },
      ],
      evals: [
        {
          eval_id: "ev_demo_1",
          eval_type: "task_success",
          evaluator_id: "policy_grader",
          target_run_id: successRunId,
          name: "Policy Eligibility",
          score: 1.0,
          passed: true,
          findings: [],
          timestamp: t1,
        },
      ],
      observability: {
        total_duration_ms: 4000,
        total_cost_usd: 0.002,
        model_calls_count: 1,
        tool_calls_count: 1,
        evals_passed: 1,
        evals_failed: 0,
      },
      provenance: {
        capture_method: "sdk_trace",
        adapter_version: "1.0.0",
        captured_by: "Demo",
        redaction_verified: true,
      },
      safety: {
        approval_status: "not_required",
        approval_records: [],
        redaction_summary: { total_redactions: 0, secrets_detected: 0, fields_redacted: [] },
      },
      configuration_snapshot: {
        snapshot_id: "cfg_demo_001",
        run_id: successRunId,
        captured_at: t0,
        declaration_type: "EFFECTIVE",
        config_hash: "sha256:baseline_prompt_v1",
        agent: { id: "support-agent-core", name: "Support Agent", version: "1.0.0" },
        model: { model_id: "claude-sonnet-4-6", provider: "anthropic" },
      },
    });

    // 3. Deterministic Failure Run (Memory Divergence)
    const failureRunId = "demo_run_failure_002";
    const t2 = new Date(now.getTime() - 1800000).toISOString();
    const t3 = new Date(now.getTime() - 1795000).toISOString();

    const failureRun: RunArtifact = runArtifactSchema.parse({
      schema_version: "1.0.0-alpha",
      identity: {
        run_id: failureRunId,
        project_id: DEMO_PROJECT_ID,
        project_name: DEMO_PROJECT_NAME,
        workflow_id: "customer-refund-v1",
        created_at: t2,
      },
      execution: {
        status: "failed",
        started_at: t2,
        completed_at: t3,
        duration_ms: 5000,
        summary: "Execution failed due to unexpected memory corruption: order_status mutated to CANCELLED.",
      },
      trajectory: [
        {
          step_id: "step_demo_fail_0",
          step_index: 0,
          step_type: "model_call",
          name: "intent_classification",
          started_at: t2,
          completed_at: t2,
          status: "completed",
          boundary_ids: [],
          tool_invocation_ids: [],
          model_invocation_ids: ["m_demo_2"],
          retrieval_operation_ids: [],
          eval_result_ids: [],
          artifact_ids: [],
        },
        {
          step_id: "step_demo_fail_1",
          step_index: 1,
          step_type: "tool_call",
          name: "verify_order",
          started_at: t2,
          completed_at: t3,
          status: "failed",
          boundary_ids: [],
          tool_invocation_ids: ["t_demo_2"],
          model_invocation_ids: [],
          retrieval_operation_ids: [],
          eval_result_ids: [],
          artifact_ids: [],
        },
      ],
      state: [
        {
          snapshot_id: "snap_fail_0",
          step_id: "step_demo_fail_0",
          timestamp: t2,
          state_data: {
            customer_id: "cust_9812",
            order_id: "ord_48921",
            order_status: "CANCELLED", // Divergence from DELIVERED
            refund_requested: 49.0,
            refund_eligible: false, // Ineligible due to corrupted state
          },
        },
      ],
      checkpoints: [
        {
          checkpoint_id: "chk_demo_fail_0",
          run_id: failureRunId,
          step_id: "step_demo_fail_0",
          state_snapshot_id: "snap_fail_0",
          state_hash: "sha256:divergent_corrupted_state",
          created_at: t2,
        },
      ],
      models: [
        {
          invocation_id: "m_demo_2",
          model_name: "claude-sonnet-4-6",
          provider: "anthropic",
          prompt_tokens: 420,
          completion_tokens: 110,
          total_tokens: 530,
          cost_usd: 0.0022,
          duration_ms: 1400,
          started_at: t2,
          completed_at: t2,
        },
      ],
      tools: [
        {
          tool_call_id: "t_demo_2",
          tool_name: "fetch_order_status",
          input: { order_id: "ord_48921" },
          output: { error: "Order state conflict: marked CANCELLED while querying DELIVERED." },
          status: "failed",
          duration_ms: 310,
          started_at: t2,
          completed_at: t3,
        },
      ],
      evals: [
        {
          eval_id: "ev_demo_2",
          eval_type: "task_success",
          evaluator_id: "policy_grader",
          target_run_id: failureRunId,
          name: "Policy Eligibility",
          score: 0.0,
          passed: false,
          findings: ["Order state was incorrectly CANCELLED; customer refund rejected unjustly."],
          timestamp: t3,
        },
      ],
      observability: {
        total_duration_ms: 5000,
        total_cost_usd: 0.0022,
        model_calls_count: 1,
        tool_calls_count: 1,
        evals_passed: 0,
        evals_failed: 1,
      },
      provenance: {
        capture_method: "sdk_trace",
        adapter_version: "1.0.0",
        captured_by: "Demo",
        redaction_verified: true,
      },
      safety: {
        approval_status: "not_required",
        approval_records: [],
        redaction_summary: { total_redactions: 0, secrets_detected: 0, fields_redacted: [] },
      },
      configuration_snapshot: {
        snapshot_id: "cfg_demo_002",
        run_id: failureRunId,
        captured_at: t2,
        declaration_type: "EFFECTIVE",
        config_hash: "sha256:drifted_prompt_v2",
        agent: { id: "support-agent-core", name: "Support Agent", version: "1.0.0" },
        model: { model_id: "claude-sonnet-4-6", provider: "anthropic" },
      },
    });

    // Save both canonical runs
    await saveCanonicalRun(successRun);
    await saveCanonicalRun(failureRun);

    // Also register in runStore summary list
    await runStore.createRun({
      run_id: successRunId,
      project_id: DEMO_PROJECT_ID,
      project_name: DEMO_PROJECT_NAME,
      workflow_id: "customer-refund-v1",
      status: "completed",
      started_at: t0,
      completed_at: t1,
      total_duration_ms: 4000,
      total_cost_usd: 0.002,
      model_calls_count: 1,
      tool_calls_count: 1,
      evals_passed: 1,
      evals_failed: 0,
      approval_status: "not_required",
      summary: successRun.execution.summary,
      artifact_refs: [],
    });

    await runStore.createRun({
      run_id: failureRunId,
      project_id: DEMO_PROJECT_ID,
      project_name: DEMO_PROJECT_NAME,
      workflow_id: "customer-refund-v1",
      status: "failed",
      started_at: t2,
      completed_at: t3,
      total_duration_ms: 5000,
      total_cost_usd: 0.0022,
      model_calls_count: 1,
      tool_calls_count: 1,
      evals_passed: 0,
      evals_failed: 1,
      approval_status: "not_required",
      summary: failureRun.execution.summary,
      artifact_refs: [],
    });

    // 4. Comparison between Success & Failure
    const comparison = await compareRuns(successRun, failureRun);
    await saveRunComparison(comparison);

    // 5. Eval Suite & Baseline
    const suite: EvalSuite = {
      suite_id: "demo-refund-suite",
      version: 1,
      name: "Customer Refund Policy Suite",
      description: "Verifies eligibility and memory consistency in refund workflows.",
      definitions: [],
      required_eval_ids: [],
      optional_eval_ids: [],
      pass_policy: {
        mode: "ALL_REQUIRED_PASS",
        critical_eval_ids: [],
      },
      content_hash: "sha256:refund_suite_hash",
      created_at: t0,
    };
    await saveEvalSuite(suite);

    const baseline = await BaselineManager.createBaseline({
      projectId: DEMO_PROJECT_ID,
      agentId: "support-agent-core",
      runId: successRunId,
      configurationHash: "sha256:baseline_prompt_v1",
      evalSuiteId: suite.suite_id,
      evalSuiteVersion: suite.version,
      label: "Production Gold Standard Baseline",
      approvedBy: "AgentPulse Studio Operator",
      releaseVersion: "1.0.0",
    });

    // 6. Evaluate Regression Gate on Failure Run
    const candidateEvalRun: EvaluationRun = {
      evaluation_run_id: "demo-eval-run-1",
      suite_id: suite.suite_id,
      suite_version: suite.version,
      target_run_ids: [failureRunId],
      status: "FAILED",
      started_at: t2,
      completed_at: t3,
      results: [],
      summary: {
        total: 1,
        passed: 0,
        failed: 1,
        errors: 0,
        missing_evidence: 0,
        pass_rate: 0,
        suite_verdict: "FAILED",
        verdict_reason: "Eligible refund validation failed",
        critical_failures: [],
      },
      cost_usd: 0,
      duration_ms: 1000,
      errors: [],
    };

    const policy = regressionGatePolicySchema.parse({
      policy_id: "demo_release_gate",
      version: 1,
      name: "Demo Release Gate Policy",
    });

    try {
      await RegressionGateEngine.evaluateGate({
        baseline,
        candidateRunId: failureRunId,
        candidateConfigHash: "sha256:drifted_prompt_v2",
        candidateContext: {
          suite_id: suite.suite_id,
          suite_version: suite.version,
        },
        candidateEvalRun,
        baselineArtifact: successRun,
        candidateArtifact: failureRun,
        comparison,
        policy,
        persist: true,
      });
    } catch {
      // Non-fatal
    }

    return {
      project: (await ProjectStore.getProject(DEMO_PROJECT_ID))!,
      successRunId,
      failureRunId,
      baselineId: baseline.baseline_id,
    };
  }

  /**
   * Cleans up and resets the demo project.
   */
  static async resetDemoProject(): Promise<void> {
    const existing = await ProjectStore.getProject(DEMO_PROJECT_ID);
    if (existing) {
      await ProjectStore.deleteProject(DEMO_PROJECT_ID);
    }
    await this.setupDemoProject();
  }
}
