/**
 * Improvement Claim Gate.
 *
 * A candidate completing successfully is not evidence that it fixed the
 * problem. IMPROVEMENT_VERIFIED is returned only when every condition holds:
 *
 * 1. Both runs were evaluated by the same suite id and version, without
 *    evaluator errors.
 * 2. The baseline suite FAILED and the candidate suite PASSED.
 * 3. At least one required eval failed on the baseline and passes on the
 *    candidate, and no eval that passed on the baseline fails on the candidate.
 * 4. The comparison found at least one evidence-backed divergence (it cites
 *    a step or boundary of the runs).
 * 5. The candidate is a resumed fork of the baseline (same checkpointed
 *    prefix), so the difference is attributable to the controlled mutation.
 * 6. The baseline's own replay was VERIFIED (the evidence reproduces).
 * 7. The candidate executed no live side effects.
 *
 * Anything else yields NO_IMPROVEMENT_CLAIM with the failed conditions.
 */

import type { RunArtifact } from "../contracts/runArtifact";
import type { RunComparison, ComparisonDivergence } from "../contracts/comparison";
import type { EvaluationRun } from "../contracts/evalDefinitions";
import type { ReplayResult } from "../replay/contracts";

export interface ImprovementClaimInput {
  baseline: RunArtifact;
  candidate: RunArtifact;
  comparison: RunComparison;
  baselineEvaluation: EvaluationRun;
  candidateEvaluation: EvaluationRun;
  baselineReplay?: ReplayResult;
}

export interface ImprovementClaim {
  verdict: "IMPROVEMENT_VERIFIED" | "NO_IMPROVEMENT_CLAIM";
  failed_conditions: string[];
  fixed_eval_ids: string[];
  regressed_eval_ids: string[];
  evidence_divergence?: Pick<ComparisonDivergence, "divergence_id" | "dimension" | "description" | "step_id" | "boundary_id" | "candidate_boundary_id" | "evidence_refs">;
}

function verdictsById(run: EvaluationRun): Map<string, boolean> {
  return new Map(run.results.map((r) => [r.eval_definition_id ?? r.eval_id, r.passed === true]));
}

function citesEvidence(d: ComparisonDivergence): boolean {
  return Boolean(d.step_id || d.candidate_step_id || d.boundary_id || d.candidate_boundary_id || (d.evidence_refs?.length ?? 0) > 0);
}

export function assessImprovementClaim(input: ImprovementClaimInput): ImprovementClaim {
  const failed: string[] = [];
  const { baselineEvaluation: be, candidateEvaluation: ce } = input;

  if (be.suite_id !== ce.suite_id || be.suite_version !== ce.suite_version) {
    failed.push(`SUITE_MISMATCH: baseline ${be.suite_id}@${be.suite_version} vs candidate ${ce.suite_id}@${ce.suite_version}.`);
  }
  for (const [label, run] of [["baseline", be], ["candidate", ce]] as const) {
    if (run.status !== "COMPLETED" || run.results.some((r) => r.grader_status === "EVALUATOR_ERROR")) {
      failed.push(`EVALUATION_INCOMPLETE: ${label} evaluation status ${run.status}.`);
    }
    if (!run.target_run_ids.includes((label === "baseline" ? input.baseline : input.candidate).identity.run_id)) {
      failed.push(`EVALUATION_TARGET_MISMATCH: ${label} evaluation does not target the ${label} run.`);
    }
  }
  if (be.summary.suite_verdict !== "FAILED") failed.push("BASELINE_NOT_FAILING: the baseline passes the suite; there is nothing to fix.");
  if (ce.summary.suite_verdict !== "PASSED") failed.push("CANDIDATE_NOT_PASSING: the candidate does not pass the suite.");

  const before = verdictsById(be);
  const after = verdictsById(ce);
  const fixed = [...before].filter(([id, passed]) => !passed && after.get(id) === true).map(([id]) => id);
  const regressed = [...before].filter(([id, passed]) => passed && after.get(id) === false).map(([id]) => id);
  if (fixed.length === 0) failed.push("NO_FIXED_EVAL: no eval that failed on the baseline passes on the candidate.");
  if (regressed.length > 0) failed.push(`REGRESSION: ${regressed.join(", ")} passed on the baseline and fail on the candidate.`);

  const divergence = input.comparison.divergences.find(citesEvidence);
  if (!divergence) failed.push("NO_EVIDENCE_DIVERGENCE: the comparison found no divergence that cites run evidence.");

  const fork = input.candidate.provenance.metadata?.["fork"] as { resumed?: boolean; live_side_effects_executed?: number } | undefined;
  if (input.candidate.lineage?.parent_run_id !== input.baseline.identity.run_id || fork?.resumed !== true) {
    failed.push("NOT_A_RESUMED_FORK: the candidate is not a resumed fork of the baseline; differences cannot be attributed to the mutation.");
  }
  if ((fork?.live_side_effects_executed ?? 1) !== 0) failed.push("LIVE_SIDE_EFFECTS: the candidate executed live side effects.");

  if (!input.baselineReplay) failed.push("REPLAY_FIDELITY_UNKNOWN: no replay of the baseline was supplied.");
  else if (input.baselineReplay.source_run_id !== input.baseline.identity.run_id || input.baselineReplay.verification !== "VERIFIED") {
    failed.push(`REPLAY_FIDELITY: baseline replay verification is ${input.baselineReplay.verification ?? "unknown"}, not VERIFIED.`);
  }

  return {
    verdict: failed.length === 0 ? "IMPROVEMENT_VERIFIED" : "NO_IMPROVEMENT_CLAIM",
    failed_conditions: failed,
    fixed_eval_ids: fixed,
    regressed_eval_ids: regressed,
    evidence_divergence: divergence && {
      divergence_id: divergence.divergence_id,
      dimension: divergence.dimension,
      description: divergence.description,
      step_id: divergence.step_id,
      boundary_id: divergence.boundary_id,
      candidate_boundary_id: divergence.candidate_boundary_id,
      evidence_refs: divergence.evidence_refs,
    },
  };
}
