/**
 * Human Evaluator Adapter.
 *
 * Implements recording of structured human reviewer ratings, rubrics, and decisions.
 * A minimal, clean entry surface for human evaluation.
 */

import type { EvaluatorAdapter, EvalInput } from "./contracts";
import type { EvalResult, EvalFamily } from "../../contracts/evals";
import type { EvalTargetScope } from "../../contracts/evalDefinitions";

export interface HumanReviewPayload {
  reviewer_id: string;
  reviewer_role?: string;
  rubric: string;
  score: number;
  decision: "APPROVED" | "REJECTED" | "NEEDS_REVISION";
  notes?: string;
  findings?: string[];
  evidence_references?: string[];
  timestamp?: string;
}

export class HumanEvaluatorAdapter implements EvaluatorAdapter {
  readonly evaluator_id = "agentpulse_human_evaluator";
  readonly evaluator_version = "1.0.0";
  readonly grader_type = "human" as const;
  readonly deterministic = false;
  readonly requires_model = false;
  readonly requires_human = true;

  readonly supported_families: EvalFamily[] = [
    "task_success",
    "output_validity",
    "safety",
    "approval_compliance",
  ];

  readonly supported_target_scopes: EvalTargetScope[] = [
    "RUN",
    "STEP",
    "ARTIFACT",
    "COMPARISON",
  ];

  async evaluate(input: EvalInput): Promise<EvalResult> {
    const startTime = Date.now();
    const { artifact, definition } = input;
    const reviewData = input.options?.["humanReview"] as HumanReviewPayload | undefined;

    const resultTemplate = {
      eval_id: `eval_human_${definition.eval_definition_id}_${artifact.identity.run_id}_${Date.now()}`,
      eval_definition_id: definition.eval_definition_id,
      eval_definition_version: definition.version,
      eval_type: definition.family,
      evaluator_id: reviewData?.reviewer_id ?? this.evaluator_id,
      evaluator_version: this.evaluator_version,
      target_run_id: artifact.identity.run_id,
      target_step_id: input.target_step_id,
      target_node_id: input.target_node_id,
      name: definition.name,
      severity: definition.severity,
      grader_type: this.grader_type,
      timestamp: reviewData?.timestamp ?? new Date().toISOString(),
      evidence_references: reviewData?.evidence_references ?? [],
      findings: reviewData?.findings ?? (reviewData?.notes ? [reviewData.notes] : []),
    };

    if (!reviewData) {
      return {
        ...resultTemplate,
        passed: false,
        score: 0,
        grader_status: "MISSING_EVIDENCE",
        findings: ["Human review entry pending or not submitted."],
        execution_duration_ms: Date.now() - startTime,
      };
    }

    const passed = reviewData.decision === "APPROVED";
    return {
      ...resultTemplate,
      passed,
      score: reviewData.score,
      grader_status: passed ? "PASSED" : "FAILED",
      metadata: {
        reviewer_id: reviewData.reviewer_id,
        reviewer_role: reviewData.reviewer_role,
        decision: reviewData.decision,
        rubric: reviewData.rubric,
      },
      execution_duration_ms: Date.now() - startTime,
    };
  }
}
