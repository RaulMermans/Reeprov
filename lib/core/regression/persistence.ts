/**
 * Regression Persistence Engine.
 *
 * Implements dual-mode persistence (File + Postgres) for:
 * - RegressionBaseline (immutable, auditable)
 * - RegressionGatePolicy (versioned)
 * - RegressionGateResult (immutable once executed)
 * - RegressionReport (immutable release evidence)
 *
 * Directory layout:
 * .agentpulse/regressions/baselines/
 * .agentpulse/regressions/policies/
 * .agentpulse/regressions/gates/
 * .agentpulse/regressions/reports/
 */

import { access, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type RegressionBaseline,
  type RegressionGatePolicy,
  type RegressionGateResult,
  type RegressionReport,
  regressionBaselineSchema,
  regressionGatePolicySchema,
  regressionGateResultSchema,
  regressionReportSchema,
} from "../contracts/regression";
import { getDb, hasDatabaseUrl } from "../../db/client";
import { ensureSchema } from "../../db/migrate";

function baseRegressionDir(): string {
  const base = process.env["AGENTPULSE_STORE_DIR"] ?? join(process.cwd(), ".agentpulse");
  return join(base, "regressions");
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

// ── 1. Baselines ─────────────────────────────────────────────────────────────

function baselinesDir(): string {
  return join(baseRegressionDir(), "baselines");
}

export async function saveRegressionBaseline(baseline: RegressionBaseline): Promise<void> {
  const parsed = regressionBaselineSchema.parse(baseline);
  await ensureDir(baselinesDir());
  const filePath = join(baselinesDir(), `${safeId(parsed.baseline_id)}.json`);
  await writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");

  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      await sql`
        INSERT INTO ap_regression_baselines (
          baseline_id,
          project_id,
          agent_id,
          run_id,
          configuration_hash,
          eval_suite_id,
          eval_suite_version,
          dataset_id,
          dataset_version,
          approved_at,
          approved_by,
          label,
          release_version,
          evidence_hash,
          status,
          baseline_data
        ) VALUES (
          ${parsed.baseline_id},
          ${parsed.project_id},
          ${parsed.agent_id ?? null},
          ${parsed.run_id ?? null},
          ${parsed.configuration_hash},
          ${parsed.eval_suite_id},
          ${parsed.eval_suite_version},
          ${parsed.dataset_id ?? null},
          ${parsed.dataset_version ?? null},
          ${parsed.approved_at},
          ${parsed.approved_by ?? null},
          ${parsed.label ?? null},
          ${parsed.release_version ?? null},
          ${parsed.evidence_hash},
          ${parsed.status},
          ${JSON.stringify(parsed)}
        )
        ON CONFLICT (baseline_id) DO UPDATE SET
          status = EXCLUDED.status,
          baseline_data = EXCLUDED.baseline_data
      `;
    } catch {
      // Non-fatal
    }
  }
}

export async function getRegressionBaseline(id: string): Promise<RegressionBaseline | null> {
  const filePath = join(baselinesDir(), `${safeId(id)}.json`);
  try {
    const raw = await readFile(filePath, "utf8");
    return regressionBaselineSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listRegressionBaselines(projectId?: string): Promise<RegressionBaseline[]> {
  try {
    await ensureDir(baselinesDir());
    const files = await readdir(baselinesDir());
    const results: RegressionBaseline[] = [];
    for (const f of files) {
      if (f.endsWith(".json")) {
        try {
          const raw = await readFile(join(baselinesDir(), f), "utf8");
          const b = regressionBaselineSchema.parse(JSON.parse(raw));
          if (!projectId || b.project_id === projectId) {
            results.push(b);
          }
        } catch {
          // ignore corrupted files
        }
      }
    }
    return results.sort((a, b) => b.approved_at.localeCompare(a.approved_at));
  } catch {
    return [];
  }
}

// ── 2. Policies ──────────────────────────────────────────────────────────────

function policiesDir(): string {
  return join(baseRegressionDir(), "policies");
}

export async function saveRegressionGatePolicy(policy: RegressionGatePolicy): Promise<void> {
  const parsed = regressionGatePolicySchema.parse(policy);
  await ensureDir(policiesDir());
  const filePath = join(policiesDir(), `${safeId(parsed.policy_id)}@v${parsed.version}.json`);
  await writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");

  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      await sql`
        INSERT INTO ap_regression_gate_policies (
          policy_id,
          version,
          name,
          policy_data
        ) VALUES (
          ${parsed.policy_id},
          ${parsed.version},
          ${parsed.name},
          ${JSON.stringify(parsed)}
        )
        ON CONFLICT (policy_id, version) DO UPDATE SET
          name = EXCLUDED.name,
          policy_data = EXCLUDED.policy_data
      `;
    } catch {
      // Non-fatal
    }
  }
}

