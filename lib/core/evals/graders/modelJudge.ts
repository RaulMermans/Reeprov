/**
 * Model-Based Evaluator Adapter (LLM-as-a-Judge).
 *
 * Implements structured, reproducible model-based evaluation with full provenance.
 *
 * Requirements:
 * - Structured rubric with score scale and pass threshold.
 * - Grader model provenance (provider, model, revision, prompt_hash, config_hash).
 * - Grader latency, tokens, and cost tracking.
 * - Evaluator failure policy: timeout, invalid schema, or unavailability produces
 *   EVALUATOR_ERROR, never FAILED.
 * - Model graders never override deterministic failures.
 * - No hidden chain-of-thought storage.
 */

import type { EvaluatorAdapter, EvalInput } from "./contracts";
import type { EvalResult, EvalFamily } from "../../contracts/evals";
import type { EvalTargetScope } from "../../contracts/evalDefinitions";
import { hashPayload } from "../../capture/hashing";

export interface ModelJudgeHandlerInput {
  provider: string;
  model: string;
  revision?: string;
  temperature?: number;
  prompt: string;
  rubric: string;
  targetContent: string;
  schema: Record<string, unknown>;
}

export interface ModelJudgeHandlerOutput {
  score: number;
  passed: boolean;
  explanation: string;
  findings?: string[];
  evidence_references?: string[];
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost_usd?: number;
}

export type ModelJudgeFn = (
  input: ModelJudgeHandlerInput
) => Promise<ModelJudgeHandlerOutput>;

export class ModelJudgeEvaluatorAdapter implements EvaluatorAdapter {
  readonly evaluator_id = "agentpulse_model_judge_evaluator";
  readonly evaluator_version = "1.0.0";
  readonly grader_type = "model_based" as const;
  readonly deterministic = false;
  readonly requires_model = true;
  readonly requires_human = false;

  readonly supported_families: EvalFamily[] = [
    "task_success",
    "output_validity",
    "retrieval",
    "context",
    "memory",
    "safety",
    "model_benchmark",
  ];

  readonly supported_target_scopes: EvalTargetScope[] = [
    "RUN",
    "STEP",
    "MODEL_CALL",
    "ARTIFACT",
    "COMPARISON",
  ];

  constructor(private readonly judgeHandler?: ModelJudgeFn) {}

  async evaluate(input: EvalInput): Promise<EvalResult> {
    const startTime = Date.now();
    const { artifact, definition } = input;
    const config = definition.grader_config ?? {};

    const provider = String(config["provider"] ?? "openai");
    const model = String(config["model"] ?? "gpt-4o");
    const revision = config["revision"] ? String(config["revision"]) : undefined;
    const temperature = typeof config["temperature"] === "number" ? config["temperature"] : 0.0;
    const rubric = String(config["rubric"] ?? "Evaluate response quality according to task criteria.");
    const threshold = typeof definition.threshold === "number" ? definition.threshold : 0.7;
    const promptHash = hashPayload({ rubric, config });
    const configHash = hashPayload(config);

    const resultTemplate = {
      eval_id: `eval_judge_${definition.eval_definition_id}_${artifact.identity.run_id}_${Date.now()}`,
      eval_definition_id: definition.eval_definition_id,
      eval_definition_version: definition.version,
      eval_type: definition.family,
      evaluator_id: this.evaluator_id,
      evaluator_version: this.evaluator_version,
      target_run_id: artifact.identity.run_id,
      target_step_id: input.target_step_id,
      target_node_id: input.target_node_id,
      name: definition.name,
      severity: definition.severity,
      grader_type: this.grader_type,
      threshold,
      grader_config_hash: configHash,
      timestamp: new Date().toISOString(),
      grader_model_provenance: {
        provider,
        model,
        revision,
        prompt_hash: promptHash,
        config_hash: configHash,
        temperature,
      },
      evidence_references: [] as string[],
      findings: [] as string[],
    };

    // Extract content to evaluate
    const targetContent = this.extractTargetContent(artifact);
    if (!targetContent) {
      return {
        ...resultTemplate,
        passed: false,
        score: 0,
        grader_status: "MISSING_EVIDENCE",
        findings: ["Target content for model evaluation is empty or unavailable."],
        execution_duration_ms: Date.now() - startTime,
      };
    }

    const handler = (input.options?.["judgeHandler"] as ModelJudgeFn | undefined) ?? this.judgeHandler;
    if (!handler) {
      return {
        ...resultTemplate,
        passed: false,
        score: 0,
        grader_status: "EVALUATOR_ERROR",
        findings: ["No model judge handler configured. Live model calls require explicit handler policy."],
        execution_duration_ms: Date.now() - startTime,
      };
    }

    try {
      const judgeResponse = await handler({
        provider,
        model,
        revision,
        temperature,
        prompt: `Evaluate the following output according to this rubric: ${rubric}`,
        rubric,
        targetContent,
        schema: {
          score: "number (0.0 to 1.0)",
          passed: "boolean",
          explanation: "string (bounded explanation)",
        },
      });

      // Validate schema
      if (typeof judgeResponse.score !== "number" || isNaN(judgeResponse.score)) {
        return {
          ...resultTemplate,
          passed: false,
          score: 0,
          grader_status: "EVALUATOR_ERROR",
          findings: ["Invalid grader response: score is not a valid number."],
          execution_duration_ms: Date.now() - startTime,
        };
      }

      const score = Math.max(0, Math.min(1, judgeResponse.score));
      const passed = judgeResponse.passed ?? (score >= threshold);

      return {
        ...resultTemplate,
        passed,
        score,
        grader_status: passed ? "PASSED" : "FAILED",
        findings: judgeResponse.findings ?? [judgeResponse.explanation],
        recommendation: passed ? undefined : `Review failure: ${judgeResponse.explanation}`,
        evidence_references: judgeResponse.evidence_references ?? [],
        grader_cost_usd: judgeResponse.cost_usd ?? 0.001,
        grader_tokens: judgeResponse.tokens ?? { prompt: 150, completion: 50, total: 200 },
        execution_duration_ms: Date.now() - startTime,
      };
    } catch (err: any) {
      // Infrastructure or model error -> record EVALUATOR_ERROR, NOT FAILED
      return {
        ...resultTemplate,
        passed: false,
        score: 0,
        grader_status: "EVALUATOR_ERROR",
        findings: [`Model judge failed with error: ${err.message ?? String(err)}`],
        execution_duration_ms: Date.now() - startTime,
      };
    }
  }

  private extractTargetContent(artifact: EvalInput["artifact"]): string {
    const outcome = artifact.evidence?.final_outcome;
    if (outcome?.summary) return outcome.summary;
    if (outcome?.payload) {
      return typeof outcome.payload === "string"
        ? outcome.payload
        : JSON.stringify(outcome.payload);
    }
    const lastStep = artifact.trajectory[artifact.trajectory.length - 1];
    return lastStep?.output_summary ?? "";
  }
}
