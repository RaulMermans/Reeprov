import type { Finding, ScanReport } from "@/lib/scanner/types";

export interface ScoreExplanation {
  category: string;
  label: string;
  score: number;
  summary: string;
  positives: string[];
  penalties: string[];
  relatedFindingIds: string[];
}

export function buildScoreExplanations(report: ScanReport): ScoreExplanation[] {
  return [
    architectureExplanation(report),
    promptQualityExplanation(report),
    toolGovernanceExplanation(report),
    evalCoverageExplanation(report),
    securityExplanation(report),
    documentationExplanation(report),
  ];
}

function relatedFindings(report: ScanReport, category: string): Finding[] {
  return report.findings.filter((f) => f.category === category);
}

function architectureExplanation(report: ScanReport): ScoreExplanation {
  const findings = relatedFindings(report, "architecture");
  const score = report.scores.architecture;
  const hasAgents = report.detectedAgents.length > 0;
  const hasWorkflows = report.detectedWorkflowsDetailed.length > 0;

  const positives: string[] = [];
  if (hasAgents) positives.push(`${report.detectedAgents.length} agent(s) detected.`);
  if (hasWorkflows) positives.push(`${report.detectedWorkflowsDetailed.length} AI/product workflow(s) detected.`);
  if (!hasAgents && !hasWorkflows && report.projectType === "ai_application") {
    positives.push("AI application structure detected.");
  }
  if (positives.length === 0) positives.push("No structural issues detected from file layout.");

  return {
    category: "architecture",
    label: "Architecture",
    score,
    summary: "Measures whether agent or workflow boundaries are documented with structured manifests.",
    positives,
    penalties: findings.filter((f) => f.severity !== "info").map((f) => f.title),
    relatedFindingIds: findings.map((f) => f.id),
  };
}

function promptQualityExplanation(report: ScanReport): ScoreExplanation {
  const findings = relatedFindings(report, "promptQuality");
  const score = report.scores.promptQuality;
  const promptCount = report.detectedPrompts.length;

  const positives: string[] = [];
  if (promptCount > 0) positives.push(`${promptCount} versioned prompt file(s) detected.`);
  else positives.push("No prompt quality issues detected by static scanner.");

  if (report.auditorStatus?.promptAuditorRan) {
    positives.push("LLM Prompt Auditor ran and scored this category.");
  }

  return {
    category: "promptQuality",
    label: "Prompt quality",
    score,
    summary: "Measures prompt inventory, versioned prompt files, and prompt-auditor results when enabled.",
    positives,
    penalties: findings.filter((f) => f.severity !== "info").map((f) => f.title),
    relatedFindingIds: findings.map((f) => f.id),
  };
}

function toolGovernanceExplanation(report: ScanReport): ScoreExplanation {
  const findings = relatedFindings(report, "toolGovernance");
  const score = report.scores.toolGovernance;
  const toolCount = report.detectedTools.length;

  const positives: string[] = [];
  if (toolCount > 0) {
    const hasApprovalFinding = findings.some((f) => f.id === "write-tools-without-approval");
    if (!hasApprovalFinding) {
      positives.push(`${toolCount} tool(s) detected; no missing approval policy flagged.`);
    } else {
      positives.push(`${toolCount} tool(s) detected.`);
    }
  } else {
    positives.push("No tools detected; tool governance not applicable.");
  }

  return {
    category: "toolGovernance",
    label: "Tool governance",
    score,
    summary: "Measures approval and dry-run policy for tools that can write or publish data.",
    positives,
    penalties: findings.filter((f) => f.severity !== "info").map((f) => f.title),
    relatedFindingIds: findings.map((f) => f.id),
  };
}

function evalCoverageExplanation(report: ScanReport): ScoreExplanation {
  const findings = relatedFindings(report, "evalCoverage");
  const score = report.scores.evalCoverage;
  const evalCount = report.detectedEvals.length;
  const testCount = report.detectedTests.length;

  const positives: string[] = [];
  if (evalCount > 0) positives.push(`${evalCount} dedicated AI eval file(s) detected.`);
  if (testCount > 0) positives.push(`${testCount} software test file(s) detected.`);
  if (positives.length === 0) positives.push("No eval or test coverage detected.");

  return {
    category: "evalCoverage",
    label: "Eval coverage",
    score,
    summary: "Measures whether dedicated AI evals cover core agent, prompt, tool, and workflow behavior. Software tests are counted separately.",
    positives,
    penalties: findings.filter((f) => f.severity !== "info").map((f) => f.title),
    relatedFindingIds: findings.map((f) => f.id),
  };
}

function securityExplanation(report: ScanReport): ScoreExplanation {
  const findings = relatedFindings(report, "security");
  const score = report.scores.security;

  const productionHighFindings = findings.filter(
    (f) => f.severity === "high" || f.severity === "critical",
  );
  const testDocFindings = findings.filter(
    (f) => (f.severity === "medium" || f.severity === "low") &&
      (f.summary.includes("(test file)") ||
        f.summary.includes("(documentation)") ||
        f.summary.includes("(example/fixture)") ||
        f.summary.includes("(CI configuration)")),
  );
  const placeholderFindings = findings.filter(
    (f) => f.severity === "info" && f.recommendation.toLowerCase().includes("placeholder"),
  );

  const positives: string[] = [];
  if (productionHighFindings.length === 0) {
    positives.push("No high-confidence production secrets detected.");
  }
  if (testDocFindings.length > 0) {
    positives.push(`${testDocFindings.length} secret-like finding(s) are in test/docs/CI context (lower severity).`);
  }
  if (placeholderFindings.length > 0) {
    positives.push(`${placeholderFindings.length} finding(s) are placeholder/stub values (info only).`);
  }
  if (positives.length === 0) positives.push("No positive security signals found.");

  const penalties = [
    ...productionHighFindings.map((f) => f.title),
    ...findings
      .filter((f) => f.id.startsWith("ignored-env"))
      .map((f) => f.title),
  ];

  return {
    category: "security",
    label: "Security",
    score,
    summary: "Measures secret exposure and sensitive file hygiene. Severity is calibrated by file context (production vs. test/docs).",
    positives,
    penalties,
    relatedFindingIds: findings.map((f) => f.id),
  };
}

function documentationExplanation(report: ScanReport): ScoreExplanation {
  const findings = relatedFindings(report, "documentation");
  const score = report.scores.documentation;

  const hasAgentsMd = !findings.some((f) => f.id === "missing-agents-md");

  const positives: string[] = [];
  if (hasAgentsMd) positives.push("AGENTS.md is present.");
  else positives.push("No additional documentation gaps detected beyond AGENTS.md.");

  return {
    category: "documentation",
    label: "Documentation",
    score,
    summary: "Measures README, AGENTS.md, and operational documentation coverage.",
    positives,
    penalties: findings.filter((f) => f.severity !== "info").map((f) => f.title),
    relatedFindingIds: findings.map((f) => f.id),
  };
}
