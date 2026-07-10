"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { mergeAuthHeaders } from "@/lib/auth/internalKey";
import { useDashboardAuth } from "@/lib/auth/dashboardAuthContext";
import type { RunSummary } from "@/lib/runs/runTypes";

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "degraded") return "warning";
  return "neutral";
}

function formatDuration(ms?: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatCost(usd?: number): string {
  if (usd === undefined || usd === null) return "—";
  return `$${usd.toFixed(4)}`;
}

function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function RunsPage() {
  const { onUnauthorized } = useDashboardAuth();
  const router = useRouter();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [importingFixture, setImportingFixture] = useState(false);
  const [fixtureError, setFixtureError] = useState<string | null>(null);

  useEffect(() => {
    void loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRuns() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/runs?limit=100", {
        headers: mergeAuthHeaders(),
      });
      if (res.status === 401) {
        onUnauthorized("Access key expired or invalid. Please unlock again.");
        return;
      }
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setError(data.message ?? "Failed to load runs.");
        return;
      }
      const data = await res.json() as { runs: RunSummary[] };
      setRuns(data.runs ?? []);
    } catch {
      setError("Could not connect to AgentPulse. Is the dev server running?");
    } finally {
      setLoading(false);
    }
  }

  async function createDemoRun() {
    setCreatingDemo(true);
    setDemoError(null);
    try {
      const res = await fetch("/api/runs/demo", {
        method: "POST",
        headers: mergeAuthHeaders(),
      });
      if (res.status === 401) {
        onUnauthorized("Access key expired or invalid. Please unlock again.");
        return;
      }
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setDemoError(data.message ?? "Failed to create demo run.");
        return;
      }
      const data = await res.json() as { ok: boolean; runId: string; redirectTo: string };
      router.push(data.redirectTo);
    } catch {
      setDemoError("Could not create demo run. Is the dev server running?");
    } finally {
      setCreatingDemo(false);
    }
  }

  async function importFixture() {
    setImportingFixture(true);
    setFixtureError(null);
    try {
      const res = await fetch("/api/fixtures/customer-support-triage/import", {
        method: "POST",
        headers: mergeAuthHeaders(),
      });
      if (res.status === 401) {
        onUnauthorized("Access key expired or invalid. Please unlock again.");
        return;
      }
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setFixtureError(data.message ?? "Failed to import fixture.");
        return;
      }
      const data = await res.json() as { ok: boolean; runId: string; redirectTo: string };
      router.push(data.redirectTo);
    } catch {
      setFixtureError("Could not import fixture. Is the dev server running?");
    } finally {
      setImportingFixture(false);
    }
  }

  return (
    <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Runtime Proof Runs</h1>
            <span className="rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-xs font-medium text-teal-700">
              Live traces
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Real trace ingestion runs from connected AI projects. Each run is recorded from
            external trace events, validated against proof contracts, and fully inspectable here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            ← Overview
          </Link>
        </div>
      </section>

      {loading ? (
        <Card className="p-8 text-center text-sm text-slate-500">Loading runs…</Card>
      ) : error ? (
        <Card className="p-8">
          <p className="text-sm font-medium text-amber-700">{error}</p>
          <p className="mt-2 text-xs text-slate-500">
            Start the dev server and emit traces using the AgentPulse client, or create a demo run below.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={creatingDemo}
              onClick={() => void createDemoRun()}
              type="button"
            >
              {creatingDemo ? "Creating…" : "Create demo run"}
            </button>
            <button
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={importingFixture}
              onClick={() => void importFixture()}
              type="button"
            >
              {importingFixture ? "Importing…" : "Import fixture (demo data)"}
            </button>
          </div>
        </Card>
      ) : runs.length === 0 ? (
        <Card className="p-8">
          <p className="text-sm font-medium text-slate-700">No live proof runs yet.</p>
          <p className="mt-2 text-sm text-slate-500">
            Runtime runs appear here after a connected project emits AgentPulse trace events.
            Create a demo run to explore the runtime proof layer now — no external project needed.
          </p>
          {demoError ? (
            <p className="mt-2 text-xs text-red-600">{demoError}</p>
          ) : null}
          {fixtureError ? (
            <p className="mt-2 text-xs text-red-600">{fixtureError}</p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/dashboard/integrations"
              className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-800"
            >
              Add integration
            </Link>
            <button
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={creatingDemo}
              onClick={() => void createDemoRun()}
              type="button"
            >
              {creatingDemo ? "Creating demo run…" : "Create demo run"}
            </button>
            <button
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={importingFixture}
              onClick={() => void importFixture()}
              type="button"
            >
              {importingFixture ? "Importing…" : "Import fixture: Customer Support Triage"}
            </button>
            <Link
              href="/dashboard/scanner"
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Open Repository Scanner
            </Link>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            The fixture import is demo/test data for a non-BlogAgent inferred-mode workflow — it does not affect production behavior.
          </p>
          <details className="mt-6 text-xs text-slate-500">
            <summary className="cursor-pointer font-medium text-slate-600 hover:text-slate-900">
              Emit traces from your AI project (advanced)
            </summary>
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-4">
              <p className="font-medium text-slate-700">Ingest endpoints</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li><code className="font-mono">POST /api/runs/start</code> — start a run</li>
                <li><code className="font-mono">POST /api/traces/events</code> — append trace events</li>
                <li><code className="font-mono">POST /api/runs/complete</code> — complete a run</li>
                <li><code className="font-mono">POST /api/runs/fail</code> — fail a run</li>
              </ul>
              <p className="mt-2">
                Auth: <code className="font-mono">x-agentpulse-key: $AGENTPULSE_INGEST_KEY</code>
              </p>
              <p className="mt-2">
                Or seed locally: <code className="font-mono">npm run seed:traces</code>
              </p>
            </div>
          </details>
        </Card>
      ) : (
        <>
          <div className="grid gap-3">
            {runs.map((run) => (
              <Link
                key={run.run_id}
                href={`/dashboard/runs/${run.run_id}`}
                className="group rounded-lg border border-slate-200 bg-white p-4 transition hover:border-teal-300 hover:shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-950">{run.project_name}</p>
                      <Badge tone="neutral">{run.workflow_id}</Badge>
                      {run.run_id.startsWith("demo-") ? (
                        <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">Demo</span>
                      ) : run.run_id.startsWith("fixture-") ? (
                        <span className="rounded border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-xs font-medium text-purple-700">Fixture</span>
                      ) : run.run_id.startsWith("seed-") ? (
                        <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700">Seeded</span>
                      ) : (
                        <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">Live</span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500">{run.summary}</p>
                    <p className="mt-1 font-mono text-xs text-slate-400">{run.run_id}</p>
                  </div>
                  <div className="flex flex-wrap shrink-0 gap-2">
                    <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-4 lg:grid-cols-6">
                  <div>
                    <dt className="font-medium text-slate-400">Started</dt>
                    <dd>{formatDateTime(run.started_at)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-400">Duration</dt>
                    <dd>{formatDuration(run.total_duration_ms)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-400">Cost</dt>
                    <dd>{formatCost(run.total_cost_usd)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-400">Model calls</dt>
                    <dd>{run.model_calls_count}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-400">Tool calls</dt>
                    <dd>{run.tool_calls_count}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-400">Evals</dt>
                    <dd className="tabular-nums">
                      <span className="text-emerald-700">{run.evals_passed}✓</span>
                      {run.evals_failed > 0 ? (
                        <span className="ml-1 text-red-600">{run.evals_failed}✗</span>
                      ) : null}
                    </dd>
                  </div>
                </dl>
              </Link>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="rounded-md border border-teal-200 bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-700 transition hover:border-teal-300 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={creatingDemo}
              onClick={() => void createDemoRun()}
              type="button"
            >
              {creatingDemo ? "Creating…" : "+ Create demo run"}
            </button>
            <button
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={importingFixture}
              onClick={() => void importFixture()}
              type="button"
            >
              {importingFixture ? "Importing…" : "+ Import fixture (demo data)"}
            </button>
            {demoError ? <span className="text-xs text-red-600">{demoError}</span> : null}
            {fixtureError ? <span className="text-xs text-red-600">{fixtureError}</span> : null}
          </div>
        </>
      )}
    </main>
  );
}
