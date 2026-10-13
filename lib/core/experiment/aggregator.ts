/**
 * Experiment Aggregator & Winner Policy Engine.
 *
 * Implements statistical aggregation of repeated experiment trials and
 * deterministic, policy-driven winner selection.
 *
 * Core Principles:
 * - Hard gates before optimization: safety, approval, and critical evals must pass.
 * - An arm with higher quality but critical safety failures MUST NOT WIN.
 * - Explicit repeatability metrics: n, pass_rate, mean_score, min/max, std_dev.
 * - If n = 1, explicitly notes: "SINGLE TRIAL — REPEATABILITY UNKNOWN".
 * - Never claims statistical significance automatically.
 * - Clear recommendation basis grounded strictly in evidence.
 * - Never automatically promotes candidates to production.
 */

import {
  type ExperimentDefinition,
  type ExperimentArm,
  type ExperimentTrial,
  type ArmAggregate,
  type CandidateRankingEntry,
  type ExperimentResult,
  type WinnerPolicy,
} from "../contracts/experiment";
import type { EvaluationRun } from "../contracts/evalDefinitions";

export interface ArmTrialExecutionData {
  trial: ExperimentTrial;
  evalRun?: EvaluationRun;
}

export class ExperimentAggregator {
  /**
   * Aggregates completed trials across experiment arms and ranks candidates under policy.
   */
  static aggregate(
    definition: ExperimentDefinition,
    arms: ExperimentArm[],
    trialsData: ArmTrialExecutionData[],
    consumedBudget: {
      cost_usd: number;
      candidate_cost_usd: number;
      grader_cost_usd: number;
      trials_executed: number;
      duration_ms: number;
    },
    status: "COMPLETED" | "PARTIAL" | "BUDGET_EXCEEDED" | "FAILED" | "CANCELLED" = "COMPLETED"
  ): ExperimentResult {
    const trialsByArm = new Map<string, ArmTrialExecutionData[]>();
    for (const arm of arms) {
      trialsByArm.set(arm.arm_id, []);
    }
    for (const data of trialsData) {
      const list = trialsByArm.get(data.trial.arm_id);
      if (list) {
        list.push(data);
      }
    }

    const aggregates: ArmAggregate[] = [];
    const baselineArm = arms.find((a) => a.is_baseline) ?? arms[0]!;
    const baselineTrials = trialsByArm.get(baselineArm.arm_id) ?? [];

    // 1. Compute aggregates per arm
    for (const arm of arms) {
      const armTrials = trialsByArm.get(arm.arm_id) ?? [];
      const agg = this.computeArmAggregate(arm, armTrials, definition.winner_policy);
      aggregates.push(agg);
    }

    // 1b. Check required_non_regression_eval_ids against baseline
    const nonRegressionFailuresByArm = this.checkNonRegressionGates(
      definition.winner_policy,
      baselineTrials,
      arms,
      trialsByArm
    );

    // 2. Rank candidates using hard gates + optimization criteria + non-regression
    const ranking = this.rankCandidates(aggregates, definition.winner_policy, nonRegressionFailuresByArm);

    // 2b. Compute truthful overall experiment status
    let finalStatus = status;
    if (finalStatus === "COMPLETED") {
      const anyTrialFailed = trialsData.some((t) => t.trial.status === "FAILED");
      const anyEvalError = trialsData.some(
        (t) => (t.evalRun?.errors?.length ?? 0) > 0 || (t.evalRun?.results?.some((r) => r.grader_status === "EVALUATOR_ERROR") ?? false)
      );
      const allTrialsFailed = trialsData.length > 0 && trialsData.every((t) => t.trial.status === "FAILED");

      if (allTrialsFailed) {
        finalStatus = "FAILED";
      } else if (anyTrialFailed || anyEvalError) {
        finalStatus = "PARTIAL";
      }
    }

    // 3. Determine recommended candidate
    const eligibleWinners = ranking.filter((r) => r.eligible_for_recommendation);
    const baselineAgg = aggregates.find((a) => a.arm_id === baselineArm.arm_id);
    const topCandidate = eligibleWinners[0];

    let recommended_candidate: string | undefined = undefined;
    let recommendation_basis = "";

    if (topCandidate) {
      recommended_candidate = topCandidate.arm_id;
      const winnerAgg = aggregates.find((a) => a.arm_id === topCandidate.arm_id)!;
      const baselinePassRate = baselineAgg ? (baselineAgg.pass_rate * 100).toFixed(1) : "0.0";
      const winnerPassRate = (winnerAgg.pass_rate * 100).toFixed(1);

      recommendation_basis =
        `Under EvalSuite ${definition.eval_suite_id}@${definition.eval_suite_version ?? 1}, ` +
        `${winnerAgg.n} trial(s) per arm, and policy ${definition.winner_policy.optimization_criterion}: ` +
        `Candidate "${winnerAgg.arm_name}" passed all required safety/policy gates, ` +
        `achieved a ${winnerPassRate}% pass rate (vs ${baselinePassRate}% for baseline), ` +
        `with mean cost $${winnerAgg.mean_total_cost.toFixed(4)} and mean latency ${winnerAgg.mean_latency_ms.toFixed(0)}ms. ` +
        `Zero critical safety regressions observed. ` +
        `[STATUS: CANDIDATE_RECOMMENDED — requires external human/CI approval before production promotion]`;
    } else {
      recommendation_basis =
        `No candidate arm satisfied all required safety, approval, and task gates under policy ${definition.winner_policy.optimization_criterion}. ` +
        `Baseline preserved.`;
    }

    const limitations: string[] = [];
    if (definition.repetitions === 1) {
      limitations.push("SINGLE TRIAL — REPEATABILITY UNKNOWN. Results may vary on stochastic model runs.");
    }
    if (finalStatus === "BUDGET_EXCEEDED") {
      limitations.push("Experiment was stopped early due to budget exhaustion. Some trials were not executed.");
    } else if (finalStatus === "PARTIAL") {
      limitations.push("Some trials or evaluators encountered errors during execution. Aggregation is based on available evidence.");
    }

    return {
      experiment_id: definition.experiment_id,
      status: finalStatus,
      baseline_arm_id: baselineArm.arm_id,
      arms,
      trial_summaries: trialsData.map((d) => d.trial),
      aggregates,
      eval_summary: {
        eval_suite_id: definition.eval_suite_id,
        eval_suite_version: definition.eval_suite_version ?? 1,
        total_trials: trialsData.length,
      },
      comparison_refs: trialsData.map((d) => d.trial.comparison_id).filter(Boolean) as string[],
      budget_consumed: consumedBudget,
      candidate_ranking: ranking,
      recommended_candidate,
      recommendation_basis,
      limitations,
      created_at: definition.created_at,
      completed_at: new Date().toISOString(),
    };
  }

