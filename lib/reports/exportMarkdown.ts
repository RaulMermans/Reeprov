import type { Finding, ScanReport } from "@/lib/scanner/types";
import { formatScore, projectTypeLabel, scoreEntries } from "@/lib/utils/format";

const severityOrder: Finding["severity"][] = ["critical", "high", "medium", "low", "info"];

export function exportReportMarkdown(report: ScanReport) {
  const source = report.scanSource;
  const lines = [
    `# AgentPulse Report: ${report.repoName}`,
    "",
    `- Scan source: ${source ? `${source.type.toUpperCase()} - ${source.label}` : "Unknown"}`,
    `- Scanned at: ${report.scannedAt}`,
    `- Overall score: ${formatScore(report.scores.overall)}`,
    `- Project type: ${projectTypeLabel(report.projectType)}`,
    `- Auditor mode: ${auditorMode(report)}`,
    `- Files scanned: ${report.filesScanned}`,
    `- Files ignored: ${report.ignoredFiles}`,
    ...zipStatsMarkdown(report),
    "",
    "## Detected Counts",
    "",
    `- Agents: ${report.detectedAgents.length}`,
    `- AI/product workflows: ${report.detectedWorkflowsDetailed.length}`,
    `- CI workflows: ${report.detectedCIWorkflows.length}`,
    `- Prompt files: ${report.detectedPrompts.length}`,
    `- Tools: ${report.detectedTools.length}`,
    `- Dedicated AI evals: ${report.detectedEvals.length}`,
    `- Software tests: ${report.detectedTests.length}`,
    "",
    "## Scores",
    "",
    ...scoreEntries(report.scores).map(([label, value]) => `- ${label}: ${formatScore(value)}`),
    "",
    "## Detected Agents",
    "",
    ...listOrEmpty(
      report.detectedAgents.map((agent) => {
        const sourceLabel = agent.source === "explicit" ? "explicit" : `inferred (${agent.confidence} confidence)`;
        const details = [
          agent.configPath ? `config: ${agent.configPath}` : undefined,
          agent.source === "explicit" && agent.promptPaths.length
            ? `prompts: ${agent.promptPaths.join(", ")}`
            : undefined,
          agent.source === "explicit" && agent.toolNames.length
            ? `tools: ${agent.toolNames.join(", ")}`
            : undefined,
          `source: ${sourceLabel}`,
        ].filter(Boolean);
        return `- ${agent.name}${details.length ? ` (${details.join("; ")})` : ""}`;
      }),
      "- None detected.",
    ),
    "",
    "## Detected AI/Product Workflows",
    "",
    ...listOrEmpty(
      report.detectedWorkflowsDetailed.map((workflow) => {
        const sourceLabel = workflow.source === "explicit" ? "explicit" : `inferred (${workflow.confidence} confidence)`;
        const details = [
          workflow.type ? `type: ${workflow.type}` : undefined,
          workflow.configPath ? `config: ${workflow.configPath}` : undefined,
          `source: ${sourceLabel}`,
        ].filter(Boolean);
        return `- ${workflow.name}${details.length ? ` (${details.join("; ")})` : ""}`;
      }),
      "- None detected.",
    ),
    "",
    ...ciWorkflowsMarkdown(report),
    "## Findings",
    "",
    ...findingsMarkdown(report.findings),
    "",
    "## Recommendations",
    "",
    ...listOrEmpty(report.recommendations.map((recommendation) => `- ${recommendation}`), "- None."),
    "",
  ];

  return lines.join("\n");
}

function ciWorkflowsMarkdown(report: ScanReport) {
  if (report.detectedCIWorkflows.length === 0) return [];
  return [
    "## CI Workflows",
    "",
    ...report.detectedCIWorkflows.map((w) => `- ${w.name} (${w.path}, ${w.provider})`),
    "",
  ];
}

function zipStatsMarkdown(report: ScanReport) {
  if (!report.zipStats) return [];

  return [
    `- ZIP entries: ${report.zipStats.totalEntries}`,
    `- ZIP candidate files: ${report.zipStats.candidateFiles}`,
    `- ZIP scanned files: ${report.zipStats.scannedFiles}`,
    `- ZIP skipped files: ${report.zipStats.skippedByFileLimit}`,
  ];
}

function findingsMarkdown(findings: Finding[]) {
  if (findings.length === 0) {
    return ["No findings detected by current scanner rules."];
  }

  const lines: string[] = [];

  for (const severity of severityOrder) {
    const group = findings.filter((finding) => finding.severity === severity);
    if (group.length === 0) continue;

    lines.push(`### ${capitalize(severity)}`, "");

    for (const finding of group) {
      lines.push(`- ${finding.title} (${finding.category}, confidence ${Math.round(finding.confidence * 100)}%)`);
      lines.push(`  - Summary: ${finding.summary}`);
      lines.push(
        `  - Evidence paths: ${finding.evidencePaths.length > 0 ? finding.evidencePaths.join(", ") : "None"}`,
      );
      if (finding.evidenceSnippets?.length) {
        lines.push("  - Evidence snippets:");
        for (const snippet of finding.evidenceSnippets) {
          lines.push(`    - ${snippet.path}: \`${snippet.excerpt}\``);
        }
      }
      lines.push(`  - Recommendation: ${finding.recommendation}`);
    }

    lines.push("");
  }

  return lines;
}

function listOrEmpty(values: string[], empty: string) {
  return values.length > 0 ? values : [empty];
}

function auditorMode(report: ScanReport) {
  return report.auditorStatus?.llmAuditorsEnabled && report.auditorStatus.promptAuditorRan
    ? "Static + LLM Prompt Auditor"
    : "Static only";
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
