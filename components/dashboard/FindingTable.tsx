"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import type { Finding } from "@/lib/scanner/types";

const severityTone = {
  info: "info",
  low: "neutral",
  medium: "warning",
  high: "danger",
  critical: "danger",
} as const;

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
              <option key={value} value={value}>{value}</option>
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
            {visibleFindings.map((finding) => (
              <tr key={finding.id} className="align-top">
                <td className="px-4 py-4">
                  <Badge tone={severityTone[finding.severity]}>{finding.severity}</Badge>
                </td>
                <td className="px-4 py-4">
                  <div className="font-medium text-slate-950">{finding.title}</div>
                  <div className="mt-1 text-slate-600">{finding.summary}</div>
                  <EvidenceSnippets finding={finding} />
                </td>
                <td className="px-4 py-4 text-slate-600">
                  {finding.evidencePaths.length > 0 ? finding.evidencePaths.join(", ") : "None"}
                </td>
                <td className="px-4 py-4 text-slate-700">{finding.recommendation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
