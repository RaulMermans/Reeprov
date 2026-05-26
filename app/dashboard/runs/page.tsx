"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { clearInternalKey, mergeAuthHeaders } from "@/lib/auth/internalKey";
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
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/runs?limit=100", {
          headers: mergeAuthHeaders(),
        });
        if (res.status === 401) {
          clearInternalKey();
          setError("Access key required. This page requires dashboard access.");
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
    void load();
  }, []);

  return (
    <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Proof Runs</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Real trace ingestion runs from connected AI projects. Each run is recorded from
            external trace events, validated against proof contracts, and inspectable here.
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
            To ingest runs, start the dev server and emit traces using the AgentPulse client or
            the seed script: <code className="font-mono">npm run seed:traces</code>
          </p>
        </Card>
      ) : runs.length === 0 ? (
        <Card className="p-8">
          <p className="text-sm font-medium text-slate-700">No runs yet.</p>
          <p className="mt-2 text-xs text-slate-500">
            Emit your first run using the AgentPulse client, or run the seed script:
          </p>
          <pre className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            npm run seed:traces
          </pre>
          <p className="mt-3 text-xs text-slate-500">
            Or emit directly from a project using <code className="font-mono">POST /api/runs/start</code> and{" "}
            <code className="font-mono">POST /api/traces/events</code>.
          </p>
        </Card>
      ) : (
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
      )}

      <section className="rounded-md border border-slate-100 bg-slate-50 p-4 text-xs text-slate-500">
        <p className="font-medium text-slate-700">Emit traces from your AI project</p>
        <p className="mt-1">
          Use the AgentPulse client (<code className="font-mono">lib/proof-layer/client.ts</code>) or call the
          ingestion endpoints directly:
        </p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li><code className="font-mono">POST /api/runs/start</code> — start a run</li>
          <li><code className="font-mono">POST /api/traces/events</code> — append trace events</li>
          <li><code className="font-mono">POST /api/runs/complete</code> — complete a run</li>
          <li><code className="font-mono">POST /api/runs/fail</code> — fail a run</li>
        </ul>
        <p className="mt-2">
          Auth header: <code className="font-mono">x-agentpulse-key: $AGENTPULSE_INGEST_KEY</code>
        </p>
      </section>
    </main>
  );
}