  private static checkNonRegressionGates(
    policy: WinnerPolicy,
    baselineTrials: ArmTrialExecutionData[],
    arms: ExperimentArm[],
    trialsByArm: Map<string, ArmTrialExecutionData[]>
  ): Map<string, string[]> {
    const failuresByArm = new Map<string, string[]>();
    const requiredNonReg = policy.required_non_regression_eval_ids ?? [];
    if (requiredNonReg.length === 0) return failuresByArm;

    // Build baseline lookup: evalId -> average score, pass status
    const baselineEvals = new Map<string, { passed: boolean; score: number }>();
    for (const bTrial of baselineTrials) {
      if (!bTrial.evalRun) continue;
      for (const res of bTrial.evalRun.results) {
        if (res.eval_definition_id && requiredNonReg.includes(res.eval_definition_id)) {
          baselineEvals.set(res.eval_definition_id, {
            passed: res.passed && res.grader_status !== "EVALUATOR_ERROR" && res.grader_status !== "MISSING_EVIDENCE",
            score: typeof res.score === "number" ? res.score : res.passed ? 1 : 0,
          });
        }
      }
    }

    const maxAllowedDrop = policy.max_score_degradation ?? 0;

    for (const arm of arms) {
      if (arm.is_baseline) continue; // Baseline doesn't regress against itself
      const armFailures: string[] = [];
      const armTrials = trialsByArm.get(arm.arm_id) ?? [];

      for (const evalId of requiredNonReg) {
        const base = baselineEvals.get(evalId);
        // Candidate results for this evalId across all trials
        const candResults = armTrials.flatMap((t) =>
          (t.evalRun?.results ?? []).filter((r) => r.eval_definition_id === evalId)
        );

        if (candResults.length === 0) {
          armFailures.push(`NON_REGRESSION_GATE_FAILED: Required non-regression eval '${evalId}' missing from candidate`);
          continue;
        }

        for (const cRes of candResults) {
          if (cRes.grader_status === "EVALUATOR_ERROR") {
            armFailures.push(`NON_REGRESSION_GATE_FAILED: Required non-regression eval '${evalId}' encountered EVALUATOR_ERROR`);
            break;
          }
          if (cRes.grader_status === "MISSING_EVIDENCE") {
            armFailures.push(`NON_REGRESSION_GATE_FAILED: Required non-regression eval '${evalId}' encountered MISSING_EVIDENCE`);
            break;
          }
          if (base && base.passed && !cRes.passed) {
            armFailures.push(`NON_REGRESSION_GATE_FAILED: Required non-regression eval '${evalId}' regressed PASS -> FAIL`);
            break;
          }
          if (base && typeof base.score === "number") {
            const candScore = typeof cRes.score === "number" ? cRes.score : cRes.passed ? 1 : 0;
            const drop = base.score - candScore;
            if (drop > maxAllowedDrop + 1e-6) {
              armFailures.push(`NON_REGRESSION_GATE_FAILED: Required non-regression eval '${evalId}' score degraded by ${drop.toFixed(3)} (max allowed: ${maxAllowedDrop})`);
              break;
            }
          }
        }
      }

      if (armFailures.length > 0) {
        failuresByArm.set(arm.arm_id, armFailures);
      }
    }

    return failuresByArm;
  }

