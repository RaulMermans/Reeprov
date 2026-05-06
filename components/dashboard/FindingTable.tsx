import { Badge } from "@/components/ui/Badge";
import type { Finding } from "@/lib/scanner/types";

const severityTone = {
  info: "info",
  low: "neutral",
  medium: "warning",
  high: "danger",
  critical: "danger",
} as const;

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
