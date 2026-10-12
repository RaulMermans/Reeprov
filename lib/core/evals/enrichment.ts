/**
 * Run Artifact Evaluation Enrichment Engine.
 *
 * Implements a supported post-execution evaluation attachment path for candidate
 * and historical runs.
 *
 * Guarantees:
 * - Does not invisibly mutate an already finalized historical artifact.
 * - Explicit enrichment operation with audit provenance.
 * - Emits VerificationEvents for each attached evaluation result.
 * - Accurately updates run observability counters (evals_passed, evals_failed).
 * - Dual-persists (File + Postgres) the finalized evaluated artifact.
 */

import { type RunArtifact, runArtifactSchema } from "../contracts/runArtifact";
import { type EvalResult, evalResultSchema } from "../contracts/evals";
import type { VerificationEvent } from "../contracts/evidence";
import { saveCanonicalRun } from "../capture/persistence";

export interface EvaluationEnrichmentOptions {
  evaluation_run_id?: string;
  suite_id?: string;
  suite_version?: number | string;
  persist?: boolean;
}

/**
 * Attaches canonical EvalResults to a RunArtifact, updating observability counters
 * and recording verification chronology with provenance.
 */
export async function enrichRunArtifactWithEvals(
  artifact: RunArtifact,
  evalResults: EvalResult[],
  options: EvaluationEnrichmentOptions = {}
): Promise<RunArtifact> {
  const parsedArtifact = runArtifactSchema.parse(artifact);
  const now = new Date().toISOString();

  // 1. Annotate each eval result with evaluation provenance if not already set
  const finalizedEvals: EvalResult[] = evalResults.map((ev, idx) => {
    return evalResultSchema.parse({
      ...ev,
      target_run_id: parsedArtifact.identity.run_id,
      evaluation_run_id: ev.evaluation_run_id ?? options.evaluation_run_id,
      eval_suite_id: ev.eval_suite_id ?? options.suite_id,
      eval_suite_version: ev.eval_suite_version ?? options.suite_version,
      timestamp: ev.timestamp || now,
    });
  });

  // 2. Count passes and fails
  const passedCount = finalizedEvals.filter((e) => e.passed).length;
  const failedCount = finalizedEvals.filter((e) => !e.passed).length;

  // 3. Generate VerificationEvents for lifecycle chronology
  const verificationEvents: VerificationEvent[] = finalizedEvals.map((ev, idx) => {
    return {
      event_id: `vevt_eval_${parsedArtifact.identity.run_id}_${idx}_${Date.now()}`,
      run_id: parsedArtifact.identity.run_id,
      sequence_index: (parsedArtifact.evidence?.verification_events?.length ?? 0) + idx,
      event_type: ev.passed ? "eval.passed" : "eval.failed",
      target_type: "RUN",
      target_id: parsedArtifact.identity.run_id,
      status: ev.passed ? "PASSED" : "FAILED",
      actor: ev.evaluator_id || "eval_studio",
      started_at: ev.timestamp,
      completed_at: ev.timestamp,
      duration_ms: ev.execution_duration_ms ?? 0,
      evidence_refs: ev.evidence_references ?? [],
      artifact_refs: [],
      metadata: {
        eval_id: ev.eval_id,
        eval_name: ev.name,
        eval_family: ev.eval_type,
        score: ev.score,
        threshold: ev.threshold,
        severity: ev.severity,
        grader_type: ev.grader_type,
        evaluation_run_id: ev.evaluation_run_id,
        suite_id: ev.eval_suite_id,
      },
    };
  });

  // 4. Construct enriched artifact
  const existingEvents = parsedArtifact.evidence?.verification_events ?? [];
  const existingEvals = parsedArtifact.evals ?? [];
  // Merge evaluations: replace existing eval by id if present, otherwise append
  const evalMap = new Map<string, EvalResult>();
  for (const e of existingEvals) {
    evalMap.set(e.eval_id, e);
  }
  for (const e of finalizedEvals) {
    evalMap.set(e.eval_id, e);
  }
  const mergedEvals = Array.from(evalMap.values());

  const enriched: RunArtifact = {
    ...parsedArtifact,
    evals: mergedEvals,
    observability: {
      ...parsedArtifact.observability,
      evals_passed: mergedEvals.filter((e) => e.passed).length,
      evals_failed: mergedEvals.filter((e) => !e.passed).length,
    },
    evidence: {
      plan: parsedArtifact.evidence?.plan,
      test_results: parsedArtifact.evidence?.test_results ?? [],
      review_results: parsedArtifact.evidence?.review_results ?? [],
      approval_events: parsedArtifact.evidence?.approval_events ?? [],
      security_events: parsedArtifact.evidence?.security_events ?? [],
      final_outcome: parsedArtifact.evidence?.final_outcome,
      verification_events: [...existingEvents, ...verificationEvents],
    },
  };

  // 5. Persist if requested (default true)
  if (options.persist !== false) {
    await saveCanonicalRun(enriched);
  }

  return enriched;
}
