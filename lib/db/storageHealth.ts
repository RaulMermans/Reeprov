import { getDb, hasDatabaseUrl } from "./client";
import { fileRunStore } from "@/lib/runs/runStore";
import packageJson from "@/package.json";

export const REEPROV_TABLES = [
  "ap_integrations",
  "ap_runs",
  "ap_trace_events",
  "ap_tool_calls",
  "ap_eval_results",
  "ap_reports",
  "ap_workflow_specs",
  "ap_ingest_diagnostics",
  "ap_content_blobs",
  "ap_execution_boundaries",
  "ap_context_snapshots",
  "ap_canonical_runs",
  "ap_replay_runs",
  "ap_replay_events",
  "ap_replay_divergences",
  "ap_agent_config_snapshots",
  "ap_verification_events",
  "ap_test_results",
  "ap_review_results",
  "ap_security_events",
  "ap_run_outcomes",
  "ap_run_comparisons",
  "ap_comparison_divergences",
  "ap_context_intelligence_reports",
  "ap_memory_intelligence_reports",
  "ap_eval_definitions",
  "ap_eval_suites",
  "ap_eval_datasets",
  "ap_eval_cases",
  "ap_evaluation_runs",
  "ap_experiments",
  "ap_experiment_trials",
  "ap_experiment_results",
  "ap_regression_baselines",
  "ap_regression_gate_policies",
  "ap_regression_gate_results",
  "ap_regression_reports",
  "ap_capability_snapshots",
  "ap_capability_drift_reports",
  "ap_policy_snapshots",
  "ap_policy_drift_reports",
  "ap_release_evidence",
] as const;

/** Legacy alias during AgentPulse -> Reeprov migration */
export const AGENTPULSE_TABLES = REEPROV_TABLES;

export type DeploymentEnvironment = "production" | "preview" | "development";

export type StorageHealth = {
  driver: "postgres" | "file";
  databaseUrlPresent: boolean;
  tablesPresent: string[];
  missingTables: string[];
  runCount: number;
  environment: DeploymentEnvironment;
  version: string;
};

/**
 * Resolves the deployment environment from Vercel's system env vars,
 * falling back to NODE_ENV for local/dev use.
 */
export function getDeploymentEnvironment(): DeploymentEnvironment {
  const vercelEnv = process.env["VERCEL_ENV"];
  if (vercelEnv === "production" || vercelEnv === "preview" || vercelEnv === "development") {
    return vercelEnv;
  }
  return process.env["NODE_ENV"] === "production" ? "production" : "development";
}

/**
 * Best-effort build identifier: Vercel's git commit SHA when deployed,
 * otherwise the package.json version.
 */
export function getAppVersion(): string {
  const commitSha = process.env["VERCEL_GIT_COMMIT_SHA"];
  if (commitSha) return commitSha.slice(0, 7);
  return packageJson.version;
}

export async function getStorageHealth(): Promise<StorageHealth> {
  const databaseUrlPresent = hasDatabaseUrl();
  const environment = getDeploymentEnvironment();
  const version = getAppVersion();

  if (!databaseUrlPresent) {
    const runCount = (await fileRunStore.listRuns()).length;
    return {
      driver: "file",
      databaseUrlPresent,
      tablesPresent: [],
      missingTables: [...REEPROV_TABLES],
      runCount,
      environment,
      version,
    };
  }

  const sql = getDb();
  const rows = await sql`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename LIKE 'ap_%'
    ORDER BY tablename ASC
  `;

  const tablesPresent = rows.map((row) => String(row["tablename"]));
  const missingTables = REEPROV_TABLES.filter((table) => !tablesPresent.includes(table));

  let runCount = 0;
  if (tablesPresent.includes("ap_runs")) {
    const countRows = await sql`SELECT COUNT(*)::int AS count FROM ap_runs`;
    runCount = Number(countRows[0]?.["count"] ?? 0);
  }

  return {
    driver: "postgres",
    databaseUrlPresent,
    tablesPresent,
    missingTables,
    runCount,
    environment,
    version,
  };
}
