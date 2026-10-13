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
import { type EvalSuite, type EvaluationRun, type EvalDataset, type EvalCase } from "../contracts/evalDefinitions";
import { ExperimentPlanner } from "./planner";
import { ExperimentBudgetGovernor } from "./budgetGovernor";
import { ExperimentAggregator, type ArmTrialExecutionData } from "./aggregator";
import { ForkRuntime, type ForkRuntimeOptions } from "../fork/runtime";
import { evaluateRun } from "../evals/runner";
import { compareRuns, saveRunComparison } from "../comparison";
import { getCanonicalRun } from "../capture/persistence";
import { getEvalSuite, getEvalDataset } from "../evals/persistence";
import { saveExperimentResult, saveExperimentDefinition } from "./persistence";

export interface ExperimentRunOptions {
  baselineArtifact?: RunArtifact;
  evalSuite?: EvalSuite;
  evalDataset?: EvalDataset;
  candidateModelHandler?: ForkRuntimeOptions["candidateModelHandler"];
  executeLogic?: ForkRuntimeOptions["executeLogic"];
  hostAdapter?: ForkRuntimeOptions["hostAdapter"];
  judgeHandler?: any;
  persist?: boolean;
}

interface TrialWorkItem {
  arm: ExperimentArm;
  rep: number;
  caseItem?: EvalCase;
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

    // 3b. Load EvalDataset if configured (0.D)
    let dataset: EvalDataset | undefined = options.evalDataset;
    if (definition.dataset_id && !dataset) {
      dataset = (await getEvalDataset(definition.dataset_id, definition.eval_suite_version ?? 1)) ?? undefined;
    }

    // 4. Initialize Budget Governor
    const governor = new ExperimentBudgetGovernor(definition.budget);

    // 5. Build trial execution work items
    const arms = plan.arms;
    const repetitions = definition.repetitions || 1;
    const cases: Array<EvalCase | undefined> = dataset && dataset.cases.length > 0
      ? dataset.cases
      : [undefined];

    const workItems: TrialWorkItem[] = [];
    for (let rep = 0; rep < repetitions; rep++) {
      for (const caseItem of cases) {
        for (const arm of arms) {
          workItems.push({ arm, rep, caseItem });
        }
      }
    }

    // Locate default checkpoint
    const checkpointId =
      definition.checkpoint_id ??
      baseline.checkpoints[0]?.checkpoint_id ??
      "chk_initial";

    let experimentStatus: "COMPLETED" | "PARTIAL" | "BUDGET_EXCEEDED" | "FAILED" | "CANCELLED" = "COMPLETED";
    const completedTrials: ArmTrialExecutionData[] = [];
    const maxConcurrency = Math.max(1, definition.budget.max_concurrency ?? 1);

    // Bounded scheduler respecting max_concurrency and budget reservation (0.E)
    let itemIndex = 0;
    let activeWorkers = 0;
    let budgetExceeded = false;