export async function getRegressionGatePolicy(id: string, version: number = 1): Promise<RegressionGatePolicy | null> {
  const filePath = join(policiesDir(), `${safeId(id)}@v${version}.json`);
  try {
    const raw = await readFile(filePath, "utf8");
    return regressionGatePolicySchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listRegressionGatePolicies(): Promise<RegressionGatePolicy[]> {
  try {
    await ensureDir(policiesDir());
    const files = await readdir(policiesDir());
    const results: RegressionGatePolicy[] = [];
    for (const f of files) {
      if (f.endsWith(".json")) {
        try {
          const raw = await readFile(join(policiesDir(), f), "utf8");
          results.push(regressionGatePolicySchema.parse(JSON.parse(raw)));
        } catch {
          // ignore
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}

// ── 3. Gate Results ──────────────────────────────────────────────────────────

function gatesDir(): string {
  return join(baseRegressionDir(), "gates");
}

export async function saveRegressionGateResult(result: RegressionGateResult): Promise<void> {
  const parsed = regressionGateResultSchema.parse(result);
  await ensureDir(gatesDir());
  const filePath = join(gatesDir(), `${safeId(parsed.gate_id)}.json`);
  await writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");

  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      await sql`
        INSERT INTO ap_regression_gate_results (
          gate_id,
          policy_id,
          policy_version,
          baseline_id,
          candidate_run_id,
          candidate_config_hash,
          status,
          gate_data,
          created_at
        ) VALUES (
          ${parsed.gate_id},
          ${parsed.policy_id},
          ${parsed.policy_version},
          ${parsed.baseline_id},
          ${parsed.candidate_run_id},
          ${parsed.candidate_config_hash},
          ${parsed.status},
          ${JSON.stringify(parsed)},
          ${parsed.created_at}
        )
        ON CONFLICT (gate_id) DO UPDATE SET
          status = EXCLUDED.status,
          gate_data = EXCLUDED.gate_data
      `;
    } catch {
      // Non-fatal
    }
  }
}

export async function getRegressionGateResult(id: string): Promise<RegressionGateResult | null> {
  const filePath = join(gatesDir(), `${safeId(id)}.json`);
  try {
    const raw = await readFile(filePath, "utf8");
    return regressionGateResultSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listRegressionGateResults(): Promise<RegressionGateResult[]> {
  try {
    await ensureDir(gatesDir());
    const files = await readdir(gatesDir());
    const results: RegressionGateResult[] = [];
    for (const f of files) {
      if (f.endsWith(".json")) {
        try {
          const raw = await readFile(join(gatesDir(), f), "utf8");
          results.push(regressionGateResultSchema.parse(JSON.parse(raw)));
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

// ── 4. Reports ───────────────────────────────────────────────────────────────

function reportsDir(): string {
  return join(baseRegressionDir(), "reports");
}

export async function saveRegressionReport(report: RegressionReport): Promise<void> {
  const parsed = regressionReportSchema.parse(report);
  await ensureDir(reportsDir());
  const filePath = join(reportsDir(), `${safeId(parsed.report_id)}.json`);
  await writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");

  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      await sql`
        INSERT INTO ap_regression_reports (
          report_id,
          project_id,
          baseline_id,
          candidate_run_id,
          status,
          report_data,
          created_at
        ) VALUES (
          ${parsed.report_id},
          ${parsed.project_id},
          ${parsed.baseline.baseline_id},
          ${parsed.candidate_run_id},
          ${parsed.gate_result.status},
          ${JSON.stringify(parsed)},
          ${parsed.created_at}
        )
        ON CONFLICT (report_id) DO UPDATE SET
          status = EXCLUDED.status,
          report_data = EXCLUDED.report_data
      `;
    } catch {
      // Non-fatal
    }
  }
}

export async function getRegressionReport(id: string): Promise<RegressionReport | null> {
  const filePath = join(reportsDir(), `${safeId(id)}.json`);
  try {
    const raw = await readFile(filePath, "utf8");
    return regressionReportSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listRegressionReports(projectId?: string): Promise<RegressionReport[]> {
  try {
    await ensureDir(reportsDir());
    const files = await readdir(reportsDir());
    const results: RegressionReport[] = [];
    for (const f of files) {
      if (f.endsWith(".json")) {
        try {
          const raw = await readFile(join(reportsDir(), f), "utf8");
          const r = regressionReportSchema.parse(JSON.parse(raw));
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
