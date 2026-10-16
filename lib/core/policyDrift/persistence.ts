/**
 * Policy Drift Persistence Engine.
 *
 * Implements dual-mode persistence (File + Postgres) for:
 * - PolicyBehaviorSnapshot (immutable audit record)
 * - PolicyDriftReport (versioned comparison evidence)
 *
 * Directory layout:
 * .reeprov/policy-drift/snapshots/
 * .reeprov/policy-drift/reports/
 */

import { access, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type PolicyBehaviorSnapshot,
  type PolicyDriftReport,
  policyBehaviorSnapshotSchema,
  policyDriftReportSchema,
} from "../contracts/policyDrift";
import { getDb, hasDatabaseUrl } from "../../db/client";
import { ensureSchema } from "../../db/migrate";

import { getReeprovEnv } from "@/lib/config/env";
import { getReeprovHome } from "@/lib/storage/dataPath";

function basePolicyDriftDir(): string {
  const base =
    getReeprovEnv("REEPROV_STORE_DIR") ??
    getReeprovEnv("REEPROV_HOME") ??
    getReeprovHome();
  return join(base, "policy-drift");
}

function safeId(id: string): string {
  return id.replace(/[^a-z0-9_@-]/gi, "");
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await access(dirPath);
  } catch {
    await mkdir(dirPath, { recursive: true });
  }
}

// ── 1. Policy Snapshots ──────────────────────────────────────────────────────

function snapshotsDir(): string {
  return join(basePolicyDriftDir(), "snapshots");
}

export async function savePolicyBehaviorSnapshot(snapshot: PolicyBehaviorSnapshot): Promise<void> {
  const parsed = policyBehaviorSnapshotSchema.parse(snapshot);
  await ensureDir(snapshotsDir());
  const filePath = join(snapshotsDir(), `${safeId(parsed.policy_snapshot_id)}.json`);
  await writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");

  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      await sql`
        INSERT INTO ap_policy_snapshots (
          policy_snapshot_id,
          project_id,
          run_id,
          policy_id,
          policy_version,
          configuration_hash,
          snapshot_data,
          captured_at
        ) VALUES (
          ${parsed.policy_snapshot_id},
          ${parsed.project_id},
          ${parsed.run_id},
          ${parsed.policy_id},
          ${parsed.policy_version},
          ${parsed.configuration_hash},
          ${JSON.stringify(parsed)},
          ${parsed.captured_at}
        )
        ON CONFLICT (policy_snapshot_id) DO UPDATE SET
          snapshot_data = EXCLUDED.snapshot_data
      `;
    } catch {
      // Non-fatal
    }
  }
}

export async function getPolicyBehaviorSnapshot(id: string): Promise<PolicyBehaviorSnapshot | null> {
  const filePath = join(snapshotsDir(), `${safeId(id)}.json`);
  try {
    const raw = await readFile(filePath, "utf8");
    return policyBehaviorSnapshotSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listPolicyBehaviorSnapshots(): Promise<PolicyBehaviorSnapshot[]> {
  try {
    await ensureDir(snapshotsDir());
    const files = await readdir(snapshotsDir());
    const results: PolicyBehaviorSnapshot[] = [];
    for (const f of files) {
      if (f.endsWith(".json")) {
        try {
          const raw = await readFile(join(snapshotsDir(), f), "utf8");
          results.push(policyBehaviorSnapshotSchema.parse(JSON.parse(raw)));
        } catch {
          // ignore corrupted files
        }
      }
    }
    return results.sort((a, b) => b.captured_at.localeCompare(a.captured_at));
  } catch {
    return [];
  }
}

// ── 2. Drift Reports ─────────────────────────────────────────────────────────

function reportsDir(): string {
  return join(basePolicyDriftDir(), "reports");
}

export async function savePolicyDriftReport(report: PolicyDriftReport): Promise<void> {
  const parsed = policyDriftReportSchema.parse(report);
  await ensureDir(reportsDir());
  const filePath = join(reportsDir(), `${safeId(parsed.drift_report_id)}.json`);
  await writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");

  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      await sql`
        INSERT INTO ap_policy_drift_reports (
          drift_report_id,
          baseline_snapshot_id,
          candidate_snapshot_id,
          baseline_run_id,
          candidate_run_id,
          has_critical_drift,
          report_data,
          created_at
        ) VALUES (
          ${parsed.drift_report_id},
          ${parsed.baseline_snapshot_id},
          ${parsed.candidate_snapshot_id},
          ${parsed.baseline_run_id},
          ${parsed.candidate_run_id},
          ${parsed.has_critical_drift},
          ${JSON.stringify(parsed)},
          ${parsed.created_at}
        )
        ON CONFLICT (drift_report_id) DO UPDATE SET
          has_critical_drift = EXCLUDED.has_critical_drift,
          report_data = EXCLUDED.report_data
      `;
    } catch {
      // Non-fatal
    }
  }
}

export async function getPolicyDriftReport(id: string): Promise<PolicyDriftReport | null> {
  const filePath = join(reportsDir(), `${safeId(id)}.json`);
  try {
    const raw = await readFile(filePath, "utf8");
    return policyDriftReportSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listPolicyDriftReports(): Promise<PolicyDriftReport[]> {
  try {
    await ensureDir(reportsDir());
    const files = await readdir(reportsDir());
    const results: PolicyDriftReport[] = [];
    for (const f of files) {
      if (f.endsWith(".json")) {
        try {
          const raw = await readFile(join(reportsDir(), f), "utf8");
          results.push(policyDriftReportSchema.parse(JSON.parse(raw)));
        } catch {
          // ignore
        }
      }
    }
    return results.sort((a, b) => b.created_at.localeCompare(a.created_at));
  } catch {
    return [];
  }
}

