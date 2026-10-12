/**
 * Experiment Planner.
 *
 * Validates experiment configurations, generates bounded experiment matrices,
 * and detects combinatorial explosion and variable isolation risks.
 *
 * Principles:
 * - Deterministic matrix-size preflight check before execution.
 * - Enforces max_arms and max_trials limits.
 * - Flags unsupported experimental variables.
 * - Encourages single-variable experiments (identifies multi-variable causal confounding).
 */

import {
  type ExperimentDefinition,
  type ExperimentArm,
  type ExperimentVariable,
  experimentArmSchema,
} from "../contracts/experiment";
import type { ExperimentMutation } from "../contracts/lineage";
import { hashPayload } from "../capture/hashing";

export interface PlanValidationResult {
  valid: boolean;
  total_arms: number;
  total_trials: number;
  unsupported_variables: string[];
  single_variable: boolean;
  warnings: string[];
  errors: string[];
  arms: ExperimentArm[];
}

const SUPPORTED_VARIABLE_TYPES = new Set([
  "prompt",
  "model",
  "model_parameters",
  "state_patch",
  "tool_result_override",
  "context_exclusion",
  "memory_exclusion",
]);

export class ExperimentPlanner {
  /**
   * Validates and plans the experiment arms and execution matrix.
   */
  static plan(definition: ExperimentDefinition): PlanValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const unsupported_variables: string[] = [];

    // 1. Validate variables
    for (const v of definition.variables) {
      if (!SUPPORTED_VARIABLE_TYPES.has(v.type)) {
        unsupported_variables.push(`${v.name} (${v.type})`);
        errors.push(
          `Variable "${v.name}" uses unsupported type "${v.type}". Supported types: ${Array.from(SUPPORTED_VARIABLE_TYPES).join(", ")}`
        );
      }
    }

    // 2. Generate or validate arms
    let arms: ExperimentArm[] = [];
    if (definition.arms && definition.arms.length > 0) {
      // User specified explicit arms
      arms = definition.arms.map((a) => experimentArmSchema.parse(a));
    } else if (definition.variables.length > 0) {
      // Generate arms from variable cartesian product
      arms = this.generateArmsFromVariables(definition);
    } else {
      errors.push("Experiment has neither explicit arms nor variables to generate arms from.");
    }

    // Ensure there is at least one baseline arm
    const hasBaseline = arms.some((a) => a.is_baseline);
    if (!hasBaseline && arms.length > 0) {
      // Treat first arm or empty mutation arm as baseline
      const emptyArm = arms.find((a) => a.mutations.length === 0);
      if (emptyArm) {
        emptyArm.is_baseline = true;
      } else {
        arms[0]!.is_baseline = true;
      }
    }

    const repetitions = definition.repetitions || 1;
    const totalArms = arms.length;
    const totalTrials = totalArms * repetitions;

    // 3. Enforce budget matrix bounds
    const maxArms = definition.budget.max_trials; // Arms cannot exceed max_trials
    if (totalArms > maxArms) {
      errors.push(
        `Experiment requested ${totalArms} arms, which exceeds the configured max limit of ${maxArms}.`
      );
    }

    if (totalTrials > definition.budget.max_trials) {
      errors.push(
        `Total requested trials (${totalTrials} = ${totalArms} arms × ${repetitions} reps) exceeds max_trials budget (${definition.budget.max_trials}).`
      );
    }

    // 4. Single variable check & causal warnings
    const single_variable = definition.variables.length <= 1;
    if (!single_variable) {
      warnings.push(
        "Multi-variable experiment detected: changing multiple variables simultaneously weakens causal attribution."
      );
    }

    if (repetitions === 1) {
      warnings.push(
        "Single trial per arm (repetitions = 1): repeatability for stochastic models cannot be established."
      );
    }

    return {
      valid: errors.length === 0,
      total_arms: totalArms,
      total_trials: totalTrials,
      unsupported_variables,
      single_variable,
      warnings,
      errors,
      arms,
    };
  }

  private static generateArmsFromVariables(
    definition: ExperimentDefinition
  ): ExperimentArm[] {
    const arms: ExperimentArm[] = [];

    // Always include baseline arm
    arms.push({
      arm_id: "arm_baseline",
      name: "Baseline",
      mutations: [],
      is_baseline: true,
      configuration_hash: hashPayload({ baseline: true, run_id: definition.baseline_run_id }),
      expected_change_summary: "Unmodified baseline execution",
    });

    for (const v of definition.variables) {
      for (let i = 0; i < v.values.length; i++) {
        const val = v.values[i];
        const armId = `arm_${v.variable_id}_${i + 1}`;
        const mutation: ExperimentMutation = {
          mutation_id: `mut_${armId}`,
          mutation_type: v.type as ExperimentMutation["mutation_type"],
          target_identifier: v.target_identifier ?? v.name,
          description: `Mutate ${v.name} to ${JSON.stringify(val)}`,
          mutated_value: val,
        };

        arms.push({
          arm_id: armId,
          name: `${v.name}: ${typeof val === "object" ? JSON.stringify(val) : String(val)}`,
          mutations: [mutation],
          is_baseline: false,
          configuration_hash: hashPayload({ variable: v.variable_id, val }),
          expected_change_summary: `Testing variation of ${v.name}`,
        });
      }
    }

    return arms;
  }
}
