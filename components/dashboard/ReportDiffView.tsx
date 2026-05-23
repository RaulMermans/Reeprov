"use client";

import { Card } from "@/components/ui/Card";
import type { ReportDiff } from "@/lib/reports/reportDiff";
import type { RegressionCandidate } from "@/lib/reports/regressionCandidates";
import type { Finding } from "@/lib/scanner/types";

// ── Score delta badge ─────────────────────────────────────────────────────────

function ScoreDelta({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-slate-400">—</span>;
  const positive = delta > 0;
  return (
    <span
      className={`font-semibold ${positive ? "text-emerald-600" : "text-red-600"}`}
    >
      {positive ? "+" : ""}
      {delta.toFixed(0)}
    </span>
  );
}

// ── Finding status badge ──────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    added: { label: "Added", className: "bg-red-100 text-red-700" },
    resolved: { label: "Resolved", className: "bg-emerald-100 text-emerald-700" },
    unchanged: { label: "Unchanged", className: "bg-slate-100 text-slate-500" },
    worsened: { label: "Worsened", className: "bg-orange-100 text-orange-700" },
    improved: { label: "Improved", className: "bg-blue-100 text-blue-600" },
  };
  const { label, className } = map[status] ?? { label: status, className: "bg-slate-100 text-slate-500" };
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function severityBadge(severity: Finding["severity"]) {
  const map: Record<Finding["severity"], string> = {
    critical: "bg-red-100 text-red-700",
    high: "bg-orange-100 text-orange-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-slate-100 text-slate-600",
    info: "bg-blue-50 text-blue-600",
  };
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${map[severity]}`}>
      {severity}
    </span>
  );
}

// ── Regression candidate card ─────────────────────────────────────────────────

function RegressionCandidateCard({ candidate }: { candidate: RegressionCandidate }) {
  const severityColors: Record<RegressionCandidate["severity"], string> = {
    high: "border-l-red-400",
    medium: "border-l-amber-400",
    low: "border-l-slate-300",
    info: "border-l-blue-300",
  };
  return (
    <div className={`border-l-2 pl-3 ${severityColors[candidate.severity]}`}>
      <div className="flex flex-wrap items-start gap-2">
        <span className="text-xs font-semibold text-slate-700">{candidate.title}</span>
        <span className={`shrink-0 rounded px-1 py-0.5 text-xs font-medium ${
          candidate.severity === "high" ? "bg-red-100 text-red-700" :
          candidate.severity === "medium" ? "bg-amber-100 text-amber-700" :
          "bg-slate-100 text-slate-500"
        }`}>{candidate.severity}</span>
      </div>
      <p className="mt-0.5 text-xs text-slate-500">{candidate.reason}</p>
      <p className="mt-1 rounded bg-slate-50 p-1.5 font-mono text-xs text-slate-600">
        💡 {candidate.suggestedTest}
      </p>
    </div>
  );
}

// ── Main diff component ───────────────────────────────────────────────────────

interface ReportDiffViewProps {
  diff: ReportDiff;
}

export function ReportDiffView({ diff }: ReportDiffViewProps) {
  const { scoreDeltas, findings, regressionCandidates, statusChange, detectedCountDeltas } = diff;

  const scoreDimensions: Array<{ label: string; key: keyof typeof scoreDeltas }> = [
    { label: "Overall", key: "overall" },
    { label: "Architecture", key: "architecture" },
    { label: "Security", key: "security" },
    { label: "Prompt quality", key: "promptQuality" },
    { label: "Tool governance", key: "toolGovernance" },
    { label: "Eval coverage", key: "evalCoverage" },
    { label: "Documentation", key: "documentation" },
    { label: "Maintainability", key: "maintainability" },
  ];

  const countDimensions: Array<{ label: string; key: keyof typeof detectedCountDeltas }> = [
    { label: "Agents", key: "agents" },
    { label: "Workflows", key: "workflows" },
    { label: "Prompts", key: "prompts" },
    { label: "Tools", key: "tools" },
    { label: "Evals", key: "evals" },
    { label: "Tests", key: "tests" },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Overall Δ</div>
          <div className="mt-1 text-2xl font-bold">
            <ScoreDelta delta={scoreDeltas.overall} />
          </div>
          {statusChange ? (
            <div className="mt-1 text-xs text-slate-500">Status: {statusChange}</div>
          ) : null}
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">New findings</div>
          <div className="mt-1 text-2xl font-bold text-slate-950">{findings.added.length}</div>
          <div className="mt-1 text-xs text-slate-500">{findings.resolved.length} resolved</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">New high risks</div>
          <div className={`mt-1 text-2xl font-bold ${diff.newHighRisks.length > 0 ? "text-red-600" : "text-slate-950"}`}>
            {diff.newHighRisks.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">{diff.resolvedHighRisks.length} high risks resolved</div>
        </Card>
      </div>

      {/* Score deltas */}
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-950">Score deltas</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {scoreDimensions.map(({ label, key }) => (
            <div key={key} className="flex items-center justify-between rounded bg-slate-50 px-3 py-2">
              <span className="text-xs text-slate-600">{label}</span>
              <ScoreDelta delta={scoreDeltas[key]} />
            </div>
          ))}
        </div>
      </Card>

      {/* Detected count deltas */}
      {countDimensions.some(({ key }) => detectedCountDeltas[key] !== 0) ? (
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-950">Detected count changes</h3>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {countDimensions
              .filter(({ key }) => detectedCountDeltas[key] !== 0)
              .map(({ label, key }) => (
                <div key={key} className="flex items-center justify-between rounded bg-slate-50 px-3 py-2">
                  <span className="text-xs text-slate-600">{label}</span>
                  <ScoreDelta delta={detectedCountDeltas[key]} />
                </div>
              ))}
          </div>
        </Card>
      ) : null}

      {/* Findings diff */}
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-950">
          Findings diff
          <span className="ml-2 font-normal text-slate-400">
            {findings.added.length} added · {findings.resolved.length} resolved · {findings.unchanged.length} unchanged
          </span>
        </h3>
        {findings.all.length === 0 ? (
          <p className="text-sm text-slate-500">No finding changes.</p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-100">
            {findings.all
              .filter((c) => c.status !== "unchanged")
              .map((change, i) => (
                <div key={`${change.status}-${i}`} className="flex items-start gap-3 py-2.5">
                  {statusBadge(change.status)}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {severityBadge(change.finding.severity)}
                      <span className="text-sm font-medium text-slate-800">{change.finding.title}</span>
                      <span className="text-xs text-slate-400">{change.finding.category}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">{change.finding.summary}</p>
                    {change.baseFinding && change.baseFinding.severity !== change.finding.severity ? (
                      <p className="mt-0.5 text-xs text-slate-400">
                        Severity: {change.baseFinding.severity} → {change.finding.severity}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            {findings.unchanged.length > 0 ? (
              <div className="pt-2 text-xs text-slate-400">
                {findings.unchanged.length} unchanged finding{findings.unchanged.length !== 1 ? "s" : ""} not shown
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {/* Regression candidates */}
      {regressionCandidates.length > 0 ? (
        <Card className="p-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-950">Regression candidates</h3>
          <p className="mb-3 text-xs text-slate-500">
            Suggested tests based on important changes between these reports.
          </p>
          <div className="flex flex-col gap-3">
            {regressionCandidates.map((candidate) => (
              <RegressionCandidateCard candidate={candidate} key={candidate.id} />
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
