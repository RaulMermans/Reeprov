import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatDateTime, formatPercent } from "@/components/proof-layer/format";
import type { WorkflowGalleryItem } from "@/lib/proof-layer/examples";

export function WorkflowGallery({ items }: { items: WorkflowGalleryItem[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
      {items.map(({ workflow, latestRun, evalResults, averageEvalScore }) => (
        <Link key={workflow.workflow_id} href={`/dashboard/workflows/${workflow.workflow_id}`}>
          <Card className="h-full p-5 transition hover:border-teal-300 hover:shadow-md">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-950">{workflow.name}</h3>
                <p className="mt-1 text-sm text-slate-600">{latestRun?.project_name ?? "No project run yet"}</p>
              </div>
              <Badge tone={latestRun?.status === "completed" ? "success" : latestRun ? "warning" : "neutral"}>
                {latestRun?.status ?? "planned"}
              </Badge>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-xs">
              <div className="min-w-0 overflow-hidden">
                <dt className="font-medium uppercase text-slate-500">Architecture</dt>
                <dd className="mt-1 truncate text-slate-800">{workflow.architecture_type}</dd>
              </div>
              <div className="min-w-0 overflow-hidden">
                <dt className="font-medium uppercase text-slate-500">Nodes</dt>
                <dd className="mt-1 truncate text-slate-800">{workflow.nodes.length}</dd>
              </div>
              <div className="min-w-0 overflow-hidden">
                <dt className="font-medium uppercase text-slate-500">Edges</dt>
                <dd className="mt-1 truncate text-slate-800">{workflow.edges?.length ?? 0}</dd>
              </div>
              <div className="min-w-0 overflow-hidden">
                <dt className="font-medium uppercase text-slate-500">Evals</dt>
                <dd className="mt-1 truncate text-slate-800">{evalResults.length || workflow.evals?.length || 0}</dd>
              </div>
              <div className="min-w-0 overflow-hidden">
                <dt className="font-medium uppercase text-slate-500">Eval Score</dt>
                <dd className="mt-1 truncate text-slate-800">{averageEvalScore === null ? "No score" : formatPercent(averageEvalScore)}</dd>
              </div>
              <div className="min-w-0 overflow-hidden">
                <dt className="font-medium uppercase text-slate-500">Latest</dt>
                <dd className="mt-1 truncate text-slate-800">{formatDateTime(latestRun?.started_at)}</dd>
              </div>
            </dl>
          </Card>
        </Link>
      ))}
      <Card className="border-dashed p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-950">Blog Agent</h3>
            <p className="mt-1 text-sm text-slate-600">Planned integration</p>
          </div>
          <Badge tone="neutral">planned</Badge>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-3 text-xs">
          <div className="min-w-0 overflow-hidden">
            <dt className="font-medium uppercase text-slate-500">Architecture</dt>
            <dd className="mt-1 truncate text-slate-800">hybrid_workflow_agent</dd>
          </div>
          <div className="min-w-0 overflow-hidden">
            <dt className="font-medium uppercase text-slate-500">Nodes</dt>
            <dd className="mt-1 truncate text-slate-800">Planned</dd>
          </div>
          <div className="min-w-0 overflow-hidden">
            <dt className="font-medium uppercase text-slate-500">Edges</dt>
            <dd className="mt-1 truncate text-slate-800">Planned</dd>
          </div>
          <div className="min-w-0 overflow-hidden">
            <dt className="font-medium uppercase text-slate-500">Evals</dt>
            <dd className="mt-1 truncate text-slate-800">Planned</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
