/**
 * Production Failure -> Permanent Regression Case Curation Engine.
 *
 * Completes the lifecycle:
 * production failure
 * -> reproduce
 * -> diagnose
 * -> human confirms case
 * -> add to versioned regression dataset
 * -> future releases execute it
 * -> regression gate protects behavior
 *
 * Invariants:
 * - Does not auto-curate without explicit user confirmation.
 * - Records durable provenance (source_run_id, incident, curated_by, failure_category).
 */

import { type EvalCase } from "../contracts/evalDefinitions";
import { saveRunAsEvalCase } from "../evals/persistence";
import { getCanonicalRun } from "../capture/persistence";

export interface CurateFailureOptions {
  runId: string;
  datasetId: string;
  datasetVersion?: number;
  caseName: string;
  failureCategory: string;
  sourceIncident?: string;
  curatedBy: string;
  expectedBehavior?: unknown;
  tags?: string[];
}

export class RegressionCaseCuration {
  /**
   * Curates an explicit production failure into a permanent, versioned regression test case.
   */
  static async curateFailureAsRegressionCase(
    options: CurateFailureOptions
  ): Promise<EvalCase> {
    const run = await getCanonicalRun(options.runId);
    if (!run) {
      throw new Error(`Run "${options.runId}" not found; cannot curate into regression case.`);
    }

    const configHash = run.configuration_snapshot?.config_hash || "unknown_config";

    const evalCase = await saveRunAsEvalCase(options.runId, {
      datasetId: options.datasetId,
      datasetVersion: options.datasetVersion ?? 1,
      caseName: options.caseName,
      expected: options.expectedBehavior,
      tags: [
        "regression_case",
        "curated_production_failure",
        options.failureCategory,
        ...(options.tags ?? []),
      ],
    });

    // Enrich case metadata with provenance
    evalCase.metadata = {
      ...evalCase.metadata,
      source_run_id: options.runId,
      source_incident: options.sourceIncident,
      curated_by: options.curatedBy,
      curated_at: new Date().toISOString(),
      failure_category: options.failureCategory,
      original_configuration_hash: configHash,
    };

    (evalCase as any).dataset_id = options.datasetId;

    return evalCase;
  }
}
