/**
 * Experiment Runner Engine.
 *
 * Coordinates execution of controlled agent experiments across candidate arms.
 * Reuses ForkRuntime for candidate runs, evaluates each candidate trial with
 * the specified EvalSuite, runs deterministic comparisons against the baseline,
 * and aggregates evidence to recommend a candidate under explicit winner policy.
 *
 * Invariants:
 * - Reuses ForkRuntime (no secondary execution engine).
 * - Never modifies source/baseline RunArtifacts.
 * - Stops cleanly with BUDGET_EXCEEDED when governor limits are hit.
 * - Separates candidate execution cost and evaluation grader cost.
 * - Never promotes candidates automatically.
 */

import { type RunArtifact } from "../contracts/runArtifact";
import {
  type ExperimentDefinition,
  type ExperimentResult,
  type ExperimentTrial,
  type ExperimentArm,
} from "../contracts/experiment";
import { type EvalSuite, type EvaluationRun } from "../contracts/evalDefinitions";
import { ExperimentPlanner } from "./planner";
import { ExperimentBudgetGovernor } from "./budgetGovernor";
import { ExperimentAggregator, type ArmTrialExecutionData } from "./aggregator";
import { ForkRuntime, type ForkRuntimeOptions } from "../fork/runtime";
import { evaluateRun } from "../evals/runner";
import { compareRuns, saveRunComparison } from "../comparison";
import { getCanonicalRun } from "../capture/persistence";
import { getEvalSuite } from "../evals/persistence";
import { saveExperimentResult, saveExperimentDefinition } from "./persistence";

export interface ExperimentRunOptions {
  baselineArtifact?: RunArtifact;
  evalSuite?: EvalSuite;
  candidateModelHandler?: ForkRuntimeOptions["candidateModelHandler"];
  executeLogic?: ForkRuntimeOptions["executeLogic"];
  hostAdapter?: ForkRuntimeOptions["hostAdapter"];
  judgeHandler?: any;
  persist?: boolean;
}

