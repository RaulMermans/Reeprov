import { Bot, FileCheck2, GitBranch, Terminal, Wrench } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { buildScoreExplanations } from "@/lib/reports/scoreExplanations";
import type { ScanReport } from "@/lib/scanner/types";
import { formatScore, projectTypeDescription, projectTypeLabel, scoreEntries } from "@/lib/utils/format";

export function ScanSummary({ report }: { report: ScanReport }) {
  const auditorStatus = report.auditorStatus;
  const auditorMode =
    auditorStatus?.llmAuditorsEnabled && auditorStatus.promptAuditorRan
      ? "Static + LLM Prompt Auditor"
      : "Static only";
  const stats = [
    ["Agents", report.detectedAgents.length, Bot],
    ["Prompts", report.detectedPrompts.length, FileCheck2],
    ["Tools", report.detectedTools.length, Wrench],
    ["AI Evals", report.detectedEvals.length, GitBranch],
    ["Tests", report.detectedTests.length, Terminal],
  ] as const;
  const source = report.scanSource;
  const zipStats = report.zipStats;
  const scoreExplanations = buildScoreExplanations(report);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Detected</h2>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {stats.map(([label, value, Icon]) => (
            <div className="rounded-md border border-slate-200 p-3" key={label}>
              <Icon className="h-4 w-4 text-teal-700" />
              <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
              <div className="text-sm text-slate-600">{label}</div>
            </div>
          ))}
          {report.detectedCIWorkflows.length > 0 ? (
            <div className="rounded-md border border-slate-200 p-3">
              <GitBranch className="h-4 w-4 text-slate-400" />
              <div className="mt-2 text-2xl font-semibold text-slate-950">
                {report.detectedCIWorkflows.length}
              </div>
              <div className="text-sm text-slate-600">CI workflows</div>
            </div>
          ) : null}
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Scores</h2>
        <div className="mt-4 space-y-3">
          {scoreEntries(report.scores).map(([label, value]) => {
            const explanation = scoreExplanations.find((e) => e.label === label);
            return (
              <details className="group" key={label}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                  <span className="text-sm text-slate-700">{label}</span>
                  <span className="font-medium text-slate-950">{formatScore(value)}</span>
                </summary>
                {explanation ? (
                  <div className="mt-2 space-y-1.5 text-xs leading-5 text-slate-600">
                    <p>{explanation.summary}</p>
                    {explanation.positives.length > 0 && (
                      <div>
                        <span className="font-medium text-emerald-700">Positive: </span>
                        {explanation.positives.join(" ")}
                      </div>
                    )}
                    {explanation.penalties.length > 0 && (
                      <div>
                        <span className="font-medium text-amber-700">Penalties: </span>
                        {explanation.penalties.join("; ")}.
                      </div>
                    )}
                    {explanation.relatedFindingIds.length > 0 && (
                      <div className="text-slate-400">
                        {explanation.relatedFindingIds.length} related finding(s).
                      </div>
                    )}
                  </div>
                ) : null}
              </details>
            );
          })}
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Project</h2>
        <div className="mt-4 space-y-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Source</div>
            <div className="mt-1 text-sm font-medium text-slate-950">
              {source ? sourceLabel(source.type) : "Unknown"}
            </div>
            <div className="mt-1 break-all text-sm text-slate-600">
              {source?.label ?? report.repoName}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Project type</div>
            <div className="text-base font-semibold text-slate-950">
              {projectTypeLabel(report.projectType)}
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {projectTypeDescription(report.projectType)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scanned</div>
              <div className="mt-1 font-medium text-slate-950">{report.filesScanned}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ignored</div>
              <div className="mt-1 font-medium text-slate-950">{report.ignoredFiles}</div>
            </div>
          </div>
          {source?.type === "zip" && zipStats ? (
            <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-sm">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">ZIP entries</div>
                <div className="mt-1 font-medium text-slate-950">{zipStats.totalEntries}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Candidates</div>
                <div className="mt-1 font-medium text-slate-950">{zipStats.candidateFiles}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">ZIP scanned</div>
                <div className="mt-1 font-medium text-slate-950">{zipStats.scannedFiles}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Skipped</div>
                <div className={`mt-1 font-medium ${zipStats.skippedByFileLimit > 0 ? "text-amber-700" : "text-slate-950"}`}>
                  {zipStats.skippedByFileLimit}
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="mt-4 border-t border-slate-100 pt-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Auditor Mode</h3>
          <div className="mt-2 text-sm font-medium text-slate-950">{auditorMode}</div>
          {auditorStatus?.provider ? (
            <p className="mt-1 text-sm text-slate-600">
              Provider: {auditorStatus.provider}
              {auditorStatus.model ? ` / ${auditorStatus.model}` : ""}
            </p>
          ) : null}
          {auditorStatus?.error ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {auditorStatus.error}
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function sourceLabel(type: NonNullable<ScanReport["scanSource"]>["type"]) {
  switch (type) {
    case "github": return "GitHub";
    case "zip": return "ZIP upload";
    case "mock": return "Mock";
  }
}
