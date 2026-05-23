/**
 * Deterministic report diff logic.
 *
 * Finding identity for v1: `${category}::${title}` (normalized).
 * This is stable enough to detect added/resolved/unchanged findings
 * without perfect string matching.
 */

import type { Finding, ScanReport, Scores } from "@/lib/scanner/types";
import type { RegressionCandidate } from "./regressionCandidates";
import { generateRegressionCandidates } from "./regressionCandidates";

// ── Finding identity ──────────────────────────────────────────────────────────

function findingKey(f: Finding): string {
  const category = f.category.toLowerCase().trim();
  const title = f.title.toLowerCase().replace(/\s+/g, " ").trim();
  return `${category}::${title}`;
}

// ── Score delta ───────────────────────────────────────────────────────────────

export interface ScoreDeltas {
  architecture: number;
  promptQuality: number;
  toolGovernance: number;
  evalCoverage: number;
  security: number;
  documentation: number;
  maintainability: number;
  overall: number;
}

function computeScoreDeltas(base: Scores, target: Scores): ScoreDeltas {
  return {
    architecture: target.architecture - base.architecture,
    promptQuality: target.promptQuality - base.promptQuality,
    toolGovernance: target.toolGovernance - base.toolGovernance,
    evalCoverage: target.evalCoverage - base.evalCoverage,
    security: target.security - base.security,
    documentation: target.documentation - base.documentation,
    maintainability: target.maintainability - base.maintainability,
    overall: target.overall - base.overall,
  };
}

// ── Detected counts delta ─────────────────────────────────────────────────────

export interface DetectedCountDelta {
  agents: number;
  prompts: number;
  tools: number;
  evals: number;
  tests: number;
  workflows: number;
}

function computeCountDeltas(base: ScanReport, target: ScanReport): DetectedCountDelta {
  return {
    agents: target.detectedAgents.length - base.detectedAgents.length,
    prompts: target.detectedPrompts.length - base.detectedPrompts.length,
    tools: target.detectedTools.length - base.detectedTools.length,
    evals: target.detectedEvals.length - base.detectedEvals.length,
    tests: target.detectedTests.length - base.detectedTests.length,
    workflows: target.detectedWorkflowsDetailed.length - base.detectedWorkflowsDetailed.length,
  };
}

// ── Finding diff ──────────────────────────────────────────────────────────────

export interface FindingChange {
  status: "added" | "resolved" | "unchanged" | "worsened" | "improved";
  finding: Finding;
  baseFinding?: Finding;
}

export interface FindingDiff {
  added: Finding[];
  resolved: Finding[];
  unchanged: Finding[];
  worsened: Array<{ base: Finding; target: Finding }>;
  improved: Array<{ base: Finding; target: Finding }>;
  /** Convenience: all changes in a single list for rendering. */
  all: FindingChange[];
}

const SEVERITY_RANK: Record<Finding["severity"], number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function diffFindings(baseFindings: Finding[], targetFindings: Finding[]): FindingDiff {
  const baseMap = new Map<string, Finding>(baseFindings.map((f) => [findingKey(f), f]));
  const targetMap = new Map<string, Finding>(targetFindings.map((f) => [findingKey(f), f]));

  const added: Finding[] = [];
  const resolved: Finding[] = [];
  const unchanged: Finding[] = [];
  const worsened: Array<{ base: Finding; target: Finding }> = [];
  const improved: Array<{ base: Finding; target: Finding }> = [];
  const all: FindingChange[] = [];

  // Check target findings
  for (const [key, targetFinding] of targetMap) {
    const baseFinding = baseMap.get(key);
    if (!baseFinding) {
      added.push(targetFinding);
      all.push({ status: "added", finding: targetFinding });
    } else {
      const baseRank = SEVERITY_RANK[baseFinding.severity];
      const targetRank = SEVERITY_RANK[targetFinding.severity];
      if (targetRank > baseRank) {
        worsened.push({ base: baseFinding, target: targetFinding });
        all.push({ status: "worsened", finding: targetFinding, baseFinding });
      } else if (targetRank < baseRank) {
        improved.push({ base: baseFinding, target: targetFinding });
        all.push({ status: "improved", finding: targetFinding, baseFinding });
      } else {
        unchanged.push(targetFinding);
        all.push({ status: "unchanged", finding: targetFinding });
      }
    }
  }

  // Check for resolved findings (in base but not target)
  for (const [key, baseFinding] of baseMap) {
    if (!targetMap.has(key)) {
      resolved.push(baseFinding);
      all.push({ status: "resolved", finding: baseFinding });
    }
  }

  return { added, resolved, unchanged, worsened, improved, all };
}

// ── Status change ─────────────────────────────────────────────────────────────

function computeStatusChange(
  baseScore: number,
  targetScore: number,
): string | null {
  const baseStatus = scoreToStatus(baseScore);
  const targetStatus = scoreToStatus(targetScore);
  if (baseStatus === targetStatus) return null;
  return `${baseStatus} → ${targetStatus}`;
}

function scoreToStatus(score: number): string {
  if (score >= 80) return "healthy";
  if (score >= 60) return "needs-attention";
  if (score >= 40) return "at-risk";
  return "critical";
}

// ── Full report diff ──────────────────────────────────────────────────────────

export interface ReportDiff {
  baseReportId: string;
  targetReportId: string;
  baseProjectId: string;
  generatedAt: string;
  scoreDeltas: ScoreDeltas;
  detectedCountDeltas: DetectedCountDelta;
  statusChange: string | null;
  findings: FindingDiff;
  /** High/critical findings newly appearing in target */
  newHighRisks: Finding[];
  /** High/critical findings present in base but resolved in target */
  resolvedHighRisks: Finding[];
  regressionCandidates: RegressionCandidate[];
}

export function diffReports(base: ScanReport, target: ScanReport): ReportDiff {
  const scoreDeltas = computeScoreDeltas(base.scores, target.scores);
  const detectedCountDeltas = computeCountDeltas(base, target);
  const findings = diffFindings(base.findings, target.findings);
  const statusChange = computeStatusChange(base.scores.overall, target.scores.overall);

  const newHighRisks = findings.added.filter(
    (f) => f.severity === "high" || f.severity === "critical",
  );
  const resolvedHighRisks = findings.resolved.filter(
    (f) => f.severity === "high" || f.severity === "critical",
  );

  const regressionCandidates = generateRegressionCandidates(
    target,
    findings,
    scoreDeltas,
  );

  return {
    baseReportId: base.reportId,
    targetReportId: target.reportId,
    baseProjectId: base.projectId,
    generatedAt: new Date().toISOString(),
    scoreDeltas,
    detectedCountDeltas,
    statusChange,
    findings,
    newHighRisks,
    resolvedHighRisks,
    regressionCandidates,
  };
}
