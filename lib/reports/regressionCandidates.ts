/**
 * Deterministic regression candidate generation.
 *
 * A regression candidate is an important change between two reports that
 * should be covered by a test or golden fixture. Candidates are generated
 * without LLM calls — purely from structural analysis of the diff.
 */

import type { Finding, ScanReport } from "@/lib/scanner/types";
import type { FindingDiff, ScoreDeltas } from "./reportDiff";

// ── Candidate shape ───────────────────────────────────────────────────────────

export interface RegressionCandidate {
  id: string;
  projectId: string;
  reportId: string;
  severity: "high" | "medium" | "low" | "info";
  category: string;
  title: string;
  reason: string;
  suggestedTest: string;
  sourceFindingId?: string;
  createdAt: string;
}

// ── ID generation (deterministic from content) ────────────────────────────────

function candidateId(projectId: string, category: string, title: string): string {
  const safe = `${projectId}::${category}::${title}`
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, "_")
    .slice(0, 96);
  return `rc_${safe}`;
}

// ── Candidate generators ──────────────────────────────────────────────────────

const SCORE_DROP_THRESHOLD = 5;

function candidateForNewFinding(
  finding: Finding,
  report: ScanReport,
  createdAt: string,
): RegressionCandidate {
  const severity: RegressionCandidate["severity"] =
    finding.severity === "critical" || finding.severity === "high"
      ? "high"
      : finding.severity === "medium"
        ? "medium"
        : "low";

  return {
    id: candidateId(report.projectId, finding.category, finding.title),
    projectId: report.projectId,
    reportId: report.reportId,
    severity,
    category: finding.category,
    title: `Regression: ${finding.title}`,
    reason: `A new ${finding.severity} severity finding appeared: "${finding.title}" (${finding.category}).`,
    suggestedTest: `Add scanner test: ${finding.category} finding "${finding.title}" is detected and evidence paths are reported correctly.`,
    sourceFindingId: finding.id,
    createdAt,
  };
}

function candidateForScoreDrop(
  dimension: string,
  delta: number,
  report: ScanReport,
  createdAt: string,
): RegressionCandidate {
  return {
    id: candidateId(report.projectId, "score_regression", dimension),
    projectId: report.projectId,
    reportId: report.reportId,
    severity: Math.abs(delta) >= 15 ? "high" : "medium",
    category: "score_regression",
    title: `Score drop: ${dimension} (${delta > 0 ? "+" : ""}${delta.toFixed(0)} pts)`,
    reason: `The ${dimension} score dropped by ${Math.abs(delta).toFixed(0)} points, exceeding the regression threshold of ${SCORE_DROP_THRESHOLD} points.`,
    suggestedTest: `Add golden report fixture that asserts ${dimension} score remains above previous baseline. Check what changed in the ${dimension} auditor inputs.`,
    createdAt,
  };
}

function candidateForMissingReportVersion(
  report: ScanReport,
  createdAt: string,
): RegressionCandidate {
  return {
    id: candidateId(report.projectId, "schema_contract", "reportVersion_missing"),
    projectId: report.projectId,
    reportId: report.reportId,
    severity: "medium",
    category: "schema_contract",
    title: "reportVersion field missing or invalid",
    reason:
      "The report is missing a valid reportVersion field. This breaks scan history, diffs, and future schema migration.",
    suggestedTest:
      "Add regression test: scanReportSchema.parse(report) must succeed and report.reportVersion must be a non-empty string.",
    createdAt,
  };
}

function candidateForEvalCoverageDecrease(
  delta: number,
  report: ScanReport,
  createdAt: string,
): RegressionCandidate {
  return {
    id: candidateId(report.projectId, "eval_coverage", "decrease"),
    projectId: report.projectId,
    reportId: report.reportId,
    severity: "medium",
    category: "eval_coverage",
    title: `Eval coverage decreased (${delta > 0 ? "+" : ""}${delta.toFixed(0)} pts)`,
    reason: `Eval coverage score dropped by ${Math.abs(delta).toFixed(0)} points. Dedicated AI evals may have been removed or misconfigured.`,
    suggestedTest:
      "Verify eval files still exist and are detected by the scanner. Add a golden fixture for a repo with a /evals directory.",
    createdAt,
  };
}

function candidateForSecurityRegression(
  finding: Finding,
  report: ScanReport,
  createdAt: string,
): RegressionCandidate {
  return {
    id: candidateId(report.projectId, "security", finding.title),
    projectId: report.projectId,
    reportId: report.reportId,
    severity: "high",
    category: "security",
    title: `New security finding: ${finding.title}`,
    reason: `A new security finding appeared (${finding.severity} severity): "${finding.title}". This may indicate credential exposure or unsafe automation.`,
    suggestedTest: `Add scanner test: "${finding.title}" is detected when the relevant pattern exists and is high/medium confidence. Ensure no false positives from example/fixture files.`,
    sourceFindingId: finding.id,
    createdAt,
  };
}

