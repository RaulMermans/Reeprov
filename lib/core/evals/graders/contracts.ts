/**
 * Evaluator Adapter & Grader Contracts.
 *
 * Defines the pluggable EvaluatorAdapter contract, evaluation inputs,
 * and structured assertion types for deterministic, model-based, and human graders.
 */

import type { RunArtifact } from "../../contracts/runArtifact";
import type { RunComparison } from "../../contracts/comparison";
import type { EvalDefinition, EvalTargetScope } from "../../contracts/evalDefinitions";
import type { EvalResult, EvalFamily, GraderType } from "../../contracts/evals";

export interface EvalInput {
  artifact: RunArtifact;
  definition: EvalDefinition;
  comparison?: RunComparison;
  target_step_id?: string;
  target_node_id?: string;
  options?: Record<string, unknown>;
}

export interface EvaluatorAdapter {
  evaluator_id: string;
  evaluator_version: string;
  grader_type: GraderType;
  supported_families: EvalFamily[];
  supported_target_scopes: EvalTargetScope[];
  deterministic: boolean;
  requires_model: boolean;
  requires_human: boolean;
  evaluate(input: EvalInput): Promise<EvalResult>;
}
