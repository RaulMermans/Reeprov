import { Activity } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { ScanReport } from "@/lib/scanner/types";
import { formatScore, statusForScore, statusTone } from "@/lib/utils/format";

export function HealthOverview({ report }: { report: ScanReport }) {
  const label = report.scanSource?.label ?? report.repoName;

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <Activity className="h-4 w-4" />
            Repository health
          </div>
          <h1 className="mt-3 break-all text-3xl font-semibold text-slate-950">{label}</h1>
          <p className="mt-2 text-sm text-slate-600">
            Scanned {report.filesScanned} files
            {report.ignoredFiles > 0 ? `, ignored ${report.ignoredFiles}` : ""}
          </p>
        </div>
        <div className="text-right">
          <div className="text-5xl font-semibold text-slate-950">
            {formatScore(report.scores.overall)}
          </div>
          <Badge tone={statusTone(report.scores.overall)} className="mt-3">
            {statusForScore(report.scores.overall)}
          </Badge>
        </div>
      </div>
    </Card>
  );
}