function candidateForMissingGoldenFixtures(
  report: ScanReport,
  createdAt: string,
): RegressionCandidate {
  return {
    id: candidateId(report.projectId, "golden_fixtures", "missing"),
    projectId: report.projectId,
    reportId: report.reportId,
    severity: "low",
    category: "golden_fixtures",
    title: "No golden report fixtures detected",
    reason:
      "The report indicates no golden fixtures are present. Semantic regressions in report output may go undetected as the scanner evolves.",
    suggestedTest:
      "Add golden fixture: save a known-good scan output and assert it matches on future runs. Use tests/fixtures/reports/ as the fixture location.",
    createdAt,
  };
}

function candidateForWorkflowMappingLoss(
  report: ScanReport,
  countDelta: number,
  createdAt: string,
): RegressionCandidate {
  return {
    id: candidateId(report.projectId, "workflow_mapping", "loss"),
    projectId: report.projectId,
    reportId: report.reportId,
    severity: "medium",
    category: "workflow_mapping",
    title: `Workflow count decreased by ${Math.abs(countDelta)}`,
    reason: `The number of detected workflows decreased by ${Math.abs(countDelta)}. Workflow manifests may have been renamed, removed, or stopped being detected.`,
    suggestedTest:
      "Verify workflow manifest files still exist and are classified as workflow_config by the scanner. Add a scanner test for each workflow manifest pattern.",
    createdAt,
  };
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Generate regression candidates from a report diff.
 * Each candidate is deterministic: same inputs → same candidate IDs.
 */
export function generateRegressionCandidates(
  target: ScanReport,
  findingDiff: FindingDiff,
  scoreDeltas: ScoreDeltas,
  detectedCountDeltas?: { workflows?: number; evals?: number },
): RegressionCandidate[] {
  const createdAt = new Date().toISOString();
  const candidates: RegressionCandidate[] = [];
  const seen = new Set<string>();

  function add(c: RegressionCandidate) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      candidates.push(c);
    }
  }

  // 1. New high/critical findings → regression candidates
  for (const f of findingDiff.added) {
    if (f.severity === "high" || f.severity === "critical") {
      add(candidateForNewFinding(f, target, createdAt));
    }
  }

  // 2. New security findings (any severity)
  for (const f of findingDiff.added) {
    if (f.category.toLowerCase().includes("secret") || f.category.toLowerCase().includes("security")) {
      add(candidateForSecurityRegression(f, target, createdAt));
    }
  }

  // 3. Overall score drop beyond threshold
  if (scoreDeltas.overall <= -SCORE_DROP_THRESHOLD) {
    add(candidateForScoreDrop("overall", scoreDeltas.overall, target, createdAt));
  }

  // 4. Category score drops beyond threshold
  const categoryDeltas: Array<[string, number]> = [
    ["architecture", scoreDeltas.architecture],
    ["security", scoreDeltas.security],
    ["evalCoverage", scoreDeltas.evalCoverage],
    ["promptQuality", scoreDeltas.promptQuality],
    ["toolGovernance", scoreDeltas.toolGovernance],
    ["documentation", scoreDeltas.documentation],
    ["maintainability", scoreDeltas.maintainability],
  ];
  for (const [dim, delta] of categoryDeltas) {
    if (delta <= -SCORE_DROP_THRESHOLD) {
      add(candidateForScoreDrop(dim, delta, target, createdAt));
    }
  }

  // 5. Eval coverage decrease
  if (scoreDeltas.evalCoverage <= -SCORE_DROP_THRESHOLD) {
    add(candidateForEvalCoverageDecrease(scoreDeltas.evalCoverage, target, createdAt));
  }

  // 6. Missing reportVersion
  if (!target.reportVersion || target.reportVersion.trim() === "") {
    add(candidateForMissingReportVersion(target, createdAt));
  }

  // 7. Missing golden fixtures (from maintainability findings)
  const hasMissingGoldenFixtureFinding = target.findings.some(
    (f) => f.title.toLowerCase().includes("golden") && f.title.toLowerCase().includes("fixture"),
  );
  if (hasMissingGoldenFixtureFinding) {
    add(candidateForMissingGoldenFixtures(target, createdAt));
  }

  // 8. Workflow count decreased
  if (detectedCountDeltas?.workflows && detectedCountDeltas.workflows < 0) {
    add(candidateForWorkflowMappingLoss(target, detectedCountDeltas.workflows, createdAt));
  }

  return candidates;
}

// ── Re-export for convenience ─────────────────────────────────────────────────

export type { FindingDiff, ScoreDeltas };
