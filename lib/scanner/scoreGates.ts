import type { RepositoryModeResult, ScoreCap, ScoreDimensions, Scores } from "./types";

// Structural context used to determine which score caps to apply.
export interface ScoreGateContext {
  hasAgentManifest: boolean;
  hasWorkflowManifest: boolean;
  hasEvals: boolean;
  hasWriteToolsWithoutApproval: boolean;
  hasModelMapping: boolean;
  hasGraphEdges: boolean;       // any manifest agent has at least one linked prompt/tool/eval
  allArtifactsAreExamples: boolean; // no production-context AI artifacts detected
  repositoryMode: RepositoryModeResult;
}

export interface ScoreGateResult {
  scores: Scores;
  capsApplied: ScoreCap[];
}

const SCORE_WEIGHTS = {
  architecture: 0.2,
  promptQuality: 0.2,
  toolGovernance: 0.2,
  evalCoverage: 0.15,
  security: 0.15,
  documentation: 0.1,
};

// Apply deterministic caps to the raw scores based on structural signals.
// Each cap is recorded with a reason so the UI and reports can surface it.
export function applyScoreGates(
  rawScores: Scores,
  context: ScoreGateContext,
): ScoreGateResult {
  const scores = { ...rawScores };
  const capsApplied: ScoreCap[] = [];

  function cap(
    dimension: keyof Omit<Scores, "overall">,
    value: number,
    reason: string,
    evidence: string[] = [],
  ) {
    // Always record the cap when the structural condition is met, even if finding-based
    // penalties already brought the score below the cap. This ensures the report always
    // surfaces WHY a score is constrained, not just when the cap changed a value.
    capsApplied.push({ dimension, cap: value, reason, evidence });
    if (scores[dimension] > value) {
      scores[dimension] = value;
    }
  }

  const mode = context.repositoryMode.mode;

  // Non-AI and framework/example repos: no meaningful AI system scoring.
  // We still let the legacy scores run so general hygiene shows up,
  // but cap AI-centric dimensions that would otherwise mislead.
  if (mode === "non_ai" || mode === "ai_framework_library" || mode === "example_template") {
    cap("architecture", 60,
      `Repository mode is "${mode}"; architecture is scored on example/library structure, not production AI system design.`);
    cap("evalCoverage", 60,
      `Repository mode is "${mode}"; eval coverage is not applicable in the same way as a deployed AI system.`);
    cap("toolGovernance", 60,
      `Repository mode is "${mode}"; tool governance applies to deployed systems, not libraries or example repos.`);
  } else {
    // AI application or unknown_ai: apply structural gates.

    // No explicit manifest (agent or workflow).
    if (!context.hasAgentManifest && !context.hasWorkflowManifest) {
      cap("architecture", 70,
        "No explicit agent or workflow manifest found. Manifest is required to exceed 70.");
    }

    // No dedicated AI eval suite.
    if (!context.hasEvals) {
      cap("evalCoverage", 60,
        "No dedicated AI eval suite detected. Eval coverage is capped at 60 until evals are added.");
    }

    // Write-like tools without approval policy.
    if (context.hasWriteToolsWithoutApproval) {
      cap("toolGovernance", 65,
        "Write-like or destructive tools detected without an approval or dry-run policy.");
    }

    // No model/provider mapping in any agent manifest.
    if (!context.hasModelMapping && context.hasAgentManifest) {
      cap("architecture", Math.min(scores.architecture, 75),
        "Agent manifest found but no model/provider mapping specified for any agent.");
    }

    // All AI artifacts (agents, tools, prompts) appear to be in example/sample directories.
    if (context.allArtifactsAreExamples && !context.hasAgentManifest && !context.hasWorkflowManifest) {
      cap("architecture", 65,
        "All detected AI artifacts appear to be in example/sample directories rather than production source code.");
      cap("toolGovernance", 65,
        "Tool governance is evaluated on sample/example code only — no production tool layer detected.");
    }
  }

  // Recompute overall from capped dimensions.
  scores.overall = Math.round(
    scores.architecture * SCORE_WEIGHTS.architecture +
    scores.promptQuality * SCORE_WEIGHTS.promptQuality +
    scores.toolGovernance * SCORE_WEIGHTS.toolGovernance +
    scores.evalCoverage * SCORE_WEIGHTS.evalCoverage +
    scores.security * SCORE_WEIGHTS.security +
    scores.documentation * SCORE_WEIGHTS.documentation,
  );

  return { scores, capsApplied };
}

// Compute new score dimensions on top of the capped legacy scores.
export function computeScoreDimensions(
  scores: Scores,
  context: ScoreGateContext,
  graphCompleteness: number,
): ScoreDimensions {
  const policy = context.repositoryMode.scoringPolicy;

  const aiSystemHealth = policy.aiSystemHealthApplicable
    ? computeAiSystemHealth(scores, context, graphCompleteness)
    : null;

  const governanceCompleteness = policy.governanceApplicable
    ? computeGovernanceCompleteness(scores, context)
    : null;

  // General hygiene: security + docs + basic structure — always applicable.
  const generalRepoHygiene = Math.round(
    scores.security * 0.4 +
    scores.documentation * 0.35 +
    scores.architecture * 0.25,
  );

  // Confidence: how certain we are about the scoring.
  const modeConf = context.repositoryMode.confidence;
  const hasManifest = context.hasAgentManifest || context.hasWorkflowManifest;
  const confidence: ScoreDimensions["confidence"] =
    modeConf === "high" && hasManifest ? "high" :
    modeConf === "high" || (modeConf === "medium" && hasManifest) ? "medium" :
    "low";

  return {
    aiSystemHealth,
    generalRepoHygiene,
    governanceCompleteness,
    graphMappingCompleteness: graphCompleteness,
    confidence,
    legacyOverallScore: scores.overall,
  };
}

// ── AI system health ───────────────────────────────────────────────────────────

function computeAiSystemHealth(
  scores: Scores,
  context: ScoreGateContext,
  graphCompleteness: number,
): number {
  const base = Math.round(
    scores.architecture * 0.25 +
    scores.promptQuality * 0.20 +
    scores.toolGovernance * 0.15 +
    scores.evalCoverage * 0.15 +
    scores.security * 0.15 +
    graphCompleteness * 0.10,
  );

  let result = base;

  // Hard gates: structural gaps impose a maximum on AI system health.
  if (!context.hasAgentManifest && !context.hasWorkflowManifest) {
    result = Math.min(result, 79); // No manifest → can't exceed 79
  }
  if (!context.hasEvals) {
    result = Math.min(result, 82); // No evals → can't exceed 82
  }
  if (!context.hasGraphEdges) {
    result = Math.min(result, 74); // No graph links → can't exceed 74
  }
  if (context.allArtifactsAreExamples) {
    result = Math.min(result, 70); // Example-only → can't exceed 70
  }

  return result;
}

// ── Governance completeness ────────────────────────────────────────────────────

function computeGovernanceCompleteness(
  scores: Scores,
  context: ScoreGateContext,
): number {
  let score = scores.toolGovernance;

  if (!context.hasAgentManifest && !context.hasWorkflowManifest) {
    score = Math.min(score, 60);
  }
  if (!context.hasGraphEdges) {
    score = Math.min(score, 50);
  }
  if (context.hasWriteToolsWithoutApproval) {
    score = Math.min(score, 65);
  }

  return Math.round(score);
}
