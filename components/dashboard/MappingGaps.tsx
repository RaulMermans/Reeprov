import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { SystemGraph } from "@/lib/scanner/types";

const SEVERITY_TONE = {
  info: "info",
  low: "neutral",
  medium: "warning",
  high: "danger",
} as const;

export function MappingGaps({ graph }: { graph: SystemGraph }) {
  if (!graph || graph.warnings.length === 0) {
    return (
      <Card className="p-5 text-sm text-emerald-700">
        No mapping gaps detected. All detected agents, prompts, tools, evals, and models are linked.
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Mapping gaps</h3>
      <p className="mt-1 text-xs text-slate-500">
        Where the AI system graph could not link a detected artifact to an agent or workflow.
      </p>
      <ul className="mt-3 space-y-3">
        {graph.warnings.map((w) => (
          <li className="rounded border border-slate-200 bg-slate-50 p-3" key={w.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-900">{w.message}</div>
                <div className="mt-1 text-xs text-slate-600">{w.recommendation}</div>
              </div>
              <Badge tone={SEVERITY_TONE[w.severity]} className="shrink-0">
                {w.severity}
              </Badge>
            </div>
            <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-400">
              {w.type.replace(/_/g, " ")}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
