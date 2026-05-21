import { buildFindingSummary, categoryLabel, SEVERITY_ORDER } from "@/lib/reports/findingSummary";
import { buildScoreExplanations } from "@/lib/reports/scoreExplanations";
import type { Finding, ScanReport } from "@/lib/scanner/types";
import { formatScore, projectTypeDescription, projectTypeLabel, scoreEntries } from "@/lib/utils/format";

export function exportReportMarkdown(report: ScanReport) {
  const source = report.scanSource;
  const summary = buildFindingSummary(report.findings);
  const scoreExplanations = buildScoreExplanations(report);

  const lines = [
    `# AgentPulse Report: ${report.repoName}`,
    "",
    `- Report version: ${report.reportVersion ?? "1.0"}`,
    `- Scan source: ${source ? `${source.type.toUpperCase()} - ${source.label}` : "Unknown"}`,
    `- Scanned at: ${report.scannedAt}`,
    `- Overall score: ${formatScore(report.scores.overall)}`,
    `- Project type: ${projectTypeLabel(report.projectType)} — ${projectTypeDescription(report.projectType)}`,
    ...(report.repositoryMode
      ? [
          `- Repository mode: ${repositoryModeLabel(report.repositoryMode.mode)} (${report.repositoryMode.confidence} confidence)`,
          `- Scoring policy: ${report.repositoryMode.scoringPolicy.description}`,
        ]
      : []),
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
    ...(report.detectedPromptRelatedFiles && report.detectedPromptRelatedFiles.length > 0
      ? [`- Prompt-related source files: ${report.detectedPromptRelatedFiles.length}`]
      : []),
    `- Tools: ${report.detectedTools.length}`,
    `- Dedicated AI evals: ${report.detectedEvals.length}`,
    `- Software tests: ${report.detectedTests.length}`,
    "",
    "## Scores",
    "",
    ...scoreEntries(report.scores).map(([label, value]) => `- ${label}: ${formatScore(value)}`),
    "",
    ...scoreDimensionsMarkdown(report),
    ...scoreCapsMarkdown(report),
    ...graphCompletenessMarkdown(report),
    ...performanceDataMarkdown(report),
    "## Score Explanations",
    "",
    ...scoreExplanations.flatMap((e) => [
      `### ${e.label}: ${formatScore(e.score)}`,
      "",
      e.summary,
      "",
      e.positives.length > 0 ? `**Positive:** ${e.positives.join(" ")}` : "",
      e.penalties.length > 0 ? `**Penalties:** ${e.penalties.join("; ")}.` : "",
      e.relatedFindingIds.length > 0 ? `Related findings: ${e.relatedFindingIds.length}` : "",
      "",
    ]).filter((line) => line !== ""),
    "## Detected Agents",
    "",
    ...listOrEmpty(
      report.detectedAgents.map((agent) => {
        const sourceLabel = agentSourceLabel(agent);
        const isMapped = agent.displayKind === "manifest" || (!agent.displayKind && agent.source === "explicit");
        const details = [
          agent.configPath ? `config: ${agent.configPath}` : undefined,
          isMapped && agent.promptPaths.length
            ? `prompts: ${agent.promptPaths.join(", ")}`
            : undefined,
          isMapped && agent.toolNames.length
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
    "## Findings Summary",
    "",
    ...SEVERITY_ORDER
      .filter((s) => summary.bySeverity[s] > 0)
      .map((s) => `- ${capitalize(s)}: ${summary.bySeverity[s]}`),
    "",
    ...summary.byCategory.length > 0
      ? ["By category:", ...summary.byCategory.map((c) => `- ${categoryLabel(c.category)}: ${c.count}`), ""]
      : [],
    ...summary.secretContexts.length > 0
      ? ["Secret findings by context:", ...summary.secretContexts.map((sc) => `- ${sc.label}: ${sc.count}`), ""]
      : [],
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
    ...report.detectedCIWorkflows.map((w) => `- ${w.name} (${w.path}, ${ciProviderLabel(w.provider)})`),
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

  for (const severity of SEVERITY_ORDER) {
    const group = findings.filter((finding) => finding.severity === severity);
    if (group.length === 0) continue;

    lines.push(`### ${capitalize(severity)}`, "");

    for (const finding of group) {
      lines.push(`- ${finding.title} (${categoryLabel(finding.category)}, confidence ${Math.round(finding.confidence * 100)}%)`);
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

function ciProviderLabel(provider: string): string {
  switch (provider) {
    case "github_actions": return "GitHub Actions";
    case "gitlab": return "GitLab CI";
    case "circleci": return "CircleCI";
    default: return "CI";
  }
}

function agentSourceLabel(agent: import("@/lib/scanner/types").DetectedAgent): string {
  switch (agent.displayKind) {
    case "manifest": return "explicit manifest";
    case "agent_file": return `agent file (${agent.confidence} confidence)`;
    case "inferred_candidate": return "inferred candidate (low confidence)";
    default:
      return agent.source === "explicit"
        ? "explicit"
        : `inferred (${agent.confidence} confidence)`;
  }
}

function repositoryModeLabel(mode: import("@/lib/scanner/types").RepositoryMode): string {
  switch (mode) {
    case "ai_application": return "AI Application";
    case "ai_framework_library": return "AI Framework/Library";
    case "example_template": return "Example/Template";
    case "non_ai": return "Non-AI";
    case "unknown_ai": return "Unknown AI";
  }
}

function scoreDimensionsMarkdown(report: ScanReport): string[] {
  const dim = report.scoreDimensions;
  if (!dim) return [];

  const aiHealth = dim.aiSystemHealth !== null
    ? formatScore(dim.aiSystemHealth)
    : "N/A (not applicable for this repository mode)";

  const governance = dim.governanceCompleteness !== null
    ? formatScore(dim.governanceCompleteness)
    : "N/A";

  return [
    "## Score Dimensions",
    "",
    `- AI System Health: ${aiHealth}`,
    `- General Repo Hygiene: ${formatScore(dim.generalRepoHygiene)}`,
    `- Governance Completeness: ${governance}`,
    `- Graph Mapping Completeness: ${formatScore(dim.graphMappingCompleteness)}`,
    `- Scoring Confidence: ${dim.confidence}`,
    "",
  ];
}

function scoreCapsMarkdown(report: ScanReport): string[] {
  const caps = report.scoreCapsApplied;
  if (!caps || caps.length === 0) return [];

  return [
    "## Score Caps Applied",
    "",
    ...caps.map((c) => `- **${c.dimension}** capped at ${c.cap}: ${c.reason}`),
    "",
  ];
}

function graphCompletenessMarkdown(report: ScanReport): string[] {
  const g = report.graphCompleteness;
  if (!g) return [];

  return [
    "## Graph Mapping Completeness",
    "",
    `- Overall completeness score: ${formatScore(g.completenessScore)}`,
    `- Agents mapped: ${g.mappedAgents} / ${g.totalAgents}`,
    `- Prompts mapped: ${g.mappedPrompts} / ${g.totalPrompts}`,
    `- Tools mapped: ${g.mappedTools} / ${g.totalTools}`,
    `- Evals mapped: ${g.mappedEvals} / ${g.totalEvals}`,
    ...(g.totalWorkflowSteps > 0
      ? [`- Workflow steps with agent coverage: ${g.workflowStepsWithAgent} / ${g.totalWorkflowSteps}`]
      : []),
    "",
  ];
}

function performanceDataMarkdown(report: ScanReport): string[] {
  const perf = report.performanceData;
  if (!perf || !perf.available) return [];

  const lines: string[] = [
    "## Eval Performance Data",
    "",
    `- Result files: ${perf.resultFiles.join(", ")}`,
    `- Total results: ${perf.evalResultCount}`,
  ];

  // Summarize models seen
  const models = [...new Set(perf.results.map((r) => r.model).filter(Boolean))];
  if (models.length > 0) lines.push(`- Models: ${models.join(", ")}`);

  // Average score if available
  const scores = perf.results.map((r) => r.score).filter((s): s is number => s !== undefined);
  if (scores.length > 0) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    lines.push(`- Average score: ${Math.round(avg * 100) / 100}`);
  }

  const passResults = perf.results.filter((r) => r.pass !== undefined);
  if (passResults.length > 0) {
    const passed = passResults.filter((r) => r.pass).length;
    lines.push(`- Pass rate: ${passed}/${passResults.length}`);
  }

  lines.push("");
  return lines;
}
