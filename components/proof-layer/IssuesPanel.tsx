import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { IssueSeverity, RunIssue } from "@/lib/runs/runIntelligence";

const SEVERITY_TONE: Record<IssueSeverity, "success" | "warning" | "danger" | "info" | "neutral"> = {
  info: "info",
  warning: "warning",
  fail: "danger",
  critical: "danger",
};

/**
 * Dedicated "what went wrong" surface — pulls errors and failing evals out of
 * the raw timeline so they're visible without scrolling through 100+ events.
 */
export function IssuesPanel({ issues }: { issues: RunIssue[] }) {
  if (!issues.length) {
    return (
      <Card className="border-emerald-200 bg-emerald-50 p-4" data-testid="issues-panel-empty">
        <p className="text-sm font-medium text-emerald-800">No errors or warnings detected in this run.</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-3" data-testid="issues-panel">
      {issues.map((issue) => (
        <Card key={issue.id} className="p-4" data-testid={`issue-${issue.id}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase text-slate-400">{issue.stageLabel}</p>
              <p className="mt-1 text-sm font-semibold text-slate-950">{issue.message}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={SEVERITY_TONE[issue.severity]}>{issue.severity}</Badge>
              <Badge tone={issue.recovered ? "success" : "neutral"}>
                {issue.recovered ? "Recovered" : "Not recovered"}
              </Badge>
              <Badge tone="neutral">{issue.source === "eval_result" ? "eval" : "trace event"}</Badge>
            </div>
          </div>
          {issue.recommendedFix ? (
            <p className="mt-3 text-sm text-teal-700">
              <span className="font-medium">Recommended fix: </span>
              {issue.recommendedFix}
            </p>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
