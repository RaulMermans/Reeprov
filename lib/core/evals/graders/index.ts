/**
 * Evaluator Adapters Registry.
 */

import type { EvaluatorAdapter } from "./contracts";
import type { GraderType } from "../../contracts/evals";
import { DeterministicEvaluatorAdapter } from "./deterministic";
import { ModelJudgeEvaluatorAdapter } from "./modelJudge";
import { HumanEvaluatorAdapter } from "./humanReview";

export * from "./contracts";
export * from "./deterministic";
export * from "./modelJudge";
export * from "./humanReview";

const defaultDeterministic = new DeterministicEvaluatorAdapter();
const defaultModelJudge = new ModelJudgeEvaluatorAdapter();
const defaultHuman = new HumanEvaluatorAdapter();

const adapterRegistry = new Map<string, EvaluatorAdapter>([
  [defaultDeterministic.evaluator_id, defaultDeterministic],
  [defaultModelJudge.evaluator_id, defaultModelJudge],
  [defaultHuman.evaluator_id, defaultHuman],
]);

export function getEvaluatorAdapterForGraderType(
  type: GraderType
): EvaluatorAdapter {
  switch (type) {
    case "deterministic":
      return defaultDeterministic;
    case "model_based":
      return defaultModelJudge;
    case "human":
      return defaultHuman;
    default:
      return defaultDeterministic;
  }
}

export function registerEvaluatorAdapter(adapter: EvaluatorAdapter): void {
  adapterRegistry.set(adapter.evaluator_id, adapter);
}

export function getEvaluatorAdapter(evaluatorId: string): EvaluatorAdapter | undefined {
  return adapterRegistry.get(evaluatorId);
}
