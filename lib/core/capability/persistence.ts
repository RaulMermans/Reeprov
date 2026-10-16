/**
 * Capability Persistence Engine.
 *
 * Implements dual-mode persistence (File + Postgres) for:
 * - CapabilitySnapshot (immutable once captured)
 * - CapabilityDriftReport (versioned comparison evidence)
 *
 * Directory layout:
 * .reeprov/capabilities/snapshots/
 * .reeprov/capabilities/drift/
 */

import { access, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type CapabilitySnapshot,
  type CapabilityDriftReport,
  type CapabilityHistory,
  capabilitySnapshotSchema,
  capabilityDriftReportSchema,
  capabilityHistorySchema,
} from "../contracts/capability";
import { getDb, hasDatabaseUrl } from "../../db/client";
import { ensureSchema } from "../../db/migrate";

import { getReeprovEnv } from "@/lib/config/env";
import { getReeprovHome } from "@/lib/storage/dataPath";

function baseCapabilitiesDir(): string {
  const base =
    getReeprovEnv("REEPROV_STORE_DIR") ??
    getReeprovEnv("REEPROV_HOME") ??
    getReeprovHome();
  return join(base, "capabilities");
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

// ── 1. Snapshots ─────────────────────────────────────────────────────────────

function snapshotsDir(): string {
  return join(baseCapabilitiesDir(), "snapshots");
}

export async function saveCapabilitySnapshot(snapshot: CapabilitySnapshot): Promise<void> {
  const parsed = capabilitySnapshotSchema.parse(snapshot);
  await ensureDir(snapshotsDir());
  const filePath = join(snapshotsDir(), `${safeId(parsed.capability_snapshot_id)}.json`);
  await writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");

  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      await sql`
        INSERT INTO ap_capability_snapshots (
          capability_snapshot_id,
          project_id,
          agent_id,
          agent_version,
          configuration_hash,
          suite_id,
          suite_version,
          dataset_id,
          dataset_version,
          overall_status,
          evidence_quality,
          snapshot_data,
          captured_at
        ) VALUES (
          ${parsed.capability_snapshot_id},
          ${parsed.project_id},
          ${parsed.agent_id},
          ${parsed.agent_version},
          ${parsed.configuration_hash},
          ${parsed.suite_id},
          ${parsed.suite_version},
          ${parsed.dataset_id ?? null},
          ${parsed.dataset_version ?? null},
          ${parsed.overall_status},
          ${parsed.evidence_quality},
          ${JSON.stringify(parsed)},
          ${parsed.captured_at}
        )
        ON CONFLICT (capability_snapshot_id) DO UPDATE SET
          overall_status = EXCLUDED.overall_status,
          snapshot_data = EXCLUDED.snapshot_data
      `;
    } catch {
      // Non-fatal
    }
  }
}

export async function getCapabilitySnapshot(id: string): Promise<CapabilitySnapshot | null> {
  const filePath = join(snapshotsDir(), `${safeId(id)}.json`);
  try {
    const raw = await readFile(filePath, "utf8");
    return capabilitySnapshotSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listCapabilitySnapshots(agentId?: string): Promise<CapabilitySnapshot[]> {
  try {
    await ensureDir(snapshotsDir());
    const files = await readdir(snapshotsDir());
    const results: CapabilitySnapshot[] = [];
    for (const f of files) {
      if (f.endsWith(".json")) {
        try {
          const raw = await readFile(join(snapshotsDir(), f), "utf8");
          const s = capabilitySnapshotSchema.parse(JSON.parse(raw));
          if (!agentId || s.agent_id === agentId) {
            results.push(s);
          }
        } catch {
          // ignore corrupted files
        }
      }
    }
    return results.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  } catch {
    return [];
  }
}

// ── 2. Drift Reports ─────────────────────────────────────────────────────────

function driftDir(): string {
  return join(baseCapabilitiesDir(), "drift");
}

export async function saveCapabilityDriftReport(report: CapabilityDriftReport): Promise<void> {
  const parsed = capabilityDriftReportSchema.parse(report);
  await ensureDir(driftDir());
  const filePath = join(driftDir(), `${safeId(parsed.report_id)}.json`);
  await writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");

  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      await sql`
        INSERT INTO ap_capability_drift_reports (
          report_id,
          baseline_snapshot_id,
          candidate_snapshot_id,
          agent_id,
          baseline_version,
          candidate_version,
          overall_drift,
          report_data,
          created_at
        ) VALUES (
          ${parsed.report_id},
          ${parsed.baseline_snapshot_id},
          ${parsed.candidate_snapshot_id},
          ${parsed.agent_id},
          ${parsed.baseline_version},
          ${parsed.candidate_version},
          ${parsed.overall_drift},
          ${JSON.stringify(parsed)},
          ${parsed.created_at}
        )
        ON CONFLICT (report_id) DO UPDATE SET
          overall_drift = EXCLUDED.overall_drift,
          report_data = EXCLUDED.report_data
      `;
    } catch {
      // Non-fatal
    }
  }
}

export async function getCapabilityDriftReport(id: string): Promise<CapabilityDriftReport | null> {
  const filePath = join(driftDir(), `${safeId(id)}.json`);
  try {
    const raw = await readFile(filePath, "utf8");
    return capabilityDriftReportSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listCapabilityDriftReports(): Promise<CapabilityDriftReport[]> {
  try {
    await ensureDir(driftDir());
    const files = await readdir(driftDir());
    const results: CapabilityDriftReport[] = [];
    for (const f of files) {
      if (f.endsWith(".json")) {
        try {
          const raw = await readFile(join(driftDir(), f), "utf8");
          results.push(capabilityDriftReportSchema.parse(JSON.parse(raw)));
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

export async function getCapabilityHistory(agentId: string): Promise<CapabilityHistory> {
  const snapshots = await listCapabilitySnapshots(agentId);
  return capabilityHistorySchema.parse({
    agent_id: agentId,
    snapshots: snapshots.sort((a, b) => a.captured_at.localeCompare(b.captured_at)),
  });
}

