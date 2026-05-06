import { scoreScan } from "@/lib/scanner/scoreScan";
import type { ScanReport } from "@/lib/scanner/types";
import { architectureAuditor } from "./architectureAuditor";
import { documentationAuditor } from "./documentationAuditor";
import { evalAuditor } from "./evalAuditor";
import { promptAuditor } from "./promptAuditor";
import { safetyAuditor } from "./safetyAuditor";
import { toolAuditor } from "./toolAuditor";

const auditors = [
  architectureAuditor,
  promptAuditor,
  toolAuditor,
  evalAuditor,
  safetyAuditor,
  documentationAuditor,
];

export function runAuditors(report: ScanReport): ScanReport {
  const auditorFindings = auditors.flatMap((auditor) => auditor({ report }).findings);
  const deduped = new Map(report.findings.map((finding) => [finding.id, finding]));

  for (const finding of auditorFindings) {
    deduped.set(finding.id, finding);
  }

  const findings = [...deduped.values()];

  return {
    ...report,
    findings,
    scores: scoreScan(findings),
    recommendations: findings
      .filter((finding) => finding.severity !== "info")
      .slice(0, 5)
      .map((finding) => finding.recommendation),
  };
}