export class ExperimentRunner {
  /**
   * Executes an ExperimentDefinition and produces an authoritative ExperimentResult.
   */
  static async run(
    definition: ExperimentDefinition,
    options: ExperimentRunOptions = {}
  ): Promise<ExperimentResult> {
    const startedAt = Date.now();

    // 1. Preflight plan & matrix validation
    const plan = ExperimentPlanner.plan(definition);
    if (!plan.valid) {
      throw new Error(`Invalid experiment definition: ${plan.errors.join("; ")}`);
    }

    // Save definition if not already saved
    if (options.persist !== false) {
      await saveExperimentDefinition(definition);
    }

    // 2. Load baseline RunArtifact
    let baseline = options.baselineArtifact;
    if (!baseline) {
      baseline = (await getCanonicalRun(definition.baseline_run_id)) ?? undefined;
    }
    if (!baseline) {
      throw new Error(`Baseline run "${definition.baseline_run_id}" not found.`);
    }

    // 3. Load EvalSuite
    let suite = options.evalSuite;
    if (!suite) {
      suite = (await getEvalSuite(definition.eval_suite_id, definition.eval_suite_version ?? 1)) ?? undefined;
    }
    if (!suite) {
      throw new Error(`EvalSuite "${definition.eval_suite_id}" not found.`);
    }

    // 4. Initialize Budget Governor
    const governor = new ExperimentBudgetGovernor(definition.budget);

    // 5. Execute arms and trials
    const arms = plan.arms;
    const trialsData: ArmTrialExecutionData[] = [];
    const repetitions = definition.repetitions || 1;
    let experimentStatus: "COMPLETED" | "BUDGET_EXCEEDED" | "FAILED" = "COMPLETED";

    // Locate default checkpoint
    const checkpointId =
      definition.checkpoint_id ??
      baseline.checkpoints[0]?.checkpoint_id ??
      "chk_initial";

    trialLoop: for (let rep = 0; rep < repetitions; rep++) {
      for (const arm of arms) {
        // Budget Check
        const budgetCheck = governor.canStartTrial();
        if (!budgetCheck.allowed) {
          experimentStatus = "BUDGET_EXCEEDED";
          break trialLoop;
        }

        governor.recordTrialStart();
        const trialId = `trial_${arm.arm_id}_rep${rep + 1}_${Date.now()}`;
        const trialStartTime = Date.now();

        try {
          if (arm.is_baseline) {
            // Baseline arm: evaluate existing baseline run
            const evalRun = await evaluateRun(baseline, suite, {
              evaluationRunId: `evrun_${trialId}`,
              enrichArtifact: false,
              persist: options.persist !== false,
              judgeHandler: options.judgeHandler,
            });

            const trial: ExperimentTrial = {
              trial_id: trialId,
              experiment_id: definition.experiment_id,
              arm_id: arm.arm_id,
              repetition_index: rep,
              derived_run_id: baseline.identity.run_id,
              status: "COMPLETED",
              eval_run_id: evalRun.evaluation_run_id,
              candidate_cost_usd: 0,
              grader_cost_usd: evalRun.cost_usd,
              duration_ms: Date.now() - trialStartTime,
              started_at: new Date(trialStartTime).toISOString(),
              completed_at: new Date().toISOString(),
              errors: [],
            };

            governor.recordTrialCompletion({
              candidate_cost: 0,
              grader_cost: evalRun.cost_usd,
              model_calls: 0,
            });

            trialsData.push({ trial, evalRun });
          } else {
            // Candidate arm: Fork execution via ForkRuntime
            const forkRuntime = new ForkRuntime(baseline, checkpointId, {
              forkId: `run_${trialId}`,
              mutations: arm.mutations,
              persist: options.persist !== false,
              candidateModelHandler: options.candidateModelHandler,
              executeLogic: options.executeLogic,
              hostAdapter: options.hostAdapter,
            });

            const forkResult = await forkRuntime.fork();

            if (forkResult.status !== "COMPLETED" || !forkResult.child_artifact) {
              const trial: ExperimentTrial = {
                trial_id: trialId,
                experiment_id: definition.experiment_id,
                arm_id: arm.arm_id,
                repetition_index: rep,
                derived_run_id: forkResult.derived_run_id,
                status: "FAILED",
                candidate_cost_usd: 0,
                grader_cost_usd: 0,
                duration_ms: Date.now() - trialStartTime,
                started_at: new Date(trialStartTime).toISOString(),
                completed_at: new Date().toISOString(),
                errors: forkResult.errors ?? ["Fork execution did not complete"],
              };

              governor.recordTrialCompletion({
                candidate_cost: 0,
                grader_cost: 0,
                model_calls: 0,
              });

              trialsData.push({ trial });
              continue;
            }

            const candidateArtifact = forkResult.child_artifact;

            // Post-hoc evaluation of candidate artifact
            const evalRun = await evaluateRun(candidateArtifact, suite, {
              evaluationRunId: `evrun_${trialId}`,
              enrichArtifact: true,
              persist: options.persist !== false,
              judgeHandler: options.judgeHandler,
            });

            // Compare candidate to baseline
            const comparison = await compareRuns(baseline, candidateArtifact);
            if (options.persist !== false) {
              await saveRunComparison(comparison);
            }

            const candidateCost = candidateArtifact.observability.total_cost_usd ?? 0;
            const graderCost = evalRun.cost_usd;

            const trial: ExperimentTrial = {
              trial_id: trialId,
              experiment_id: definition.experiment_id,
              arm_id: arm.arm_id,
              repetition_index: rep,
              derived_run_id: candidateArtifact.identity.run_id,
              status: "COMPLETED",
              eval_run_id: evalRun.evaluation_run_id,
              comparison_id: comparison.comparison_id,
              candidate_cost_usd: candidateCost,
              grader_cost_usd: graderCost,
              duration_ms: Date.now() - trialStartTime,
              started_at: new Date(trialStartTime).toISOString(),
              completed_at: new Date().toISOString(),
              errors: [],
            };

            governor.recordTrialCompletion({
              candidate_cost: candidateCost,
              grader_cost: graderCost,
              model_calls: candidateArtifact.observability.model_calls_count,
            });

            trialsData.push({ trial, evalRun });
          }
        } catch (err: any) {
          const trial: ExperimentTrial = {
            trial_id: trialId,
            experiment_id: definition.experiment_id,
            arm_id: arm.arm_id,
            repetition_index: rep,
            derived_run_id: `error_run_${Date.now()}`,
            status: "FAILED",
            candidate_cost_usd: 0,
            grader_cost_usd: 0,
            duration_ms: Date.now() - trialStartTime,
            started_at: new Date(trialStartTime).toISOString(),
            completed_at: new Date().toISOString(),
            errors: [err.message ?? String(err)],
          };

          governor.recordTrialCompletion({
            candidate_cost: 0,
            grader_cost: 0,
          });

          trialsData.push({ trial });
        }
      }
    }

    // 6. Aggregate trials and evaluate winner policy
    const consumption = governor.getConsumption();
    const result = ExperimentAggregator.aggregate(
      definition,
      arms,
      trialsData,
      consumption,
      experimentStatus
    );

    // 7. Persist experiment result
    if (options.persist !== false) {
      await saveExperimentResult(result);
    }

    return result;
  }
}
