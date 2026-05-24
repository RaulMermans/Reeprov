import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { WorkflowGallery } from "@/components/proof-layer/WorkflowGallery";
import { formatCurrency, formatDuration, formatPercent } from "@/components/proof-layer/format";
import {
  getExampleEvalResults,
  getExampleRuns,
  getProofLayerMetrics,
  getWorkflowGalleryItems,
} from "@/lib/proof-layer/examples";
import { fileRunStore } from "@/lib/runs/runStore";

export default async function DashboardPage() {
  const metrics = getProofLayerMetrics();
  const exampleRuns = getExampleRuns();
  const galleryItems = getWorkflowGalleryItems();
  const recentFailures = exampleRuns.filter((run) => run.status === "failed" || run.status === "degraded");
  const successRate = metrics.totalRuns ? metrics.successfulRuns / metrics.totalRuns : 0;
  const latestExampleRunId = exampleRuns[0]?.run_id ?? "";

  // Load real runs from the store (non-fatal).
  let liveRuns: import("@/lib/runs/runTypes").RunSummary[] = [];
  try {
    liveRuns = await fileRunStore.listRuns({ limit: 5 });
  } catch {
    // Store not yet initialized or not available — silently degrade.
  }

  const hasLiveRuns = liveRuns.length > 0;

  return (
    <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">AgentPulse</h1>
            <span className="rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-xs font-medium text-teal-700">
              Agentic workflow observability
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Black-box recorder and proof layer for agentic AI workflows. Record traces, validate
            contracts, inspect runs, and measure what your AI systems actually do.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            href="/dashboard/runs"
          >
            All Runs
          </Link>
          <Link
            className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-teal-800"
            href="/dashboard/runs"
          >
            Proof Runs →
          </Link>
        </div>
      </section>

      {/* ── Live Runs ───────────────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Live Runs</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Real trace ingestion runs from connected AI projects.
            </p>
          </div>
          <Link className="text-xs font-medium text-teal-700 hover:text-teal-900" href="/dashboard/runs">
            View all →
          </Link>
        </div>
        {hasLiveRuns ? (
          <div className="grid gap-2">
            {liveRuns.map((run) => (
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
        ) : (
          <Card className="p-5">
            <p className="text-sm font-medium text-slate-700">No live runs yet.</p>
            <p className="mt-1 text-xs text-slate-500">
              Emit traces from your AI project or run the seed script:
            </p>
            <pre className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
              npm run seed:traces
            </pre>
          </Card>
        )}
      </section>

      {/* ── Quick Navigation ────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Navigate</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickNavCard
            href="/dashboard/runs"
            title="Proof Runs"
            description="Inspect real trace ingestion runs"
            badge="Primary"
          />
          <QuickNavCard
            href="/dashboard/workflows"
            title="Workflow Gallery"
            description="Workflow specs with example proof data"
            badge="Example"
          />
          <QuickNavCard
            href="/dashboard/scanner"
            title="Repository Scanner"
            description="Static AI system audit for GitHub repos"
            badge="Scanner"
          />
          <QuickNavCard
            href="/dashboard/reports"
            title="Scan History"
            description="Saved scanner reports and diffs"
            badge="Scanner"
          />
        </div>
      </section>

      {/* ── Example Data Overview ───────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Example data</h2>
          <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
            Static examples
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Example Runs" value={String(metrics.totalRuns)} sub={`${metrics.successfulRuns} successful`} />
          <MetricCard
            label="Success Rate"
            value={formatPercent(successRate)}
            sub={metrics.failedOrDegradedRuns ? `${metrics.failedOrDegradedRuns} failed / degraded` : "All passing"}
            tone={metrics.failedOrDegradedRuns ? "warning" : "success"}
          />
          <MetricCard label="Avg Eval Score" value={formatPercent(metrics.averageEvalScore)} sub="Average eval score" />
          <MetricCard label="Total Cost" value={formatCurrency(metrics.totalModelCost)} sub="Model spend" />
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Workflow Gallery</h2>
            <p className="mt-0.5 text-xs text-slate-500">Workflow proof examples with latest run state.</p>
          </div>
          <Link className="text-xs font-medium text-teal-700 hover:text-teal-900" href="/dashboard/workflows">
            View all
          </Link>
        </div>
        <WorkflowGallery items={galleryItems} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 text-base font-semibold text-slate-950">Example Runs</h2>
          <div className="grid gap-2">
            {exampleRuns.map((run) => {
              const evals = getExampleEvalResults(run.run_id);
              const evalPassed = evals.filter((r) => r.passed).length;
              return (
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
                    <Badge tone={run.status === "completed" ? "success" : "warning"}>{run.status}</Badge>
                    <Badge tone="neutral">{evalPassed}/{evals.length} evals</Badge>
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 text-base font-semibold text-slate-950">Recent Failures (examples)</h2>
          <div className="grid gap-2">
            {recentFailures.length ? (
              recentFailures.map((run) => (
                <Link
                  key={run.run_id}
                  href={`/dashboard/runs/${run.run_id}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-amber-100 bg-amber-50 p-3 transition hover:border-amber-200 hover:bg-amber-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-950">{run.project_name}</p>
                    <p className="mt-0.5 truncate text-xs text-amber-800">{run.summary}</p>
                  </div>
                  <Badge tone="warning">{run.status}</Badge>
                </Link>
              ))
            ) : (
              <div className="rounded-md border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-700">
                No failed or degraded runs.
              </div>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}

function QuickNavCard({
  href,
  title,
  description,
  badge,
}: {
  href: string;
  title: string;
  description: string;
  badge: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-lg border border-slate-200 bg-white p-4 transition hover:border-teal-300 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-950 group-hover:text-teal-700">{title}</p>
        <span className="rounded border border-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-500">{badge}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
    </Link>
  );
}

function MetricCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "success" | "warning";
}) {
  const valueColor = tone === "warning" ? "text-amber-700" : tone === "success" ? "text-emerald-700" : "text-slate-950";
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${valueColor}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{sub}</p>
    </Card>
  );
}
