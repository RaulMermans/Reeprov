import { Bot, FileCheck2, GitBranch, Wrench } from "lucide-react";
import { Card } from "@/components/ui/Card";
import type { ScanReport } from "@/lib/scanner/types";
import { formatScore, scoreEntries } from "@/lib/utils/format";

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
    ["Evals", report.detectedEvals.length, GitBranch],
  ] as const;

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
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Scores</h2>
        <div className="mt-4 space-y-3">
          {scoreEntries(report.scores).map(([label, value]) => (
            <div className="flex items-center justify-between gap-4" key={label}>
              <span className="text-sm text-slate-700">{label}</span>
              <span className="font-medium text-slate-950">{formatScore(value)}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Auditor Mode</h2>
        <div className="mt-4 text-lg font-semibold text-slate-950">{auditorMode}</div>
        {auditorStatus?.provider ? (
          <p className="mt-2 text-sm text-slate-600">
            Provider: {auditorStatus.provider}
            {auditorStatus.model ? ` / ${auditorStatus.model}` : ""}
          </p>
        ) : null}
        {auditorStatus?.error ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {auditorStatus.error}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
