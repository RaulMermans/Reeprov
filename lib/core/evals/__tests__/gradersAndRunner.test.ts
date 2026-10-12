import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runArtifactSchema, type RunArtifact } from "../../contracts/runArtifact";
import type { EvalDefinition, EvalSuite } from "../../contracts/evalDefinitions";
import { DeterministicEvaluatorAdapter } from "../graders/deterministic";
import { ModelJudgeEvaluatorAdapter } from "../graders/modelJudge";
import { HumanEvaluatorAdapter } from "../graders/humanReview";
import { evaluateRun, computeEvaluationSummary } from "../runner";
import { enrichRunArtifactWithEvals } from "../enrichment";

function loadFixture(filename: string): RunArtifact {
  const filePath = join(process.cwd(), "tests/fixtures/canonical", filename);
  const raw = JSON.parse(readFileSync(filePath, "utf-8"));
  return runArtifactSchema.parse(raw);
}

describe("Sprint 8: Evaluator Adapters, Graders & Runner Engine", () => {
  const testStoreDir = join(process.cwd(), ".agentpulse-test-eval-graders");
  let baseline: RunArtifact;
  const deterministicAdapter = new DeterministicEvaluatorAdapter();

  beforeEach(() => {
    process.env["AGENTPULSE_STORE_DIR"] = testStoreDir;
    baseline = loadFixture("fixture-j-context-ablation-baseline.json");
  });

  afterEach(() => {
    delete process.env["AGENTPULSE_STORE_DIR"];
    if (existsSync(testStoreDir)) {
      rmSync(testStoreDir, { recursive: true, force: true });
    }
  });

  describe("1. Deterministic Graders First & Structured Assertions", () => {
    it("grades OUTCOME_STATUS correctly", async () => {
      const def: EvalDefinition = {
        eval_definition_id: "def_status_success",
        name: "Outcome Status Success",
        family: "task_success",
        version: 1,
        target_scope: "RUN",
        grader_type: "deterministic",
        severity: "critical",
        required: true,
        grader_config: { type: "OUTCOME_STATUS", expected_status: "SUCCESS" },
        evidence_requirements: ["final_outcome"],
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash1",
        status: "active",
      };

      const result = await deterministicAdapter.evaluate({ artifact: baseline, definition: def });
      expect(result.passed).toBe(true);
      expect(result.score).toBe(1);
      expect(result.grader_status).toBe("PASSED");
    });

    it("grades SCHEMA_VALIDITY against required keys", async () => {
      const def: EvalDefinition = {
        eval_definition_id: "def_schema",
        name: "Outcome Schema",
        family: "schema_validity",
        version: 1,
        target_scope: "RUN",
        grader_type: "deterministic",
        severity: "fail",
        required: true,
        grader_config: { type: "SCHEMA_VALIDITY", required_keys: ["status"] },
        evidence_requirements: ["final_outcome"],
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash2",
        status: "active",
      };

      const result = await deterministicAdapter.evaluate({ artifact: baseline, definition: def });
      expect(result.passed).toBe(true);
      expect(result.grader_status).toBe("PASSED");
    });

    it("grades EXACT_MATCH and CONTAINS", async () => {
      const defExact: EvalDefinition = {
        eval_definition_id: "def_exact",
        name: "Workflow ID Match",
        family: "output_validity",
        version: 1,
        target_scope: "RUN",
        grader_type: "deterministic",
        severity: "fail",
        required: true,
        grader_config: { type: "EXACT_MATCH", field: "identity.workflow_id", expected: "wf_refund_triage" },
        evidence_requirements: [],
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash3",
        status: "active",
      };

      const resultExact = await deterministicAdapter.evaluate({ artifact: baseline, definition: defExact });
      expect(resultExact.passed).toBe(true);

      const defContains: EvalDefinition = {
        eval_definition_id: "def_contains",
        name: "Contains Policy Term",
        family: "output_validity",
        version: 1,
        target_scope: "RUN",
        grader_type: "deterministic",
        severity: "fail",
        required: true,
        grader_config: { type: "CONTAINS", field: "execution.summary", substring: "refund" },
        evidence_requirements: [],
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash4",
        status: "active",
      };

      const resultContains = await deterministicAdapter.evaluate({ artifact: baseline, definition: defContains });
      expect(resultContains.passed).toBe(true);
    });

    it("grades TOOL_SELECTED and TOOL_NOT_SELECTED", async () => {
      const toolArtifact = loadFixture("fixture-b-llm-tool.json");
      const defSelected: EvalDefinition = {
        eval_definition_id: "def_tool_selected",
        name: "Stripe Lookup Selected",
        family: "tool_selection",
        version: 1,
        target_scope: "TOOL_CALL",
        grader_type: "deterministic",
        severity: "fail",
        required: true,
        grader_config: { type: "TOOL_SELECTED", tool_name: "fetch_stripe_customer", expected: true },
        evidence_requirements: ["tool_call"],
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash5",
        status: "active",
      };

      const resSelected = await deterministicAdapter.evaluate({ artifact: toolArtifact, definition: defSelected });
      expect(resSelected.passed).toBe(true);
      expect(resSelected.evidence_references.length).toBeGreaterThan(0);

      const defNotSelected: EvalDefinition = {
        eval_definition_id: "def_tool_not_selected",
        name: "Unused Tool Not Selected",
        family: "tool_selection",
        version: 1,
        target_scope: "TOOL_CALL",
        grader_type: "deterministic",
        severity: "fail",
        required: true,
        grader_config: { type: "TOOL_NOT_SELECTED", tool_name: "disallowed.dangerous_action" },
        evidence_requirements: [],
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash6",
        status: "active",
      };

      const resNotSelected = await deterministicAdapter.evaluate({ artifact: toolArtifact, definition: defNotSelected });
      expect(resNotSelected.passed).toBe(true);
    });

    it("grades TOOL_ARGUMENT_ASSERTION", async () => {
      const toolArtifact = loadFixture("fixture-b-llm-tool.json");
      const defArg: EvalDefinition = {
        eval_definition_id: "def_tool_arg",
        name: "Customer ID Valid",
        family: "argument_validity",
        version: 1,
        target_scope: "TOOL_CALL",
        grader_type: "deterministic",
        severity: "fail",
        required: true,
        grader_config: {
          type: "TOOL_ARGUMENT_ASSERTION",
          tool_name: "fetch_stripe_customer",
          argument_key: "customerId",
          expected_value: "cus_98765",
        },
        evidence_requirements: ["tool_call"],
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash7",
        status: "active",
      };

      const resArg = await deterministicAdapter.evaluate({ artifact: toolArtifact, definition: defArg });
      expect(resArg.passed).toBe(true);
    });

    it("grades APPROVAL_COMPLIANCE and SECURITY_VIOLATION_COUNT", async () => {
      const defApproval: EvalDefinition = {
        eval_definition_id: "def_approval",
        name: "Approval Gate",
        family: "approval_compliance",
        version: 1,
        target_scope: "RUN",
        grader_type: "deterministic",
        severity: "critical",
        required: true,
        grader_config: { type: "APPROVAL_COMPLIANCE" },
        evidence_requirements: [],
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash8",
        status: "active",
      };

      const resApproval = await deterministicAdapter.evaluate({ artifact: baseline, definition: defApproval });
      expect(resApproval.passed).toBe(true);

      const defSec: EvalDefinition = {
        eval_definition_id: "def_sec",
        name: "Security Zero Violations",
        family: "safety",
        version: 1,
        target_scope: "RUN",
        grader_type: "deterministic",
        severity: "critical",
        required: true,
        grader_config: { type: "SECURITY_VIOLATION_COUNT", max_violations: 0 },
        evidence_requirements: [],
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash9",
        status: "active",
      };

      const resSec = await deterministicAdapter.evaluate({ artifact: baseline, definition: defSec });
      expect(resSec.passed).toBe(true);
    });

    it("grades COST_BUDGET, LATENCY_BUDGET, and TOKEN_BUDGET", async () => {
      const defCost: EvalDefinition = {
        eval_definition_id: "def_cost",
        name: "Cost Within Budget",
        family: "cost",
        version: 1,
        target_scope: "RUN",
        grader_type: "deterministic",
        severity: "warning",
        required: false,
        grader_config: { type: "COST_BUDGET", max_usd: 0.5 },
        evidence_requirements: [],
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash10",
        status: "active",
      };

      const resCost = await deterministicAdapter.evaluate({ artifact: baseline, definition: defCost });
      expect(resCost.passed).toBe(true);

      const defToken: EvalDefinition = {
        eval_definition_id: "def_tokens",
        name: "Context Token Budget",
        family: "context",
        version: 1,
        target_scope: "CONTEXT",
        grader_type: "deterministic",
        severity: "fail",
        required: true,
        grader_config: { type: "TOKEN_BUDGET", max_tokens: 2000 },
        evidence_requirements: ["context"],
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash11",
        status: "active",
      };

      const resToken = await deterministicAdapter.evaluate({ artifact: baseline, definition: defToken });
      expect(resToken.passed).toBe(true);
    });
  });

  describe("2. Missing Evidence Detection & Evaluator Error Handling", () => {
    it("detects missing required evidence and returns MISSING_EVIDENCE without fabricating failure", async () => {
      const artifactWithoutTools: RunArtifact = {
        ...baseline,
        tools: [],
      };

      const defRequiresTools: EvalDefinition = {
        eval_definition_id: "def_requires_tools",
        name: "Tool Requirement",
        family: "tool_selection",
        version: 1,
        target_scope: "TOOL_CALL",
        grader_type: "deterministic",
        severity: "fail",
        required: true,
        grader_config: { type: "TOOL_ARGUMENT_ASSERTION", tool_name: "test_tool", argument_key: "arg" },
        evidence_requirements: ["tool_call"],
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash12",
        status: "active",
      };

      const result = await deterministicAdapter.evaluate({
        artifact: artifactWithoutTools,
        definition: defRequiresTools,
      });

      expect(result.grader_status).toBe("MISSING_EVIDENCE");
      expect(result.findings[0]).toContain("Missing required evidence");
    });

    it("evaluator error does not masquerade as agent failure", async () => {
      const defMalformed: EvalDefinition = {
        eval_definition_id: "def_malformed",
        name: "Unknown Assertion",
        family: "task_success",
        version: 1,
        target_scope: "RUN",
        grader_type: "deterministic",
        severity: "fail",
        required: true,
        grader_config: { type: "UNKNOWN_ASSERTION_XYZ" },
        evidence_requirements: [],
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash13",
        status: "active",
      };

      const result = await deterministicAdapter.evaluate({ artifact: baseline, definition: defMalformed });
      expect(result.grader_status).toBe("EVALUATOR_ERROR");
      expect(result.findings[0]).toContain("Unknown structured assertion");
    });
  });

  describe("3. Model-Based Grader (LLM-as-a-Judge) & Provenance", () => {
    it("grades with structured rubric, tracks model provenance, and records latency/cost", async () => {
      const mockJudge = new ModelJudgeEvaluatorAdapter(async (input) => {
        expect(input.model).toBe("gpt-4o");
        expect(input.rubric).toContain("Helpfulness");
        return {
          score: 0.92,
          passed: true,
          explanation: "Answer directly addressed user question with high clarity.",
          findings: ["Clear policy summary", "Accurate refund numbers"],
          cost_usd: 0.0018,
          tokens: { prompt: 180, completion: 45, total: 225 },
        };
      });

      const defModel: EvalDefinition = {
        eval_definition_id: "def_model_helpfulness",
        name: "Helpfulness Model Judge",
        family: "output_validity",
        version: 1,
        target_scope: "RUN",
        grader_type: "model_based",
        threshold: 0.8,
        severity: "fail",
        required: true,
        grader_config: {
          provider: "openai",
          model: "gpt-4o",
          rubric: "Helpfulness and accuracy of response",
        },
        evidence_requirements: ["final_outcome"],
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash14",
        status: "active",
      };

      const result = await mockJudge.evaluate({ artifact: baseline, definition: defModel });
      expect(result.passed).toBe(true);
      expect(result.score).toBe(0.92);
      expect(result.grader_status).toBe("PASSED");
      expect(result.grader_cost_usd).toBe(0.0018);
      expect(result.grader_model_provenance?.model).toBe("gpt-4o");
      expect(result.grader_model_provenance?.provider).toBe("openai");
      expect(result.grader_tokens?.total).toBe(225);
    });

    it("model judge failure (invalid schema / crash) produces EVALUATOR_ERROR, not agent failure", async () => {
      const failingJudge = new ModelJudgeEvaluatorAdapter(async () => {
        throw new Error("503 Model judge service unavailable");
      });

      const defModel: EvalDefinition = {
        eval_definition_id: "def_model_fail",
        name: "Model Judge",
        family: "output_validity",
        version: 1,
        target_scope: "RUN",
        grader_type: "model_based",
        threshold: 0.8,
        severity: "fail",
        required: true,
        grader_config: { provider: "openai", model: "gpt-4o" },
        evidence_requirements: ["final_outcome"],
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash15",
        status: "active",
      };

      const result = await failingJudge.evaluate({ artifact: baseline, definition: defModel });
      expect(result.grader_status).toBe("EVALUATOR_ERROR");
      expect(result.findings[0]).toContain("503 Model judge service unavailable");
    });
  });

  describe("4. Eval Suite Pass Policies & Critical Gate Override", () => {
    it("fails suite immediately if a critical gate fails, even if average score is high", () => {
      const suite: EvalSuite = {
        suite_id: "suite_safety_strict",
        name: "Safety Strict Suite",
        version: 1,
        definitions: [],
        required_eval_ids: [],
        optional_eval_ids: [],
        pass_policy: {
          mode: "WEIGHTED_SCORE",
          minimum_weighted_score: 0.8,
          critical_eval_ids: ["safety_critical_gate"],
        },
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "hash_suite_1",
      };

      const results: any[] = [
        { eval_id: "e1", eval_definition_id: "quality_eval", passed: true, score: 0.98, severity: "info" },
        { eval_id: "e2", eval_definition_id: "speed_eval", passed: true, score: 0.95, severity: "info" },
        { eval_id: "e3", eval_definition_id: "safety_critical_gate", passed: false, score: 0.0, severity: "critical" },
      ];

      const summary = computeEvaluationSummary(suite, results);
      expect(summary.suite_verdict).toBe("FAILED");
      expect(summary.critical_failures).toContain("safety_critical_gate");
      expect(summary.verdict_reason).toContain("Critical evaluation failure");
    });

    it("evaluates historical run and enriches artifact with canonical evals and verification events", async () => {
      const suite: EvalSuite = {
        suite_id: "support-release-test",
        name: "Release Suite",
        version: 1,
        definitions: [
          {
            eval_definition_id: "task_success",
            name: "Task Success",
            family: "task_success",
            version: 1,
            target_scope: "RUN",
            grader_type: "deterministic",
            severity: "critical",
            required: true,
            grader_config: { type: "OUTCOME_STATUS", expected_status: "SUCCESS" },
            evidence_requirements: ["final_outcome"],
            created_at: "2026-10-12T00:00:00Z",
            content_hash: "h1",
            status: "active",
          },
        ],
        required_eval_ids: ["task_success"],
        optional_eval_ids: [],
        pass_policy: { mode: "ALL_REQUIRED_PASS" },
        created_at: "2026-10-12T00:00:00Z",
        content_hash: "h_suite",
      };

      const evalRun = await evaluateRun(baseline, suite, { persist: false });
      expect(evalRun.status).toBe("COMPLETED");
      expect(evalRun.summary.suite_verdict).toBe("PASSED");
      expect(evalRun.results).toHaveLength(1);

      // Verify enrichment
      const enriched = await enrichRunArtifactWithEvals(baseline, evalRun.results, {
        evaluation_run_id: evalRun.evaluation_run_id,
        suite_id: suite.suite_id,
        persist: false,
      });

      expect(enriched.evals.some((e) => e.eval_definition_id === "task_success")).toBe(true);
      expect(enriched.observability.evals_passed).toBeGreaterThanOrEqual(1);
      expect(enriched.evidence?.verification_events?.some((v) => v.event_type === "eval.passed")).toBe(true);
    });
  });
});
