import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatPercent } from "@/components/proof-layer/format";
import type { EvalResult } from "@/lib/proof-layer/schemas";

function severityTone(severity: EvalResult["severity"], passed: boolean) {
  if (!passed && (severity === "critical" || severity === "fail")) {
    return "danger" as const;
  }
  if (!passed || severity === "warning") {
    return "warning" as const;
  }
  return "success" as const;
}

export function EvalResultsPanel({
  evalResults,
  embedded = false,
}: {
  evalResults: EvalResult[];
  embedded?: boolean;
}) {
  if (!evalResults.length) {
    return embedded
      ? <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">No eval results recorded.</div>
      : <Card className="p-5 text-sm text-slate-600">No eval results recorded.</Card>;
  }

  return (
    <div className="grid gap-3">
      {evalResults.map((result) => (
        <div key={result.eval_id} className={`${embedded ? "rounded-md border border-slate-200 bg-slate-50" : "rounded-lg border border-slate-200 bg-white shadow-sm"} p-4`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">{result.name}</h3>
              <p className="mt-1 text-xs text-slate-500">{result.type}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={severityTone(result.severity, result.passed)}>
                {result.passed ? "passed" : "failed"}
              </Badge>
              <Badge tone={severityTone(result.severity, result.passed)}>{result.severity}</Badge>
              {typeof result.score === "number" ? (
                <Badge tone="info">{formatPercent(result.score)}</Badge>
              ) : null}
            </div>
          </div>
          {result.node_id ? (
            <p className="mt-3 text-xs text-slate-600">Node: <span className="font-medium">{result.node_id}</span></p>
          ) : null}
          {result.findings.length ? (
            <ul className="mt-3 grid gap-1 text-sm text-slate-700">
              {result.findings.map((finding) => (
                <li key={finding}>- {finding}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-slate-600">No findings.</p>
          )}
          {result.recommendation ? (
            <p className="mt-3 text-sm text-slate-700">{result.recommendation}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
