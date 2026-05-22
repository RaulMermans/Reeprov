import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { NodeDetailPanel } from "@/components/proof-layer/NodeDetailPanel";
import { formatDateTime, formatPercent } from "@/components/proof-layer/format";
import type { EvalResult, RunRecord, TraceEvent, WorkflowSpec } from "@/lib/proof-layer/schemas";

export function WorkflowInspector({
  workflow,
  latestRun,
  traceEvents,
  evalResults,
}: {
  workflow: WorkflowSpec;
  latestRun?: RunRecord;
  traceEvents: TraceEvent[];
  evalResults: EvalResult[];
}) {
  const scoredEvals = evalResults.filter((result) => typeof result.score === "number");
  const averageEvalScore = scoredEvals.length
    ? scoredEvals.reduce((sum, result) => sum + (result.score ?? 0), 0) / scoredEvals.length
    : null;

  return (
    <div className="grid gap-6">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-teal-700">Workflow proof layer</p>
            <h1 className="mt-1 text-3xl font-semibold text-slate-950">{workflow.name}</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">{workflow.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="info">{workflow.architecture_type}</Badge>
            {workflow.version ? <Badge tone="neutral">v{workflow.version}</Badge> : null}
            {latestRun ? <Badge tone={latestRun.status === "completed" ? "success" : "warning"}>{latestRun.status}</Badge> : null}
          </div>
        </div>
        <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs font-medium uppercase text-slate-500">Project</dt>
            <dd className="mt-1 text-slate-800">{latestRun?.project_name ?? "No run yet"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-slate-500">Latest Run</dt>
            <dd className="mt-1 text-slate-800">{formatDateTime(latestRun?.started_at)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-slate-500">Average Eval Score</dt>
            <dd className="mt-1 text-slate-800">{averageEvalScore === null ? "No scores" : formatPercent(averageEvalScore)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-slate-500">Nodes / Edges</dt>
            <dd className="mt-1 text-slate-800">{workflow.nodes.length} / {workflow.edges?.length ?? 0}</dd>
          </div>
        </dl>
      </Card>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-lg font-semibold text-slate-950">Edges and Dependencies</h2>
          <div className="mt-4 grid gap-2">
            {(workflow.edges ?? []).map((edge) => (
              <div key={`${edge.from}-${edge.to}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <span className="font-medium">{edge.from}</span> -&gt; <span className="font-medium">{edge.to}</span>
                {edge.condition ? <span className="ml-2 text-slate-500">({edge.condition})</span> : null}
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="text-lg font-semibold text-slate-950">Declared Controls</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase text-slate-500">Allowed Tools</dt>
              <dd className="mt-1 text-slate-800">{workflow.allowed_tools?.join(", ") || "Declared per node"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-slate-500">Evals</dt>
              <dd className="mt-1 text-slate-800">{workflow.evals?.join(", ") || "None declared"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-slate-500">Approval Gates</dt>
              <dd className="mt-1 text-slate-800">{workflow.approval_gates?.join(", ") || "Not required"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-slate-500">Artifacts</dt>
              <dd className="mt-1 text-slate-800">{workflow.artifacts?.join(", ") || "None declared"}</dd>
            </div>
          </dl>
        </Card>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold text-slate-950">Structured Workflow Graph</h2>
        <div className="grid gap-4">
          {workflow.nodes.map((node, index) => {
            const nodeEvents = traceEvents.filter((event) => event.node_id === node.id);
            const nodeEvals = evalResults.filter((result) => result.node_id === node.id);
            return (
              <div key={node.id} className="grid gap-3">
                <div className="flex items-center gap-3 text-sm text-slate-500">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 text-xs font-semibold text-white">{index + 1}</span>
                  <span>{node.id}</span>
                </div>
                <NodeDetailPanel node={node} traceEvents={nodeEvents} evalResults={nodeEvals} />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
