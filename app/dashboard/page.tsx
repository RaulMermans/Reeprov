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

export default function DashboardPage() {
  const metrics = getProofLayerMetrics();
  const runs = getExampleRuns();
  const galleryItems = getWorkflowGalleryItems();
  const recentFailures = runs.filter((run) => run.status === "failed" || run.status === "degraded");
  const successRate = metrics.totalRuns ? metrics.successfulRuns / metrics.totalRuns : 0;

  return (
    <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-teal-700">Agentic system black-box recorder</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-950">Agentic workflow observability</h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-600">
            Read-only proof data from example workflows. This dashboard shows traceable AI runs, eval-backed reliability,
            tool-call inspection, and model/provider visibility without executing workflows.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50" href="/dashboard/workflows">
            Workflow Gallery
          </Link>
          <Link className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800" href={`/dashboard/runs/${runs[0]?.run_id ?? ""}`}>
            Latest Run
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Runs" value={String(metrics.totalRuns)} detail={`${metrics.successfulRuns} successful`} />
        <MetricCard label="Success Rate" value={formatPercent(successRate)} detail={`${metrics.failedOrDegradedRuns} failed or degraded`} tone={metrics.failedOrDegradedRuns ? "warning" : "success"} />
        <MetricCard label="Eval Health" value={formatPercent(metrics.averageEvalScore)} detail="Average eval score" />
        <MetricCard label="Cost" value={formatCurrency(metrics.totalModelCost)} detail="Total model cost" />
        <MetricCard label="Latency" value={formatDuration(metrics.averageLatencyMs)} detail="Average run latency" />
        <MetricCard label="Model Calls" value={String(metrics.totalModelCalls)} detail="Total model calls" />
        <MetricCard label="Tool Calls" value={String(metrics.totalToolCalls)} detail="Total tool calls" />
        <MetricCard label="Failures" value={String(metrics.failedOrDegradedRuns)} detail="Failed/degraded runs" tone={metrics.failedOrDegradedRuns ? "warning" : "success"} />
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Workflow Gallery</h2>
            <p className="mt-1 text-sm text-slate-600">Workflow proof layer examples with latest run state.</p>
          </div>
          <Link className="text-sm font-medium text-teal-700 hover:text-teal-900" href="/dashboard/workflows">View all</Link>
        </div>
        <WorkflowGallery items={galleryItems} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-xl font-semibold text-slate-950">Recent Workflows</h2>
          <div className="mt-4 grid gap-3">
            {runs.map((run) => {
              const evals = getExampleEvalResults(run.run_id);
              return (
                <Link key={run.run_id} href={`/dashboard/runs/${run.run_id}`} className="rounded-md border border-slate-200 bg-slate-50 p-3 hover:border-teal-300">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{run.project_name}</p>
                      <p className="mt-1 text-xs text-slate-500">{run.summary}</p>
                    </div>
                    <div className="flex gap-2">
                      <Badge tone={run.status === "completed" ? "success" : "warning"}>{run.status}</Badge>
                      <Badge tone="info">{evals.filter((result) => result.passed).length}/{evals.length} evals</Badge>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-xl font-semibold text-slate-950">Recent Failures</h2>
          <div className="mt-4 grid gap-3">
            {recentFailures.length ? recentFailures.map((run) => (
              <Link key={run.run_id} href={`/dashboard/runs/${run.run_id}`} className="rounded-md border border-amber-200 bg-amber-50 p-3 hover:border-amber-300">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">{run.project_name}</p>
                    <p className="mt-1 text-xs text-amber-900">{run.summary}</p>
                  </div>
                  <Badge tone="warning">{run.status}</Badge>
                </div>
              </Link>
            )) : (
              <p className="text-sm text-slate-600">No failed or degraded example runs.</p>
            )}
          </div>
        </Card>
      </section>
    </main>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone = "info",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "info" | "success" | "warning";
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{value}</p>
          <p className="mt-2 text-sm text-slate-600">{detail}</p>
        </div>
        <Badge tone={tone}>{label}</Badge>
      </div>
    </Card>
  );
}
