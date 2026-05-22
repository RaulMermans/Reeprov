import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkflowInspector } from "@/components/proof-layer/WorkflowInspector";
import {
  getExampleEvalResults,
  getExampleRuns,
  getExampleTraceEvents,
  getWorkflowById,
} from "@/lib/proof-layer/examples";

export default async function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ workflowId: string }>;
}) {
  const { workflowId } = await params;
  const workflow = getWorkflowById(workflowId);
  if (!workflow) {
    notFound();
  }

  const latestRun = getExampleRuns().find((run) => run.workflow_id === workflow.workflow_id);
  const traceEvents = latestRun ? getExampleTraceEvents(latestRun.run_id) : [];
  const evalResults = latestRun ? getExampleEvalResults(latestRun.run_id) : [];

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap gap-3 text-sm font-medium text-teal-700">
        <Link href="/dashboard">Dashboard</Link>
        <span className="text-slate-400">/</span>
        <Link href="/dashboard/workflows">Workflows</Link>
        {latestRun ? (
          <>
            <span className="text-slate-400">/</span>
            <Link href={`/dashboard/runs/${latestRun.run_id}`}>Latest run</Link>
          </>
        ) : null}
      </div>
      <WorkflowInspector workflow={workflow} latestRun={latestRun} traceEvents={traceEvents} evalResults={evalResults} />
    </main>
  );
}
