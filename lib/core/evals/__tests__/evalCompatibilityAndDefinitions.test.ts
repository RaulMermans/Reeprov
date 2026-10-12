import { describe, it, expect } from "vitest";
import {
  evalDefinitionSchema,
  computeEvalDefinitionHash,
  type EvalDefinition,
} from "../../contracts/evalDefinitions";
import {
  evalResultSchema,
  type EvalResult,
  type EvalFamily,
} from "../../contracts/evals";
import {
  canonicalToLegacyEvalResult,
  legacyToCanonicalEvalResult,
  canonicalFamilyToLegacyType,
} from "../compatibility";

describe("Sprint 8: Canonical Eval Definitions & Compatibility", () => {
  describe("1. Canonical EvalDefinition Contract & Versioning", () => {
    it("validates well-formed EvalDefinition and computes deterministic content hash", () => {
      const def: Omit<EvalDefinition, "content_hash"> = {
        eval_definition_id: "def_task_success",
        name: "Task Success Metric",
        family: "task_success",
        version: 1,
        target_scope: "RUN",
        grader_type: "deterministic",
        severity: "critical",
        required: true,
        grader_config: { type: "OUTCOME_STATUS", expected_status: "SUCCESS" },
        evidence_requirements: ["final_outcome"],
        created_at: "2026-10-12T00:00:00Z",
        status: "active",
      };

      const hash1 = computeEvalDefinitionHash(def);
      const hash2 = computeEvalDefinitionHash(def);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^sha256:[a-f0-9]{64}$/);

      const parsed = evalDefinitionSchema.parse({ ...def, content_hash: hash1 });
      expect(parsed.eval_definition_id).toBe("def_task_success");
      expect(parsed.version).toBe(1);
    });

    it("enforces version immutability: changing configuration changes content hash", () => {
      const defV1: Omit<EvalDefinition, "content_hash"> = {
        eval_definition_id: "def_cost_budget",
        name: "Cost Budget",
        family: "cost",
        version: 1,
        target_scope: "RUN",
        grader_type: "deterministic",
        severity: "fail",
        required: false,
        grader_config: { type: "COST_BUDGET", max_usd: 0.1 },
        evidence_requirements: [],
        created_at: "2026-10-12T00:00:00Z",
        status: "active",
      };

      const defV2: Omit<EvalDefinition, "content_hash"> = {
        ...defV1,
        version: 2,
        grader_config: { type: "COST_BUDGET", max_usd: 0.05 },
      };

      const hashV1 = computeEvalDefinitionHash(defV1);
      const hashV2 = computeEvalDefinitionHash(defV2);
      expect(hashV1).not.toBe(hashV2);
    });
  });

  describe("2. Lossless Canonical ↔ Legacy Eval Compatibility", () => {
    const allFamilies: EvalFamily[] = [
      "task_success",
      "output_validity",
      "schema_validity",
      "tool_selection",
      "argument_validity",
      "retrieval",
      "context",
      "memory",
      "trajectory",
      "safety",
      "approval_compliance",
      "regression",
      "cost",
      "latency",
      "model_benchmark",
    ];

    it("never hardcodes canonical evals to 'schema_validity'", () => {
      for (const family of allFamilies) {
        const canonical: EvalResult = {
          eval_id: `eval_${family}_01`,
          eval_type: family,
          evaluator_id: "eval_test",
          target_run_id: "run_test_01",
          name: `Test eval for ${family}`,
          passed: true,
          severity: "fail",
          evidence_references: [],
          grader_type: "deterministic",
          findings: ["Passed cleanly"],
          timestamp: "2026-10-12T00:00:00Z",
        };

        const legacy = canonicalToLegacyEvalResult(canonical);

        // Only actual schema_validity evals should be projected to schema_validity
        if (family !== "schema_validity") {
          expect(legacy.type).not.toBe("schema_validity");
        } else {
          expect(legacy.type).toBe("schema_validity");
        }

        // Canonical family is preserved explicitly
        expect(legacy.canonical_family).toBe(family);
        expect(legacy.metadata?.["canonical_family"]).toBe(family);
      }
    });

    it("preserves exact canonical family across round-trip conversion for every family", () => {
      for (const family of allFamilies) {
        const canonical: EvalResult = {
          eval_id: `eval_roundtrip_${family}`,
          eval_type: family,
          evaluator_id: "eval_adapter_01",
          target_run_id: "run_rt_01",
          name: `Roundtrip ${family}`,
          passed: true,
          severity: "fail",
          evidence_references: [],
          grader_type: "deterministic",
          findings: [`Verified ${family}`],
          timestamp: "2026-10-12T00:00:00Z",
        };

        const legacy = canonicalToLegacyEvalResult(canonical);
        const restored = legacyToCanonicalEvalResult(legacy);

        expect(restored.eval_type).toBe(family);
        expect(restored.eval_id).toBe(canonical.eval_id);
        expect(restored.target_run_id).toBe(canonical.target_run_id);
        expect(restored.passed).toBe(true);
      }
    });
  });

  describe("3. Extended EvalResult Linkages and Provenance", () => {
    it("supports optional definition, suite, case, experiment, and grader provenance fields", () => {
      const detailedResult: EvalResult = {
        eval_id: "eval_full_linkage_01",
        eval_type: "task_success",
        evaluator_id: "model_judge_gpt4o",
        evaluator_version: "1.2.0",
        target_run_id: "run_trial_01",
        name: "Detailed Task Eval",
        passed: true,
        score: 0.95,
        threshold: 0.8,
        metric: "f1_score",
        severity: "critical",
        evidence_references: ["step_01", "tool_02"],
        grader_type: "model_based",
        findings: ["Model adhered completely to customer instructions."],
        timestamp: "2026-10-12T00:00:00Z",

        // Sprint 8 Linkages
        eval_definition_id: "def_task_success",
        eval_definition_version: 1,
        eval_suite_id: "support-release",
        eval_suite_version: 1,
        eval_case_id: "case_01",
        evaluation_run_id: "evrun_01",
        experiment_id: "exp_prompt_01",
        experiment_arm_id: "arm_v8",
        experiment_trial_id: "trial_01",
        grader_status: "PASSED",
        grader_cost_usd: 0.0025,
        grader_tokens: { prompt: 200, completion: 40, total: 240 },
        grader_model_provenance: {
          provider: "openai",
          model: "gpt-4o",
          revision: "2024-08-06",
          prompt_hash: "hash_prompt_rubric_v1",
          temperature: 0.0,
        },
      };

      const parsed = evalResultSchema.parse(detailedResult);
      expect(parsed.eval_definition_id).toBe("def_task_success");
      expect(parsed.experiment_arm_id).toBe("arm_v8");
      expect(parsed.grader_status).toBe("PASSED");
      expect(parsed.grader_cost_usd).toBe(0.0025);
      expect(parsed.grader_model_provenance?.model).toBe("gpt-4o");
    });
  });
});
