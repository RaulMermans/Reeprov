/**
 * Release Evidence Persistence Engine.
 *
 * Implements dual-mode persistence (File + Postgres) for:
 * - ReleaseEvidenceSnapshot (immutable once created)
 *
 * Directory layout:
 * .reeprov/releases/
 */

import { access, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type ReleaseEvidenceSnapshot,
  releaseEvidenceSnapshotSchema,
} from "../contracts/releaseEvidence";
import { getDb, hasDatabaseUrl } from "../../db/client";
import { ensureSchema } from "../../db/migrate";

import { getReeprovEnv } from "@/lib/config/env";
import { getReeprovHome } from "@/lib/storage/dataPath";

function baseReleasesDir(): string {
  const base =
    getReeprovEnv("REEPROV_STORE_DIR") ??
    getReeprovEnv("REEPROV_HOME") ??
    getReeprovHome();
  return join(base, "releases");
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

export async function saveReleaseEvidenceSnapshot(snapshot: ReleaseEvidenceSnapshot): Promise<void> {
  const parsed = releaseEvidenceSnapshotSchema.parse(snapshot);
  await ensureDir(baseReleasesDir());
  const filePath = join(baseReleasesDir(), `${safeId(parsed.release_evidence_id)}.json`);
  await writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");

  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      await sql`
        INSERT INTO ap_release_evidence (
          release_evidence_id,
          project_id,
          release_version,
          git_sha,
          agent_id,
          configuration_hash,
          capability_snapshot_id,
          policy_snapshot_id,
          eval_suite_id,
          eval_suite_version,
          regression_gate_result_id,
          regression_gate_status,
          status,
          evidence_hash,
          snapshot_data,
          created_at
        ) VALUES (
          ${parsed.release_evidence_id},
          ${parsed.project_id},
          ${parsed.release_version},
          ${parsed.git_sha ?? null},
          ${parsed.agent_id},
          ${parsed.configuration_hash},
          ${parsed.capability_snapshot_id},
          ${parsed.policy_snapshot_id},
          ${parsed.eval_suite_id},
          ${parsed.eval_suite_version},
          ${parsed.regression_gate_result_id},
          ${parsed.regression_gate_status},
          ${parsed.status},
          ${parsed.evidence_hash},
          ${JSON.stringify(parsed)},
          ${parsed.created_at}
        )
        ON CONFLICT (release_evidence_id) DO UPDATE SET
          status = EXCLUDED.status,
          snapshot_data = EXCLUDED.snapshot_data
      `;
    } catch {
      // Non-fatal
    }
  }
}

export async function getReleaseEvidenceSnapshot(id: string): Promise<ReleaseEvidenceSnapshot | null> {
  const filePath = join(baseReleasesDir(), `${safeId(id)}.json`);
  try {
    const raw = await readFile(filePath, "utf8");
    return releaseEvidenceSnapshotSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listReleaseEvidenceSnapshots(projectId?: string): Promise<ReleaseEvidenceSnapshot[]> {
  try {
    await ensureDir(baseReleasesDir());
    const files = await readdir(baseReleasesDir());
    const results: ReleaseEvidenceSnapshot[] = [];
    for (const f of files) {
      if (f.endsWith(".json")) {
        try {
          const raw = await readFile(join(baseReleasesDir(), f), "utf8");
          const r = releaseEvidenceSnapshotSchema.parse(JSON.parse(raw));
          if (!projectId || r.project_id === projectId) {
            results.push(r);
          }
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

export async function getReleaseEvidenceByVersion(version: string): Promise<ReleaseEvidenceSnapshot | null> {
  const all = await listReleaseEvidenceSnapshots();
  return all.find((r) => r.release_version === version) ?? null;
}

