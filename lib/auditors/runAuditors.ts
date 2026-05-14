import { buildRecommendations } from "@/lib/reports/recommendations";
import { scoreScan } from "@/lib/scanner/scoreScan";
import type { RepoFile, ScanReport } from "@/lib/scanner/types";
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

interface RunAuditorsOptions {
  allowLlmAuditors?: boolean;
}

export async function runAuditors(
  report: ScanReport,
  files: RepoFile[],
  options: RunAuditorsOptions = {},
): Promise<ScanReport> {
  const results = await Promise.all(
    auditors.map((auditor) =>
      auditor({
        report,
        files,
        allowLlmAuditors: options.allowLlmAuditors,
      }),
    ),
  );
  const auditorFindings = results.flatMap((result) => result.findings);
  const deduped = new Map(report.findings.map((finding) => [finding.id, finding]));

  for (const finding of auditorFindings) {
    deduped.set(finding.id, finding);
  }

  const findings = [...deduped.values()];
  const scores = scoreScan(findings);
  const promptAuditorResult = results.find((result) => result.auditor === "prompt");

  if (promptAuditorResult?.promptQualityScore !== undefined) {
    scores.promptQuality = Math.round(promptAuditorResult.promptQualityScore);
    scores.overall = overallScore(scores);
  }

  return {
    ...report,
    findings,
    scores,
    recommendations: buildRecommendations(findings, { projectType: report.projectType }),
    auditorStatus: promptAuditorResult?.auditorStatus,
  };
}


function overallScore(scores: ScanReport["scores"]) {
  return Math.round(
    scores.architecture * 0.2 +
      scores.promptQuality * 0.2 +
      scores.toolGovernance * 0.2 +
      scores.evalCoverage * 0.15 +
      scores.security * 0.15 +
      scores.documentation * 0.1,
  );
}