    await new Promise<void>((resolve) => {
      const dispatch = () => {
        if (budgetExceeded || itemIndex >= workItems.length) {
          if (activeWorkers === 0) resolve();
          return;
        }

        while (activeWorkers < maxConcurrency && itemIndex < workItems.length && !budgetExceeded) {
          const item = workItems[itemIndex++];

          // Budget reservation before launch (0.E)
          const budgetCheck = governor.canStartTrial();
          if (!budgetCheck.allowed) {
            budgetExceeded = true;
            experimentStatus = "BUDGET_EXCEEDED";
            if (activeWorkers === 0) resolve();
            return;
          }

          governor.recordTrialStart();
          activeWorkers++;

          executeItem(item)
            .then((res) => {
              if (res) completedTrials.push(res);
            })
            .catch(() => {
              // Errors recorded in item execution
            })
            .finally(() => {
              activeWorkers--;
              dispatch();
            });
        }
      };

      const executeItem = async (item: TrialWorkItem): Promise<ArmTrialExecutionData> => {
        const { arm, rep, caseItem } = item;
        const caseSuffix = caseItem ? `_case_${caseItem.case_id}` : "";
        const trialId = `trial_${arm.arm_id}${caseSuffix}_rep${rep + 1}_${Date.now()}`;
        const trialStartTime = Date.now();

        // If case has a dedicated source_run_id, use that artifact if available
        let caseBaseline = baseline!;
        if (caseItem?.source_run_id) {
          const loadedCaseRun = await getCanonicalRun(caseItem.source_run_id);
          if (loadedCaseRun) caseBaseline = loadedCaseRun;
        }

        try {
          if (arm.is_baseline) {
            // Baseline arm: evaluate existing baseline run
            const evalRun = await evaluateRun(caseBaseline, suite!, {
              evaluationRunId: `evrun_${trialId}`,
              datasetId: dataset?.dataset_id,
              datasetVersion: dataset?.version,
              enrichArtifact: false,
              persist: options.persist !== false,
              judgeHandler: options.judgeHandler,
            });

            // If case was specified, tag results
            if (caseItem) {
              evalRun.results = evalRun.results.map((r) => ({
                ...r,
                eval_case_id: caseItem.case_id,
              }));
            }

            const trial: ExperimentTrial = {
              trial_id: trialId,
              experiment_id: definition.experiment_id,
              arm_id: arm.arm_id,
              repetition_index: rep,
              eval_case_id: caseItem?.case_id,
              derived_run_id: caseBaseline.identity.run_id,
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

            return { trial, evalRun };
          } else {
            // Candidate arm: Fork execution via ForkRuntime
            const forkRuntime = new ForkRuntime(caseBaseline, checkpointId, {
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
                eval_case_id: caseItem?.case_id,
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

              return { trial };
            }

            const candidateArtifact = forkResult.child_artifact;

            // Post-hoc evaluation of candidate artifact with enrichment
            const evalRun = await evaluateRun(candidateArtifact, suite!, {
              evaluationRunId: `evrun_${trialId}`,
              datasetId: dataset?.dataset_id,
              datasetVersion: dataset?.version,
              enrichArtifact: true,
              persist: options.persist !== false,
              judgeHandler: options.judgeHandler,
            });

            if (caseItem) {
              evalRun.results = evalRun.results.map((r) => ({
                ...r,
                eval_case_id: caseItem.case_id,
              }));
            }

            // 0.F: Use evaluated artifact for comparison and persistence
            const evaluatedArtifact = evalRun.evaluated_artifact ?? candidateArtifact;

            // Compare evaluated candidate to baseline
            const comparison = await compareRuns(caseBaseline, evaluatedArtifact);
            if (options.persist !== false) {
              await saveRunComparison(comparison);
            }

            const candidateCost = evaluatedArtifact.observability.total_cost_usd ?? 0;
            const graderCost = evalRun.cost_usd;

            const trial: ExperimentTrial = {
              trial_id: trialId,
              experiment_id: definition.experiment_id,
              arm_id: arm.arm_id,
              repetition_index: rep,
              eval_case_id: caseItem?.case_id,
              derived_run_id: evaluatedArtifact.identity.run_id,
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
              model_calls: evaluatedArtifact.observability.model_calls_count,
            });

            return { trial, evalRun };
          }
        } catch (err: any) {
          const trial: ExperimentTrial = {
            trial_id: trialId,
            experiment_id: definition.experiment_id,
            arm_id: arm.arm_id,
            repetition_index: rep,
            eval_case_id: caseItem?.case_id,
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

          return { trial };
        }
      };

      dispatch();
    });

    // Deterministic sorting independent of async completion order
    completedTrials.sort((a, b) => {
      if (a.trial.arm_id !== b.trial.arm_id) return a.trial.arm_id.localeCompare(b.trial.arm_id);
      if (a.trial.repetition_index !== b.trial.repetition_index) return a.trial.repetition_index - b.trial.repetition_index;
      return (a.trial.eval_case_id ?? "").localeCompare(b.trial.eval_case_id ?? "");
    });

    // 6. Aggregate trials and evaluate winner policy
    const consumption = governor.getConsumption();
    const result = ExperimentAggregator.aggregate(
      definition,
      arms,
      completedTrials,
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
