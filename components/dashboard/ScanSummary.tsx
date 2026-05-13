import { Bot, FileCheck2, GitBranch, Wrench } from "lucide-react";
import { Card } from "@/components/ui/Card";
import type { ScanReport } from "@/lib/scanner/types";
import { formatScore, projectTypeLabel, scoreEntries } from "@/lib/utils/format";

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
  const source = report.scanSource;

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
            <details className="group" key={label}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                <span className="text-sm text-slate-700">{label}</span>
                <span className="font-medium text-slate-950">{formatScore(value)}</span>
              </summary>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                {scoreExplanation(label, report)}
              </p>
            </details>
          ))}
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

function scoreExplanation(label: string, report: ScanReport) {
  const category = scoreCategory(label);
  const related = category
    ? report.findings.filter((finding) => finding.category === category).map((finding) => finding.title).slice(0, 2)
    : [];
  const loweredBy = related.length > 0 ? ` Lowered by: ${related.join("; ")}.` : " No direct findings lowered this score.";

  switch (label) {
    case "Architecture":
      return `Measures whether agent or workflow boundaries are documented with structured manifests.${loweredBy}`;
    case "Prompt quality":
      return `Measures prompt inventory, versioned prompt files, and prompt-auditor results when enabled.${loweredBy}`;
    case "Tool governance":
      return `Measures approval and dry-run policy for tools that can write or publish data.${loweredBy}`;
    case "Eval coverage":
      return `Measures whether evals or tests cover core agent, prompt, tool, and workflow behavior.${loweredBy}`;
    case "Security":
      return `Measures secret exposure and sensitive file hygiene after redaction.${loweredBy}`;
    case "Documentation":
      return `Measures README, AGENTS.md, and operational documentation coverage.${loweredBy}`;
    default:
      return "Weighted scanner score across the report.";
  }
}

function scoreCategory(label: string) {
  switch (label) {
    case "Architecture": return "architecture";
    case "Prompt quality": return "promptQuality";
    case "Tool governance": return "toolGovernance";
    case "Eval coverage": return "evalCoverage";
    case "Security": return "security";
    case "Documentation": return "documentation";
    default: return undefined;
  }
}
