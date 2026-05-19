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
    `- Scan source: ${source ? `${source.type.toUpperCase()} - ${source.label}` : "Unknown"}`,
    `- Scanned at: ${report.scannedAt}`,
    `- Overall score: ${formatScore(report.scores.overall)}`,
    `- Project type: ${projectTypeLabel(report.projectType)} — ${projectTypeDescription(report.projectType)}`,
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
          isMapped && agent.evalPaths.length
            ? `evals: ${agent.evalPaths.join(", ")}`
            : undefined,
          isMapped && agent.model
            ? `model: ${agent.model.provider}${agent.model.name ? `/${agent.model.name}` : ""}`
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
    ...systemGraphMarkdown(report),
    ...modelMatrixMarkdown(report),
    ...workflowVisualizationMarkdown(report),
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

function systemGraphMarkdown(report: ScanReport): string[] {
  const g = report.systemGraph;
  if (!g) return [];
  const lines: string[] = ["## AI System Graph Summary", ""];
  lines.push(`- Agents: ${g.summary.agentCount}`);
  lines.push(`- Workflows: ${g.summary.workflowCount}`);
  lines.push(`- Prompts: ${g.summary.promptCount}`);
  lines.push(`- Tools: ${g.summary.toolCount}`);
  lines.push(`- Models: ${g.summary.modelCount}`);
  lines.push(`- Evals: ${g.summary.evalCount}`);
  lines.push(`- Mapped agents: ${g.summary.mappedAgentCount}`);
  lines.push(`- Unmapped agents: ${g.summary.unmappedAgentCount}`);
  lines.push("");
  // Edge type counts
  const edgeTypeCounts = new Map<string, number>();
  for (const e of g.edges) edgeTypeCounts.set(e.type, (edgeTypeCounts.get(e.type) ?? 0) + 1);
  if (edgeTypeCounts.size > 0) {
    lines.push("Edges by type:");
    for (const [type, count] of edgeTypeCounts) {
      lines.push(`- ${type}: ${count}`);
    }
    lines.push("");
  }
  if (g.warnings.length > 0) {
    lines.push("Mapping gaps:");
    for (const w of g.warnings) {
      lines.push(`- [${w.severity}] ${w.message} — ${w.recommendation}`);
    }
    lines.push("");
  }
  return lines;
}

function modelMatrixMarkdown(report: ScanReport): string[] {
  const models = report.detectedModels ?? [];
  if (models.length === 0) {
    return [
      "## Model / Provider Matrix",
      "",
      "No provider/model mapping detected. Add model.provider and model.name to agents.yaml or workflow.yaml.",
      "",
    ];
  }

  const lines: string[] = ["## Model / Provider Matrix", ""];
  lines.push("| Agent/Step | Provider | Model | Source | Confidence | Performance |");
  lines.push("|---|---|---|---|---|---|");
  for (const m of models) {
    const mappedAgentId = m.mappedAgentIds?.[0];
    const mappedAgent = report.detectedAgents.find((a) => a.id === mappedAgentId);
    const target = mappedAgent?.name ?? mappedAgentId ?? "Unmapped";
    const hasPerf = (report.modelPerformance ?? []).some(
      (p) => p.provider === m.provider && (m.model ? p.model === m.model : false),
    );
    lines.push(
      `| ${target} | ${m.provider} | ${m.model ?? "provider detected"} | ${m.source} | ${m.confidence} | ${hasPerf ? "available" : "unavailable"} |`,
    );
  }
  lines.push("");
  if ((report.modelPerformance ?? []).length === 0) {
    lines.push(
      "Performance unavailable. Add eval result files with provider, model, score, tokens, latency, and cost to compare models.",
    );
    lines.push("");
  }
  return lines;
}

function workflowVisualizationMarkdown(report: ScanReport): string[] {
  const workflows = report.detectedWorkflowsDetailed;
  const detailed = workflows.filter((w) => w.stagesDetailed && w.stagesDetailed.length > 0);
  if (detailed.length === 0) return [];

  const lines: string[] = ["## Workflow Visualization Data", ""];
  for (const wf of detailed) {
    lines.push(`### ${wf.name}`);
    for (const stage of wf.stagesDetailed ?? []) {
      const parts: string[] = [stage.name ?? stage.id];
      if (stage.agent) parts.push(`agent=${stage.agent}`);
      if (stage.prompt) parts.push(`prompt=${stage.prompt}`);
      if (stage.tools?.length) parts.push(`tools=[${stage.tools.join(",")}]`);
      if (stage.model) parts.push(`model=${stage.model.provider}/${stage.model.name ?? "?"}`);
      if (stage.evals?.length) parts.push(`evals=[${stage.evals.join(",")}]`);
      if (stage.approvalGate) parts.push("approval=true");
      if (stage.artifacts?.length) parts.push(`artifacts=[${stage.artifacts.join(",")}]`);
      lines.push(`- ${parts.join(" → ")}`);
    }
    lines.push("");
  }
  return lines;
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
