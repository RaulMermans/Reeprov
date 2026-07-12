import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { DashboardPulse } from "@/components/dashboard/DashboardPulse";
import { OverviewLiveRuns } from "@/components/dashboard/OverviewLiveRuns";

export default function DashboardPage() {
  return (
    <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <section>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">AgentPulse</h1>
          <span className="rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-xs font-medium text-teal-700">All-integrations pulse</span>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">
          See which connected agentic projects are healthy, stale, degraded, or waiting; then drill into their workflow blueprints and individual run evidence.
        </p>
      </section>

      <DashboardPulse />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Dashboard navigation">
        <QuickLink href="/dashboard/integrations" title="Integrations" description="Configure connections and inspect workflow blueprints." />
        <QuickLink href="/dashboard/runs" title="Live Proof Runs" description="Open Live Runs in the visual execution canvas." />
        <QuickLink href="/dashboard/scanner" title="Static Repository Intelligence" description="Inspect read-only static repository evidence." />
        <QuickLink href="/dashboard/workflows" title="Workflow Registry" description="Review registered WorkflowSpecs and inferred workflow context." />
        <QuickLink href="/dashboard/reports" title="Saved Proof Reports" description="Review saved scans and reconstruction outputs." />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Live proof runs</h2>
            <p className="mt-0.5 text-xs text-slate-500">A compact raw-run list remains available below the command center.</p>
          </div>
          <Link className="text-xs font-medium text-teal-700 hover:text-teal-900" href="/dashboard/runs">View all →</Link>
        </div>
        <OverviewLiveRuns />
      </section>
    </main>
  );
}

function QuickLink({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link href={href} className="group">
      <Card className="h-full p-4 transition group-hover:border-teal-300 group-hover:shadow-sm">
        <p className="text-sm font-semibold text-slate-950 group-hover:text-teal-700">{title}</p>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </Card>
    </Link>
  );
}
