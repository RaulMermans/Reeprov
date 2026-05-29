"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { mergeAuthHeaders } from "@/lib/auth/internalKey";
import { useDashboardAuth } from "@/lib/auth/dashboardAuthContext";
import type { RunSummary } from "@/lib/runs/runTypes";

export function OverviewLiveRuns() {
  const { onUnauthorized } = useDashboardAuth();
  const router = useRouter();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    void loadRuns();
    return () => { mountedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRuns() {
    try {
      const res = await fetch("/api/runs?limit=5", {
        headers: mergeAuthHeaders(),
      });
      if (!mountedRef.current) return;
      if (res.status === 401) {
        onUnauthorized("Access key expired or invalid. Please unlock again.");
        return;
      }
      if (res.ok) {
        const data = await res.json() as { runs: RunSummary[] };
        setRuns(data.runs ?? []);
      }
    } catch {
      // Silently degrade — overview doesn't need to block on run failures
    } finally {
      if (mountedRef.current) setLoading(false);
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
      setDemoError("Could not create demo run.");
    } finally {
      setCreatingDemo(false);
    }
  }

  if (loading) {
    return (
      <Card className="p-6">
        <div className="h-4 w-48 animate-pulse rounded bg-slate-200" />
      </Card>
    );
  }

  if (runs.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-sm font-medium text-slate-700">No live proof runs yet.</p>
        <p className="mt-2 text-sm text-slate-500">
          Runtime runs appear here only after a connected project emits AgentPulse trace events.
          Use the demo run to explore the runtime proof layer now.
        </p>
        {demoError ? (
          <p className="mt-2 text-xs text-red-600">{demoError}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={creatingDemo}
            onClick={() => void createDemoRun()}
            type="button"
          >
            {creatingDemo ? "Creating…" : "Create demo run"}
          </button>
          <Link
            href="/dashboard/scanner"
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Open Repository Scanner
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-2">
      {runs.map((run) => (
        <Link
          key={run.run_id}
          href={`/dashboard/runs/${run.run_id}`}
          className="group flex items-center justify-between gap-3 rounded-md border border-slate-100 bg-slate-50 p-3 transition hover:border-teal-200 hover:bg-white"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-950">{run.project_name}</p>
            <p className="mt-0.5 truncate text-xs text-slate-500">{run.summary}</p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Badge
              tone={
                run.status === "completed"
                  ? "success"
                  : run.status === "failed"
                    ? "danger"
                    : "warning"
              }
            >
              {run.status}
            </Badge>
            <Badge tone="neutral">{run.evals_passed}/{run.evals_passed + run.evals_failed} evals</Badge>
          </div>
        </Link>
      ))}
    </div>
  );
}
