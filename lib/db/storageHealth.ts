import { getDb, hasDatabaseUrl } from "./client";

export const AGENTPULSE_TABLES = [
  "ap_integrations",
  "ap_runs",
  "ap_trace_events",
  "ap_tool_calls",
  "ap_eval_results",
  "ap_reports",
  "ap_workflow_specs",
] as const;

export type StorageHealth = {
  driver: "postgres" | "file";
  databaseUrlPresent: boolean;
  tablesPresent: string[];
};

export async function getStorageHealth(): Promise<StorageHealth> {
  const databaseUrlPresent = hasDatabaseUrl();

  if (!databaseUrlPresent) {
    return {
      driver: "file",
      databaseUrlPresent,
      tablesPresent: [],
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

  return {
    driver: "postgres",
    databaseUrlPresent,
    tablesPresent: rows.map((row) => String(row["tablename"])),
  };
}
