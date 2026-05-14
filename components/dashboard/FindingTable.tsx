"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { buildFindingSummary, categoryLabel, SEVERITY_ORDER } from "@/lib/reports/findingSummary";
import type { Finding } from "@/lib/scanner/types";

const severityTone = {
  info: "info",
  low: "neutral",
  medium: "warning",
  high: "danger",
  critical: "danger",
} as const;

// Derive a short file-context label from a finding's summary text.
function findingContextLabel(finding: Finding): string | null {
  const summary = finding.summary;
  if (summary.includes("(documentation)")) return "documentation";
  if (summary.includes("(example/fixture)")) return "example";
  if (summary.includes("(test file)")) return "test file";
  if (summary.includes("(migration file)")) return "migration";
  if (summary.includes("(CI configuration)")) return "CI configuration";
  if (summary.includes("(production)")) return "production";
  return null;
}

function EvidenceSnippets({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);

  if (!finding.evidenceSnippets || finding.evidenceSnippets.length === 0) {
    return null;
  }

  return (
    <div className="mt-2">
      <button
        className="text-xs font-medium text-teal-700 hover:text-teal-900"
        onClick={() => setOpen((prev) => !prev)}
        type="button"
      >
        {open ? "Hide evidence" : "View evidence"}
      </button>
      {open ? (
        <div className="mt-2 space-y-1">
          {finding.evidenceSnippets.map((snippet, index) => (
            <div
              className="rounded border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700"
              key={index}
            >
              <div className="mb-1 text-slate-400">{snippet.path}</div>
              <div className="break-all">{snippet.excerpt}</div>
              {snippet.redacted ? (
                <div className="mt-1 text-slate-400">(values redacted)</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FindingSummaryBar({ findings }: { findings: Finding[] }) {
  const summary = useMemo(() => buildFindingSummary(findings), [findings]);

  const severityColors = {
    critical: "text-red-700 font-semibold",
    high: "text-orange-700 font-semibold",
    medium: "text-amber-700",
    low: "text-slate-600",
    info: "text-slate-400",
  } as const;

  const nonZero = SEVERITY_ORDER.filter((s) => summary.bySeverity[s] > 0);

  if (findings.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs">
      <span className="font-medium text-slate-500">Summary:</span>
      {nonZero.map((s) => (
        <span className={severityColors[s]} key={s}>
          {summary.bySeverity[s]} {s}
        </span>
      ))}
      {nonZero.length === 0 && <span className="text-slate-400">No findings.</span>}
      {summary.secretContexts.length > 0 && (
        <>
          <span className="mx-1 text-slate-300">|</span>
          <span className="font-medium text-slate-500">Secrets:</span>
          {summary.secretContexts.map((sc) => (
            <span className="text-slate-500" key={sc.context}>
              {sc.count} {sc.label.toLowerCase()}
            </span>
          ))}
        </>
      )}
    </div>
  );
}

export function FindingTable({ findings }: { findings: Finding[] }) {
  const [severity, setSeverity] = useState<Finding["severity"] | "all">("all");
  const [category, setCategory] = useState("all");
  const [actionableOnly, setActionableOnly] = useState(false);
  const categories = useMemo(
    () => [...new Set(findings.map((finding) => finding.category))].sort(),
    [findings],
  );
  const visibleFindings = findings.filter((finding) => {
    if (severity !== "all" && finding.severity !== severity) return false;
    if (category !== "all" && finding.category !== category) return false;
    if (actionableOnly && finding.severity === "info") return false;
    return true;
  });

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <FindingSummaryBar findings={findings} />
      <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 p-4 md:flex-row md:items-center">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600" htmlFor="severity-filter">
          Severity
          <select
            className="min-h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100"
            id="severity-filter"
            onChange={(event) => setSeverity(event.target.value as Finding["severity"] | "all")}
            value={severity}
          >
            {["all", "critical", "high", "medium", "low", "info"].map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600" htmlFor="category-filter">
          Category
          <select
            className="min-h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100"
            id="category-filter"
            onChange={(event) => setCategory(event.target.value)}
            value={category}
          >
            <option value="all">all</option>
            {categories.map((value) => (
              <option key={value} value={value}>{categoryLabel(value)}</option>
            ))}
          </select>
        </label>
        <label className="mt-1 flex items-center gap-2 text-sm font-medium text-slate-700 md:ml-auto md:mt-5">
          <input
            checked={actionableOnly}
            className="h-4 w-4 rounded border-slate-300 text-teal-700"
            onChange={(event) => setActionableOnly(event.target.checked)}
            type="checkbox"
          />
          Actionable only
        </label>
      </div>

      {visibleFindings.length === 0 ? (
        <div className="p-5 text-sm text-slate-600">
          {findings.length === 0
            ? "No findings detected by current scanner rules."
            : "No findings match the current filters."}
        </div>
      ) : (
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Finding</th>
              <th className="px-4 py-3">Evidence</th>
              <th className="px-4 py-3">Recommendation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {visibleFindings.map((finding) => {
              const contextLabel = findingContextLabel(finding);
              return (
                <tr key={finding.id} className="align-top">
                  <td className="px-4 py-4">
                    <Badge tone={severityTone[finding.severity]}>{finding.severity}</Badge>
                    <div className="mt-1">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                        {categoryLabel(finding.category)}
                      </span>
                    </div>
                    {contextLabel ? (
                      <div className="mt-1">
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">
                          {contextLabel}
                        </span>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-4">
                    <div className="font-medium text-slate-950">{finding.title}</div>
                    <div className="mt-1 text-slate-600">{finding.summary}</div>
                    <EvidenceSnippets finding={finding} />
                  </td>
                  <td className="px-4 py-4 text-slate-600">
                    {finding.evidencePaths.length > 0 ? (
                      <ul className="space-y-0.5">
                        {finding.evidencePaths.map((p) => (
                          <li className="break-all font-mono text-xs" key={p}>{p}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-slate-400">None</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-slate-700">{finding.recommendation}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