  private static computeArmAggregate(
    arm: ExperimentArm,
    trialsData: ArmTrialExecutionData[],
    winnerPolicy: WinnerPolicy
  ): ArmAggregate {
    const n = Math.max(1, trialsData.length);
    if (trialsData.length === 0) {
      return {
        arm_id: arm.arm_id,
        arm_name: arm.name,
        is_baseline: arm.is_baseline,
        n: 0,
        pass_rate: 0,
        mean_score: 0,
        median_score: 0,
        min_score: 0,
        max_score: 0,
        mean_candidate_cost: 0,
        mean_grader_cost: 0,
        mean_total_cost: 0,
        mean_latency_ms: 0,
        safety_pass: false,
        approval_pass: false,
        required_gates_pass: false,
        critical_violations: 0,
        repeatability_note: "NO TRIALS EXECUTED",
      };
    }

    const scores: number[] = [];
    let passedCount = 0;
    let totalCandidateCost = 0;
    let totalGraderCost = 0;
    let totalLatency = 0;
    let criticalViolations = 0;
    let safetyPassedAll = true;
    let approvalPassedAll = true;
    let requiredGatesPassedAll = true;

    const criticalEvalIds = new Set(winnerPolicy.critical_eval_ids ?? []);
    const requiredIds = new Set(winnerPolicy.required_eval_ids ?? []);

    for (const { trial, evalRun } of trialsData) {
      totalCandidateCost += trial.candidate_cost_usd || 0;
      totalGraderCost += trial.grader_cost_usd || 0;
      totalLatency += trial.duration_ms || 0;

      if (evalRun) {
        const score = evalRun.summary.weighted_score ?? evalRun.summary.pass_rate;
        scores.push(score);

        if (evalRun.summary.suite_verdict === "PASSED") {
          passedCount++;
        }

        // Safety gate check: if any safety results exist, must pass and not be error/missing
        const safetyEvals = evalRun.results.filter((r) => r.eval_type === "safety");
        if (safetyEvals.length > 0) {
          const safetyPassed = safetyEvals.every(
            (r) => r.passed && r.grader_status !== "EVALUATOR_ERROR" && r.grader_status !== "MISSING_EVIDENCE"
          );
          if (!safetyPassed) safetyPassedAll = false;
        }

        // Approval compliance check
        const approvalEvals = evalRun.results.filter((r) => r.eval_type === "approval_compliance");
        if (approvalEvals.length > 0) {
          const approvalPassed = approvalEvals.every(
            (r) => r.passed && r.grader_status !== "EVALUATOR_ERROR" && r.grader_status !== "MISSING_EVIDENCE"
          );
          if (!approvalPassed) approvalPassedAll = false;
        }

        // Critical violations check: suite criticals + winnerPolicy criticals + critical severity
        if (evalRun.summary.critical_failures.length > 0) {
          criticalViolations += evalRun.summary.critical_failures.length;
        }

        for (const critId of criticalEvalIds) {
          const found = evalRun.results.find((r) => r.eval_definition_id === critId);
          if (!found || !found.passed || found.grader_status === "EVALUATOR_ERROR" || found.grader_status === "MISSING_EVIDENCE") {
            criticalViolations++;
          }
        }

        // Required gates check: every required ID must be present and pass
        for (const reqId of requiredIds) {
          const found = evalRun.results.find((r) => r.eval_definition_id === reqId);
          if (!found || !found.passed || found.grader_status === "EVALUATOR_ERROR" || found.grader_status === "MISSING_EVIDENCE") {
            requiredGatesPassedAll = false;
          }
        }
      } else {
        scores.push(trial.status === "COMPLETED" ? 1 : 0);
        if (trial.status === "COMPLETED") passedCount++;
        if (requiredIds.size > 0) requiredGatesPassedAll = false;
      }
    }

    scores.sort((a, b) => a - b);
    const pass_rate = passedCount / n;
    const mean_score = scores.reduce((a, b) => a + b, 0) / n;
    const median_score = scores[Math.floor(scores.length / 2)] ?? 0;
    const min_score = scores[0] ?? 0;
    const max_score = scores[scores.length - 1] ?? 0;

    let std_dev_score: number | undefined = undefined;
    if (n > 1) {
      const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean_score, 2), 0) / (n - 1);
      std_dev_score = Math.sqrt(variance);
    }

    const mean_candidate_cost = totalCandidateCost / n;
    const mean_grader_cost = totalGraderCost / n;
    const mean_total_cost = mean_candidate_cost + mean_grader_cost;
    const mean_latency_ms = totalLatency / n;

    const repeatability_note =
      n === 1
        ? "SINGLE TRIAL — REPEATABILITY UNKNOWN"
        : `Repeated across ${n} trials (std dev: ${(std_dev_score ?? 0).toFixed(3)})`;

    return {
      arm_id: arm.arm_id,
      arm_name: arm.name,
      is_baseline: arm.is_baseline,
      n,
      pass_rate,
      mean_score,
      median_score,
      min_score,
      max_score,
      std_dev_score,
      mean_candidate_cost,
      mean_grader_cost,
      mean_total_cost,
      mean_latency_ms,
      safety_pass: safetyPassedAll,
      approval_pass: approvalPassedAll,
      required_gates_pass: requiredGatesPassedAll,
      critical_violations: criticalViolations,
      repeatability_note,
    };
  }

  private static rankCandidates(
    aggregates: ArmAggregate[],
    policy: WinnerPolicy,
    nonRegressionFailuresByArm?: Map<string, string[]>
  ): CandidateRankingEntry[] {
    const entries: CandidateRankingEntry[] = [];

    for (const agg of aggregates) {
      const gateFailures: string[] = [];

      // Non-regression check
      if (nonRegressionFailuresByArm && nonRegressionFailuresByArm.has(agg.arm_id)) {
        gateFailures.push(...nonRegressionFailuresByArm.get(agg.arm_id)!);
      }

      // Hard Gates Check
      if (!agg.safety_pass) {
        gateFailures.push("Failed safety guardrails");
      }
      if (!agg.approval_pass) {
        gateFailures.push("Violated approval compliance gate");
      }
      if (!agg.required_gates_pass) {
        gateFailures.push("Failed required eval suite definitions");
      }
      if (agg.critical_violations > 0) {
        gateFailures.push(`${agg.critical_violations} critical eval violation(s) detected`);
      }
      if (agg.pass_rate < policy.min_pass_rate) {
        gateFailures.push(
          `Pass rate ${(agg.pass_rate * 100).toFixed(1)}% below minimum required ${(policy.min_pass_rate * 100).toFixed(1)}%`
        );
      }

      const eligible = gateFailures.length === 0;

      // Compute optimization score
      let compositeScore = agg.mean_score;
      if (policy.optimization_criterion === "COST_FIRST") {
        // Higher score is better; invert cost relative to $1.00 baseline
        compositeScore = agg.mean_score * 0.4 + (1 / (1 + agg.mean_total_cost)) * 0.6;
      } else if (policy.optimization_criterion === "LATENCY_FIRST") {
        compositeScore = agg.mean_score * 0.4 + (1 / (1 + agg.mean_latency_ms / 1000)) * 0.6;
      } else if (policy.optimization_criterion === "BALANCED") {
        const w = policy.weights;
        compositeScore =
          agg.mean_score * w.quality +
          (1 / (1 + agg.mean_total_cost)) * w.cost +
          (1 / (1 + agg.mean_latency_ms / 1000)) * w.latency;
      }

      entries.push({
        rank: 0, // Assigned below after sorting
        arm_id: agg.arm_id,
        arm_name: agg.arm_name,
        score: compositeScore,
        eligible_for_recommendation: eligible,
        gate_failure_reasons: gateFailures,
        summary: eligible
          ? `Pass rate: ${(agg.pass_rate * 100).toFixed(0)}%, Score: ${agg.mean_score.toFixed(3)}, Cost: $${agg.mean_total_cost.toFixed(4)}`
          : `DISQUALIFIED: ${gateFailures.join("; ")}`,
      });
    }

    // Sort: Eligible first, then by compositeScore descending, then lower cost
    entries.sort((a, b) => {
      if (a.eligible_for_recommendation !== b.eligible_for_recommendation) {
        return a.eligible_for_recommendation ? -1 : 1;
      }
      return b.score - a.score;
    });

    // Assign 1-indexed ranks
    return entries.map((e, idx) => ({ ...e, rank: idx + 1 }));
  }
}
