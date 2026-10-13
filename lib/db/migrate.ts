/**
 * Idempotent database schema migration.
 *
 * All statements use CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS,
 * so this is safe to run on every cold start. Tables are prefixed with `ap_`
 * to avoid collision with other schemas.
 *
 * Run order matters: ap_runs must exist before ap_trace_events (FK dependency).
 */

import { getDb } from "./client";

let _migrated = false;
let _migrationPromise: Promise<void> | null = null;

export async function ensureSchema(): Promise<void> {
  if (_migrated) return;

  if (!_migrationPromise) {
    _migrationPromise = (async () => {
      console.info("Running Postgres migration");
      await runMigrations();
      _migrated = true;
      console.info("Postgres migration complete");
    })();
  }

  try {
    await _migrationPromise;
  } finally {
    if (!_migrated) {
      _migrationPromise = null;
    }
  }
}

/** For testing: reset the migration flag so tests can re-run migrations. */
export function _resetMigrationFlag(): void {
  _migrated = false;
  _migrationPromise = null;
}

async function runMigrations(): Promise<void> {
  const sql = getDb();

  // ── Integrations ────────────────────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_integrations (
      integration_id    TEXT PRIMARY KEY,
      project_id        TEXT NOT NULL,
      project_name      TEXT NOT NULL,
      description       TEXT,
      default_workflow_id TEXT,
      repository_url    TEXT,
      language          TEXT,
      framework         TEXT,
      status            TEXT NOT NULL DEFAULT 'waiting_for_first_event',
      mode              TEXT NOT NULL DEFAULT 'trace_sdk',
      ingest_key_hash   TEXT,
      ingest_key_preview TEXT,
      last_event_at     TIMESTAMPTZ,
      last_run_id       TEXT,
      last_run_status   TEXT,
      run_count         INTEGER NOT NULL DEFAULT 0,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_integrations_project_id_idx ON ap_integrations(project_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_integrations_status_idx ON ap_integrations(status)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_integrations_updated_at_idx ON ap_integrations(updated_at DESC)`);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS ap_integrations_ingest_key_hash_idx ON ap_integrations(ingest_key_hash) WHERE ingest_key_hash IS NOT NULL`);

  // ── Runs ────────────────────────────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_runs (
      run_id              TEXT PRIMARY KEY,
      project_id          TEXT NOT NULL,
      workflow_id         TEXT NOT NULL,
      project_name        TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'running',
      summary             TEXT NOT NULL DEFAULT '',
      started_at          TIMESTAMPTZ NOT NULL,
      completed_at        TIMESTAMPTZ,
      total_cost_usd      NUMERIC(12,6),
      total_duration_ms   INTEGER,
      model_calls_count   INTEGER NOT NULL DEFAULT 0,
      tool_calls_count    INTEGER NOT NULL DEFAULT 0,
      evals_passed        INTEGER NOT NULL DEFAULT 0,
      evals_failed        INTEGER NOT NULL DEFAULT 0,
      approval_status     TEXT,
      artifact_refs       TEXT[] NOT NULL DEFAULT '{}',
      error_summary       TEXT,
      parent_run_id       TEXT,
      root_run_id         TEXT,
      fork_checkpoint_id  TEXT,
      experiment_id       TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`ALTER TABLE ap_runs ADD COLUMN IF NOT EXISTS parent_run_id TEXT`);
  await sql.unsafe(`ALTER TABLE ap_runs ADD COLUMN IF NOT EXISTS root_run_id TEXT`);
  await sql.unsafe(`ALTER TABLE ap_runs ADD COLUMN IF NOT EXISTS fork_checkpoint_id TEXT`);
  await sql.unsafe(`ALTER TABLE ap_runs ADD COLUMN IF NOT EXISTS experiment_id TEXT`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_runs_project_id_idx ON ap_runs(project_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_runs_workflow_id_idx ON ap_runs(workflow_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_runs_status_idx ON ap_runs(status)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_runs_started_at_idx ON ap_runs(started_at DESC)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_runs_parent_run_id_idx ON ap_runs(parent_run_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_runs_root_run_id_idx ON ap_runs(root_run_id)`);

  // ── Trace events ─────────────────────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_trace_events (
      event_id        TEXT NOT NULL,
      run_id          TEXT NOT NULL REFERENCES ap_runs(run_id) ON DELETE CASCADE,
      workflow_id     TEXT NOT NULL,
      event_type      TEXT NOT NULL,
      status          TEXT,
      node_id         TEXT,
      timestamp       TIMESTAMPTZ NOT NULL,
      duration_ms     INTEGER,
      cost_usd        NUMERIC(12,6),
      input_summary   TEXT,
      output_summary  TEXT,
      metadata        JSONB,
      PRIMARY KEY (event_id, run_id)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_trace_events_run_id_idx ON ap_trace_events(run_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_trace_events_timestamp_idx ON ap_trace_events(run_id, timestamp)`);

  // ── Tool calls ───────────────────────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_tool_calls (
      tool_call_id      TEXT NOT NULL,
      run_id            TEXT NOT NULL REFERENCES ap_runs(run_id) ON DELETE CASCADE,
      node_id           TEXT NOT NULL,
      tool_name         TEXT NOT NULL,
      permission_class  TEXT NOT NULL DEFAULT 'read',
      input_summary     TEXT,
      output_summary    TEXT,
      status            TEXT NOT NULL DEFAULT 'pending',
      error             TEXT,
      started_at        TIMESTAMPTZ,
      completed_at      TIMESTAMPTZ,
      duration_ms       INTEGER,
      PRIMARY KEY (tool_call_id, run_id)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_tool_calls_run_id_idx ON ap_tool_calls(run_id)`);

  // ── Eval results ─────────────────────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_eval_results (
      eval_id         TEXT NOT NULL,
      run_id          TEXT NOT NULL REFERENCES ap_runs(run_id) ON DELETE CASCADE,
      node_id         TEXT,
      name            TEXT NOT NULL,
      type            TEXT NOT NULL,
      score           NUMERIC(6,4),
      passed          BOOLEAN NOT NULL,
      severity        TEXT NOT NULL DEFAULT 'info',
      findings        JSONB NOT NULL DEFAULT '[]',
      recommendation  TEXT,
      PRIMARY KEY (eval_id, run_id)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_eval_results_run_id_idx ON ap_eval_results(run_id)`);

  // ── Reports ──────────────────────────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_reports (
      report_id       TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL,
      repo_name       TEXT NOT NULL,
      source_type     TEXT NOT NULL DEFAULT 'mock',
      overall_score   INTEGER NOT NULL DEFAULT 0,
      health_status   TEXT NOT NULL DEFAULT 'needs-attention',
      report_version  TEXT NOT NULL,
      scanner_version TEXT NOT NULL,
      generated_at    TIMESTAMPTZ NOT NULL,
      saved_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finding_counts  JSONB NOT NULL DEFAULT '{}',
      detected_counts JSONB NOT NULL DEFAULT '{}',
      report_data     JSONB NOT NULL
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_reports_project_id_idx ON ap_reports(project_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_reports_saved_at_idx ON ap_reports(saved_at DESC)`);

  // ── Workflow specs ────────────────────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_workflow_specs (
      registry_id             TEXT PRIMARY KEY,
      workflow_id             TEXT NOT NULL,
      project_id              TEXT NOT NULL,
      project_name            TEXT NOT NULL,
      name                    TEXT NOT NULL,
      description             TEXT,
      version                 TEXT NOT NULL DEFAULT '1.0',
      architecture_type       TEXT NOT NULL,
      source                  TEXT NOT NULL DEFAULT 'manual',
      confidence              TEXT NOT NULL DEFAULT 'low',
      status                  TEXT NOT NULL DEFAULT 'draft',
      source_report_id        TEXT,
      source_reconstruction_id TEXT,
      evidence_paths          JSONB NOT NULL DEFAULT '[]',
      missing_fields          JSONB NOT NULL DEFAULT '[]',
      missing_links           JSONB,
      node_count              INTEGER NOT NULL DEFAULT 0,
      edge_count              INTEGER NOT NULL DEFAULT 0,
      tool_count              INTEGER NOT NULL DEFAULT 0,
      eval_count              INTEGER NOT NULL DEFAULT 0,
      missing_field_count     INTEGER NOT NULL DEFAULT 0,
      spec_data               JSONB NOT NULL,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_workflow_specs_workflow_id_idx ON ap_workflow_specs(workflow_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_workflow_specs_project_id_idx ON ap_workflow_specs(project_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_workflow_specs_status_idx ON ap_workflow_specs(status)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_workflow_specs_updated_at_idx ON ap_workflow_specs(updated_at DESC)`);

  // ── Ingest diagnostics ───────────────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_ingest_diagnostics (
      diagnostic_id   TEXT PRIMARY KEY,
      integration_id  TEXT,
      project_id      TEXT,
      run_id          TEXT,
      event_type      TEXT,
      category        TEXT NOT NULL,
      error_code      TEXT NOT NULL,
      message         TEXT NOT NULL,
      schema_path     TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_ingest_diagnostics_project_id_idx ON ap_ingest_diagnostics(project_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_ingest_diagnostics_integration_id_idx ON ap_ingest_diagnostics(integration_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_ingest_diagnostics_created_at_idx ON ap_ingest_diagnostics(created_at DESC)`);

  // ── Content Blobs (deduplicated payload storage) ───────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_content_blobs (
      hash            TEXT PRIMARY KEY,
      content         TEXT NOT NULL,
      size_bytes      INTEGER NOT NULL,
      mime_type       TEXT NOT NULL DEFAULT 'application/json',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── Execution Boundaries ──────────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_execution_boundaries (
      boundary_id     TEXT NOT NULL,
      run_id          TEXT NOT NULL REFERENCES ap_runs(run_id) ON DELETE CASCADE,
      step_id         TEXT,
      sequence_index  INTEGER NOT NULL DEFAULT 0,
      boundary_type   TEXT NOT NULL,
      name            TEXT NOT NULL,
      replayability   TEXT NOT NULL DEFAULT 'UNKNOWN',
      side_effect_class TEXT NOT NULL DEFAULT 'read_only',
      input_hash      TEXT,
      output_hash     TEXT,
      boundary_data   JSONB NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (boundary_id, run_id)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_execution_boundaries_run_id_idx ON ap_execution_boundaries(run_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_execution_boundaries_seq_idx ON ap_execution_boundaries(run_id, sequence_index)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_execution_boundaries_type_idx ON ap_execution_boundaries(boundary_type)`);

  // ── Context Snapshots ─────────────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_context_snapshots (
      snapshot_id     TEXT NOT NULL,
      run_id          TEXT NOT NULL REFERENCES ap_runs(run_id) ON DELETE CASCADE,
      step_id         TEXT,
      model_invocation_id TEXT,
      total_token_estimate INTEGER,
      snapshot_data   JSONB NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (snapshot_id, run_id)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_context_snapshots_run_id_idx ON ap_context_snapshots(run_id)`);

  // ── Canonical Run Artifacts ───────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_canonical_runs (
      run_id          TEXT PRIMARY KEY REFERENCES ap_runs(run_id) ON DELETE CASCADE,
      schema_version  TEXT NOT NULL,
      artifact_data   JSONB NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_canonical_runs_updated_at_idx ON ap_canonical_runs(updated_at DESC)`);

  // ── Replay Runs ───────────────────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_replay_runs (
      replay_id           TEXT PRIMARY KEY,
      source_run_id       TEXT NOT NULL,
      status              TEXT NOT NULL,
      mode                TEXT NOT NULL,
      deterministic_match BOOLEAN NOT NULL DEFAULT FALSE,
      steps_expected      INTEGER NOT NULL DEFAULT 0,
      steps_executed      INTEGER NOT NULL DEFAULT 0,
      boundaries_expected INTEGER NOT NULL DEFAULT 0,
      boundaries_substituted INTEGER NOT NULL DEFAULT 0,
      live_calls_attempted INTEGER NOT NULL DEFAULT 0,
      live_calls_blocked  INTEGER NOT NULL DEFAULT 0,
      started_at          TIMESTAMPTZ NOT NULL,
      completed_at        TIMESTAMPTZ NOT NULL,
      plan_data           JSONB,
      result_data         JSONB NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_replay_runs_source_run_id_idx ON ap_replay_runs(source_run_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_replay_runs_status_idx ON ap_replay_runs(status)`);

  // ── Replay Events ──────────────────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_replay_events (
      event_id            TEXT PRIMARY KEY,
      replay_id           TEXT NOT NULL REFERENCES ap_replay_runs(replay_id) ON DELETE CASCADE,
      source_run_id       TEXT NOT NULL,
      event_type          TEXT NOT NULL,
      step_id             TEXT,
      boundary_id         TEXT,
      timestamp           TIMESTAMPTZ NOT NULL,
      data                JSONB,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_replay_events_replay_id_idx ON ap_replay_events(replay_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_replay_events_event_type_idx ON ap_replay_events(event_type)`);

  // ── Replay Divergences ─────────────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_replay_divergences (
      divergence_id       TEXT PRIMARY KEY,
      replay_id           TEXT NOT NULL REFERENCES ap_replay_runs(replay_id) ON DELETE CASCADE,
      source_run_id       TEXT NOT NULL,
      divergence_type     TEXT NOT NULL,
      step_index          INTEGER,
      boundary_sequence   INTEGER,
      severity            TEXT NOT NULL DEFAULT 'critical',
      message             TEXT NOT NULL,
      expected            JSONB NOT NULL DEFAULT '{}',
      actual              JSONB NOT NULL DEFAULT '{}',
      timestamp           TIMESTAMPTZ NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_replay_divergences_replay_id_idx ON ap_replay_divergences(replay_id)`);

  // ── Sprint 5: Agent Configuration Snapshots ───────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_agent_config_snapshots (
      snapshot_id       TEXT PRIMARY KEY,
      run_id            TEXT NOT NULL REFERENCES ap_runs(run_id) ON DELETE CASCADE,
      config_hash       TEXT NOT NULL,
      declaration_type  TEXT NOT NULL DEFAULT 'EFFECTIVE',
      agent_id          TEXT NOT NULL,
      agent_version     TEXT NOT NULL,
      model_id          TEXT NOT NULL,
      captured_at       TIMESTAMPTZ NOT NULL,
      snapshot_data     JSONB NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_agent_config_snapshots_run_id_idx ON ap_agent_config_snapshots(run_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_agent_config_snapshots_config_hash_idx ON ap_agent_config_snapshots(config_hash)`);

  // ── Sprint 5: Verification Events ──────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_verification_events (
      event_id        TEXT NOT NULL,
      run_id          TEXT NOT NULL REFERENCES ap_runs(run_id) ON DELETE CASCADE,
      step_id         TEXT,
      sequence_index  INTEGER NOT NULL DEFAULT 0,
      event_type      TEXT NOT NULL,
      target_type     TEXT NOT NULL,
      target_id       TEXT,
      status          TEXT NOT NULL,
      actor           TEXT NOT NULL,
      started_at      TIMESTAMPTZ,
      completed_at    TIMESTAMPTZ,
      duration_ms     INTEGER,
      event_data      JSONB NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (event_id, run_id)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_verification_events_run_id_idx ON ap_verification_events(run_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_verification_events_type_idx ON ap_verification_events(event_type)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_verification_events_status_idx ON ap_verification_events(status)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_verification_events_seq_idx ON ap_verification_events(run_id, sequence_index)`);

  // ── Sprint 5: Test Results ─────────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_test_results (
      test_id         TEXT NOT NULL,
      run_id          TEXT NOT NULL REFERENCES ap_runs(run_id) ON DELETE CASCADE,
      step_id         TEXT,
      suite           TEXT NOT NULL,
      name            TEXT NOT NULL,
      status          TEXT NOT NULL,
      duration_ms     INTEGER,
      attempt         INTEGER NOT NULL DEFAULT 1,
      failure_message TEXT,
      result_data     JSONB NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (test_id, run_id)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_test_results_run_id_idx ON ap_test_results(run_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_test_results_status_idx ON ap_test_results(status)`);

  // ── Sprint 5: Review Results ───────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_review_results (
      review_id       TEXT NOT NULL,
      run_id          TEXT NOT NULL REFERENCES ap_runs(run_id) ON DELETE CASCADE,
      step_id         TEXT,
      review_type     TEXT NOT NULL,
      reviewer        TEXT NOT NULL,
      status          TEXT NOT NULL,
      findings_count  INTEGER NOT NULL DEFAULT 0,
      result_data     JSONB NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (review_id, run_id)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_review_results_run_id_idx ON ap_review_results(run_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_review_results_type_idx ON ap_review_results(review_type)`);

  // ── Sprint 5: Security Events ──────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_security_events (
      event_id        TEXT NOT NULL,
      run_id          TEXT NOT NULL REFERENCES ap_runs(run_id) ON DELETE CASCADE,
      step_id         TEXT,
      action_id       TEXT,
      tool_id         TEXT,
      event_type      TEXT NOT NULL,
      decision        TEXT NOT NULL,
      reason_code     TEXT,
      approval_id     TEXT,
      timestamp       TIMESTAMPTZ NOT NULL,
      event_data      JSONB NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (event_id, run_id)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_security_events_run_id_idx ON ap_security_events(run_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_security_events_action_id_idx ON ap_security_events(action_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_security_events_type_idx ON ap_security_events(event_type)`);

  // ── Sprint 5: Run Outcomes ─────────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_run_outcomes (
      run_id              TEXT PRIMARY KEY REFERENCES ap_runs(run_id) ON DELETE CASCADE,
      status              TEXT NOT NULL,
      verification_status TEXT NOT NULL,
      outcome_data        JSONB NOT NULL,
      completed_at        TIMESTAMPTZ NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_run_outcomes_status_idx ON ap_run_outcomes(status)`);

  // ── Sprint 6: Run Comparisons ─────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_run_comparisons (
      comparison_id     TEXT PRIMARY KEY,
      baseline_run_id   TEXT NOT NULL,
      candidate_run_id  TEXT NOT NULL,
      project_id        TEXT,
      relationship      TEXT NOT NULL,
      verdict           TEXT NOT NULL,
      schema_version    TEXT NOT NULL,
      comparison_data   JSONB NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_run_comparisons_baseline_run_id_idx ON ap_run_comparisons(baseline_run_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_run_comparisons_candidate_run_id_idx ON ap_run_comparisons(candidate_run_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_run_comparisons_project_id_idx ON ap_run_comparisons(project_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_run_comparisons_created_at_idx ON ap_run_comparisons(created_at DESC)`);

  // ── Sprint 6: Comparison Divergences ──────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_comparison_divergences (
      divergence_id     TEXT PRIMARY KEY,
      comparison_id     TEXT NOT NULL REFERENCES ap_run_comparisons(comparison_id) ON DELETE CASCADE,
      dimension         TEXT NOT NULL,
      severity          TEXT NOT NULL,
      deterministic     BOOLEAN NOT NULL DEFAULT TRUE,
      causal_status     TEXT NOT NULL,
      description       TEXT NOT NULL,
      divergence_data   JSONB NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_comparison_divergences_comparison_id_idx ON ap_comparison_divergences(comparison_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_comparison_divergences_dimension_idx ON ap_comparison_divergences(dimension)`);

  // ── Sprint 7: Context Intelligence Reports ─────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_context_intelligence_reports (
      report_id       TEXT PRIMARY KEY,
      run_id          TEXT NOT NULL REFERENCES ap_runs(run_id) ON DELETE CASCADE,
      schema_version  TEXT NOT NULL,
      report_data     JSONB NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_context_intelligence_reports_run_id_idx ON ap_context_intelligence_reports(run_id)`);

  // ── Sprint 7: Memory Intelligence Reports ──────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_memory_intelligence_reports (
      report_id       TEXT PRIMARY KEY,
      run_id          TEXT NOT NULL REFERENCES ap_runs(run_id) ON DELETE CASCADE,
      schema_version  TEXT NOT NULL,
      report_data     JSONB NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_memory_intelligence_reports_run_id_idx ON ap_memory_intelligence_reports(run_id)`);

  // ── Sprint 8: Eval Definitions ─────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_eval_definitions (
      eval_definition_id  TEXT NOT NULL,
      version             INTEGER NOT NULL DEFAULT 1,
      name                TEXT NOT NULL,
      family              TEXT NOT NULL,
      target_scope        TEXT NOT NULL,
      grader_type         TEXT NOT NULL,
      severity            TEXT NOT NULL DEFAULT 'fail',
      required            BOOLEAN NOT NULL DEFAULT TRUE,
      content_hash        TEXT NOT NULL,
      definition_data     JSONB NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (eval_definition_id, version)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_eval_definitions_family_idx ON ap_eval_definitions(family)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_eval_definitions_grader_type_idx ON ap_eval_definitions(grader_type)`);

  // ── Sprint 8: Eval Suites ──────────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_eval_suites (
      suite_id            TEXT NOT NULL,
      version             INTEGER NOT NULL DEFAULT 1,
      name                TEXT NOT NULL,
      content_hash        TEXT NOT NULL,
      suite_data          JSONB NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (suite_id, version)
    )
  `);

  // ── Sprint 8: Eval Datasets & Cases ────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_eval_datasets (
      dataset_id          TEXT NOT NULL,
      version             INTEGER NOT NULL DEFAULT 1,
      name                TEXT NOT NULL,
      content_hash        TEXT NOT NULL,
      case_count          INTEGER NOT NULL DEFAULT 0,
      dataset_data        JSONB NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (dataset_id, version)
    )
  `);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_eval_cases (
      case_id             TEXT NOT NULL,
      dataset_id          TEXT NOT NULL,
      dataset_version     INTEGER NOT NULL DEFAULT 1,
      name                TEXT NOT NULL,
      source_run_id       TEXT,
      case_data           JSONB NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (case_id, dataset_id, dataset_version)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_eval_cases_dataset_idx ON ap_eval_cases(dataset_id, dataset_version)`);

  // ── Sprint 8: Evaluation Runs ──────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_evaluation_runs (
      evaluation_run_id   TEXT PRIMARY KEY,
      suite_id            TEXT NOT NULL,
      suite_version       INTEGER NOT NULL DEFAULT 1,
      dataset_id          TEXT,
      dataset_version     INTEGER,
      status              TEXT NOT NULL,
      started_at          TIMESTAMPTZ NOT NULL,
      completed_at        TIMESTAMPTZ,
      verdict             TEXT NOT NULL,
      pass_rate           NUMERIC(5,4) NOT NULL,
      total_evals         INTEGER NOT NULL,
      cost_usd            NUMERIC(12,6) NOT NULL DEFAULT 0,
      duration_ms         INTEGER NOT NULL DEFAULT 0,
      run_data            JSONB NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_evaluation_runs_suite_idx ON ap_evaluation_runs(suite_id, suite_version)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_evaluation_runs_status_idx ON ap_evaluation_runs(status)`);

  // ── Sprint 8: Experiments ──────────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_experiments (
      experiment_id       TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      hypothesis          TEXT,
      baseline_run_id     TEXT NOT NULL,
      eval_suite_id       TEXT NOT NULL,
      status              TEXT NOT NULL,
      arms_count          INTEGER NOT NULL DEFAULT 0,
      repetitions         INTEGER NOT NULL DEFAULT 1,
      experiment_data     JSONB NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_experiments_baseline_idx ON ap_experiments(baseline_run_id)`);

  // ── Sprint 8: Experiment Trials ────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_experiment_trials (
      trial_id            TEXT PRIMARY KEY,
      experiment_id       TEXT NOT NULL,
      arm_id              TEXT NOT NULL,
      repetition_index    INTEGER NOT NULL DEFAULT 0,
      derived_run_id      TEXT NOT NULL,
      status              TEXT NOT NULL,
      candidate_cost_usd  NUMERIC(12,6) NOT NULL DEFAULT 0,
      grader_cost_usd     NUMERIC(12,6) NOT NULL DEFAULT 0,
      duration_ms         INTEGER NOT NULL DEFAULT 0,
      trial_data          JSONB NOT NULL,
      started_at          TIMESTAMPTZ NOT NULL,
      completed_at        TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_experiment_trials_exp_idx ON ap_experiment_trials(experiment_id)`);

  // ── Sprint 8: Experiment Results ───────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_experiment_results (
      experiment_id       TEXT PRIMARY KEY,
      status              TEXT NOT NULL,
      baseline_arm_id     TEXT NOT NULL,
      recommended_candidate TEXT,
      recommendation_basis TEXT NOT NULL,
      trials_executed     INTEGER NOT NULL DEFAULT 0,
      total_cost_usd      NUMERIC(12,6) NOT NULL DEFAULT 0,
      result_data         JSONB NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at        TIMESTAMPTZ NOT NULL
    )
  `);

  // ── Sprint 9: Regression Baselines ──────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_regression_baselines (
      baseline_id         TEXT PRIMARY KEY,
      project_id          TEXT NOT NULL,
      agent_id            TEXT,
      run_id              TEXT,
      configuration_hash  TEXT NOT NULL,
      eval_suite_id       TEXT NOT NULL,
      eval_suite_version  INTEGER NOT NULL,
      dataset_id          TEXT,
      dataset_version     INTEGER,
      approved_at         TIMESTAMPTZ NOT NULL,
      approved_by         TEXT,
      label               TEXT,
      release_version     TEXT,
      evidence_hash       TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'ACTIVE',
      baseline_data       JSONB NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_regression_baselines_project_idx ON ap_regression_baselines(project_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_regression_baselines_agent_idx ON ap_regression_baselines(agent_id)`);

  // ── Sprint 9: Regression Gate Policies ──────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_regression_gate_policies (
      policy_id           TEXT NOT NULL,
      version             INTEGER NOT NULL,
      name                TEXT NOT NULL,
      policy_data         JSONB NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (policy_id, version)
    )
  `);

  // ── Sprint 9: Regression Gate Results ───────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_regression_gate_results (
      gate_id             TEXT PRIMARY KEY,
      policy_id           TEXT NOT NULL,
      policy_version      INTEGER NOT NULL,
      baseline_id         TEXT NOT NULL,
      candidate_run_id    TEXT NOT NULL,
      candidate_config_hash TEXT NOT NULL,
      status              TEXT NOT NULL,
      gate_data           JSONB NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_regression_gate_results_baseline_idx ON ap_regression_gate_results(baseline_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_regression_gate_results_candidate_idx ON ap_regression_gate_results(candidate_run_id)`);

  // ── Sprint 9: Regression Reports ────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_regression_reports (
      report_id           TEXT PRIMARY KEY,
      project_id          TEXT NOT NULL,
      baseline_id         TEXT NOT NULL,
      candidate_run_id    TEXT NOT NULL,
      status              TEXT NOT NULL,
      report_data         JSONB NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_regression_reports_project_idx ON ap_regression_reports(project_id)`);

  // ── Sprint 9: Capability Snapshots ──────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_capability_snapshots (
      capability_snapshot_id TEXT PRIMARY KEY,
      project_id          TEXT NOT NULL,
      agent_id            TEXT NOT NULL,
      agent_version       TEXT NOT NULL,
      configuration_hash  TEXT NOT NULL,
      suite_id            TEXT NOT NULL,
      suite_version       INTEGER NOT NULL,
      dataset_id          TEXT,
      dataset_version     INTEGER,
      overall_status      TEXT NOT NULL,
      evidence_quality    TEXT NOT NULL,
      snapshot_data       JSONB NOT NULL,
      captured_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_capability_snapshots_agent_idx ON ap_capability_snapshots(agent_id)`);

  // ── Sprint 9: Capability Drift Reports ──────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_capability_drift_reports (
      report_id           TEXT PRIMARY KEY,
      baseline_snapshot_id TEXT NOT NULL,
      candidate_snapshot_id TEXT NOT NULL,
      agent_id            TEXT NOT NULL,
      baseline_version    TEXT NOT NULL,
      candidate_version   TEXT NOT NULL,
      overall_drift       TEXT NOT NULL,
      report_data         JSONB NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_capability_drift_reports_agent_idx ON ap_capability_drift_reports(agent_id)`);

  // ── Sprint 9: Policy Snapshots ──────────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_policy_snapshots (
      policy_snapshot_id  TEXT PRIMARY KEY,
      project_id          TEXT NOT NULL,
      run_id              TEXT NOT NULL,
      policy_id           TEXT NOT NULL,
      policy_version      INTEGER NOT NULL,
      configuration_hash  TEXT NOT NULL,
      snapshot_data       JSONB NOT NULL,
      captured_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_policy_snapshots_run_idx ON ap_policy_snapshots(run_id)`);

  // ── Sprint 9: Policy Drift Reports ──────────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_policy_drift_reports (
      drift_report_id     TEXT PRIMARY KEY,
      baseline_snapshot_id TEXT NOT NULL,
      candidate_snapshot_id TEXT NOT NULL,
      baseline_run_id     TEXT NOT NULL,
      candidate_run_id    TEXT NOT NULL,
      has_critical_drift  BOOLEAN NOT NULL DEFAULT FALSE,
      report_data         JSONB NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_policy_drift_reports_baseline_idx ON ap_policy_drift_reports(baseline_snapshot_id)`);

  // ── Sprint 9: Release Evidence Snapshots ────────────────────────────────────
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ap_release_evidence (
      release_evidence_id TEXT PRIMARY KEY,
      project_id          TEXT NOT NULL,
      release_version     TEXT NOT NULL,
      git_sha             TEXT,
      agent_id            TEXT NOT NULL,
      configuration_hash  TEXT NOT NULL,
      capability_snapshot_id TEXT NOT NULL,
      policy_snapshot_id  TEXT NOT NULL,
      eval_suite_id       TEXT NOT NULL,
      eval_suite_version  INTEGER NOT NULL,
      regression_gate_result_id TEXT NOT NULL,
      regression_gate_status TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'CANDIDATE',
      evidence_hash       TEXT NOT NULL,
      snapshot_data       JSONB NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_release_evidence_project_idx ON ap_release_evidence(project_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ap_release_evidence_agent_idx ON ap_release_evidence(agent_id)`);
}
