import { describe, it, expect } from "vitest";
import { ExperimentPlanner } from "../planner";
import { ExperimentBudgetGovernor } from "../budgetGovernor";
import type { ExperimentDefinition } from "../../contracts/experiment";

describe("Sprint 8: Experiment Planner & Budget Governor", () => {
  const baseDef: ExperimentDefinition = {
    experiment_id: "exp_test_plan",
    name: "Customer Support Prompt & Context Experiment",
    version: 1,
    baseline_run_id: "run_ctx_ablation_baseline",
    checkpoint_id: "ckpt_decision_01",
    variables: [
      {
        name: "prompt_version",
        type: "prompt",
        description: "Prompt revision",
        values: ["v1", "v2"],
      },
    ],
    arms: [],
    repetitions: 2,
    budget: {
      max_cost_usd: 1.0,
      max_trials: 10,
      max_model_calls: 20,
      max_duration_ms: 60000,
    },
    winner_policy: {
      type: "HIGHEST_SCORE_UNDER_BUDGET",
      hard_gates: ["def_approval", "def_sec"],
      target_metric: "task_success",
    },
    created_at: "2026-10-12T00:00:00Z",
    content_hash: "hash_plan_1",
    status: "draft",
  };

  describe("1. ExperimentPlanner", () => {
    it("generates arms from single variable with baseline arm assigned", () => {
      const plan = ExperimentPlanner.plan(baseDef);

      expect(plan.valid).toBe(true);
      expect(plan.total_arms).toBe(3); // 1 baseline + 2 variants
      expect(plan.total_trials).toBe(6); // 3 arms * 2 repetitions
      expect(plan.single_variable).toBe(true);
      expect(plan.arms.length).toBe(3);
      expect(plan.arms.some((a) => a.is_baseline)).toBe(true);
      expect(plan.errors).toHaveLength(0);
    });

    it("detects and flags unsupported variable types", () => {
      const invalidDef: ExperimentDefinition = {
        ...baseDef,
        variables: [
          {
            name: "unsupported_runtime_mutation",
            type: "arbitrary_executable_code" as any,
            values: ["code1"],
          },
        ],
      };

      const plan = ExperimentPlanner.plan(invalidDef);
      expect(plan.valid).toBe(false);
      expect(plan.unsupported_variables.length).toBeGreaterThan(0);
      expect(plan.errors.some((e) => e.includes("unsupported type"))).toBe(true);
    });

    it("detects combinatorial explosion and rejects when trials exceed budget", () => {
      const explosiveDef: ExperimentDefinition = {
        ...baseDef,
        variables: [
          { name: "prompt", type: "prompt", values: ["v1", "v2", "v3", "v4"] },
          { name: "context", type: "context_exclusion", values: ["drop_old", "drop_all"] },
          { name: "model", type: "model", values: ["m1", "m2", "m3"] },
        ],
        repetitions: 5,
        budget: {
          max_cost_usd: 1.0,
          max_trials: 10,
          max_model_calls: 20,
          max_duration_ms: 60000,
        },
      };

      const plan = ExperimentPlanner.plan(explosiveDef);
      expect(plan.valid).toBe(false);
      expect(plan.errors.some((e) => e.includes("exceeds max_trials budget") || e.includes("exceeds the configured max limit"))).toBe(true);
    });

    it("warns about multi-variable confounding when multiple variables are combined", () => {
      const multiVarDef: ExperimentDefinition = {
        ...baseDef,
        variables: [
          { name: "prompt", type: "prompt", values: ["v1", "v2"] },
          { name: "model", type: "model", values: ["gpt-4o", "claude-3-5"] },
        ],
        repetitions: 1,
        budget: {
          max_cost_usd: 5.0,
          max_trials: 20,
          max_model_calls: 50,
          max_duration_ms: 60000,
        },
      };

      const plan = ExperimentPlanner.plan(multiVarDef);
      expect(plan.valid).toBe(true);
      expect(plan.single_variable).toBe(false);
      expect(plan.warnings.some((w) => w.includes("causal attribution"))).toBe(true);
    });
  });

  describe("2. ExperimentBudgetGovernor", () => {
    it("permits trials within limits and stops cleanly when max_trials is reached", () => {
      const governor = new ExperimentBudgetGovernor({
        max_cost_usd: 10.0,
        max_trials: 3,
        max_model_calls: 10,
        max_duration_ms: 60000,
      });

      expect(governor.canStartTrial().allowed).toBe(true);
      governor.recordTrialStart();
      governor.recordTrialCompletion({ candidate_cost: 0.05, grader_cost: 0.01 });

      expect(governor.canStartTrial().allowed).toBe(true);
      governor.recordTrialStart();
      governor.recordTrialCompletion({ candidate_cost: 0.05, grader_cost: 0.01 });

      expect(governor.canStartTrial().allowed).toBe(true);
      governor.recordTrialStart();
      governor.recordTrialCompletion({ candidate_cost: 0.05, grader_cost: 0.01 });

      // 4th trial exceeds max_trials: 3
      const check = governor.canStartTrial();
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain("Maximum trials limit reached");
      expect(governor.isExceeded()).toBe(true);
      expect(governor.getExceededReason()).toContain("Maximum trials limit reached");
    });

    it("separately tracks candidate costs vs grader costs and enforces cost cap", () => {
      const governor = new ExperimentBudgetGovernor({
        max_cost_usd: 0.20,
        max_trials: 10,
        max_model_calls: 50,
        max_duration_ms: 60000,
      });

      governor.recordTrialStart();
      governor.recordTrialCompletion({ candidate_cost: 0.12, grader_cost: 0.03 }); // Total 0.15

      expect(governor.canStartTrial().allowed).toBe(true);

      governor.recordTrialStart();
      governor.recordTrialCompletion({ candidate_cost: 0.05, grader_cost: 0.02 }); // Total 0.22 >= 0.20

      const check = governor.canStartTrial();
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain("Cost budget limit reached");

      const consumption = governor.getConsumption();
      expect(consumption.candidate_cost_usd).toBeCloseTo(0.17, 3);
      expect(consumption.grader_cost_usd).toBeCloseTo(0.05, 3);
      expect(consumption.cost_usd).toBeCloseTo(0.22, 3);
      expect(consumption.trials_executed).toBe(2);
    });

    it("enforces max_model_calls budget limit", () => {
      const governor = new ExperimentBudgetGovernor({
        max_cost_usd: 10.0,
        max_trials: 10,
        max_model_calls: 4,
        max_duration_ms: 60000,
      });

      governor.recordTrialStart();
      governor.recordTrialCompletion({ candidate_cost: 0.01, grader_cost: 0.01, model_calls: 4 });

      const check = governor.canStartTrial();
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain("Model calls limit reached");
    });
  });
});
