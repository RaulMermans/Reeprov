"use client";

import { useState } from "react";
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
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
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
          {findings.map((finding) => (
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
    </div>
  );
}
