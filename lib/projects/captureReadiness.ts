/**
 * Capture Quality Model & Replay Readiness Projection.
 *
 * Evaluates the diagnostic depth and reproducibility guarantees of a run or project.
 * Projects what replay mode is supported without overselling arbitrary agent replay.
 */

import type { RunArtifact } from "@/lib/core/contracts/runArtifact";
import { buildReplayPlan } from "@/lib/core/replay/planner";

export type ReadinessLevel = "COMPLETE" | "PARTIAL" | "ABSENT" | "NOT_APPLICABLE";

export interface ReadinessDimension {
  name: string;
  category:
    | "RUN_LIFECYCLE"
    | "MODEL"
    | "TOOLS"
    | "RETRIEVAL"
    | "MEMORY"
    | "CONTEXT"
    | "STATE"
    | "CHECKPOINTS"
    | "CONFIGURATION"
    | "EVIDENCE"
    | "EVALS";
  level: ReadinessLevel;
  details: string;
  score: number; // 0-10
}

export type ReplayModeProjection =
  | "DETERMINISTIC_MOCK"
  | "EXACT_CHECKPOINT_RESUME"
  | "LIVE_FORK"
  | "PARTIAL"
  | "UNSUPPORTED";

export interface ReplayReadinessProjection {
  projectedMode: ReplayModeProjection;
  isFullyReplayable: boolean;
  canForkFromCheckpoint: boolean;
  hasStateSnapshots: boolean;
  missingRequirements: string[];
  explanation: string;
}

export interface CaptureReadinessReport {
  runId?: string;
  projectId?: string;
  overallScore: number; // 0 - 100
  rating: "OPTIMAL" | "ACTIONABLE" | "BASIC" | "INSUFFICIENT";
  dimensions: ReadinessDimension[];
  replayProjection: ReplayReadinessProjection;
  recommendations: string[];
}

/**
 * Computes capture quality and replay projection for a RunArtifact.
 */
export async function computeCaptureReadiness(
  run?: RunArtifact | null
): Promise<CaptureReadinessReport> {
  const dimensions: ReadinessDimension[] = [];

  if (!run) {
    return {
      overallScore: 0,
      rating: "INSUFFICIENT",
      dimensions: [],
      replayProjection: {
        projectedMode: "UNSUPPORTED",
        isFullyReplayable: false,
        canForkFromCheckpoint: false,
        hasStateSnapshots: false,
        missingRequirements: ["No run evidence provided."],
        explanation: "No run data available to evaluate capture quality.",
      },
      recommendations: ["Instrument your agent using the AgentPulse SDK to emit execution events."],
    };
  }

  // 1. RUN_LIFECYCLE
  const hasStart = Boolean(run.execution?.started_at);
  const hasEnd = Boolean(run.execution?.completed_at);
  const hasStatus = Boolean(run.execution?.status);

  if (hasStart && hasEnd && hasStatus) {
    dimensions.push({
      name: "Run Lifecycle",
      category: "RUN_LIFECYCLE",
      level: "COMPLETE",
      details: `Complete lifecycle (started, completed in ${run.execution.duration_ms ?? 0}ms with status '${run.execution.status}')`,
      score: 10,
    });
  } else if (hasStart || hasStatus) {
    dimensions.push({
      name: "Run Lifecycle",
      category: "RUN_LIFECYCLE",
      level: "PARTIAL",
      details: "Incomplete lifecycle: missing started_at or completed_at timestamp.",
      score: 5,
    });
  } else {
    dimensions.push({
      name: "Run Lifecycle",
      category: "RUN_LIFECYCLE",
      level: "ABSENT",
      details: "No lifecycle timestamps recorded.",
      score: 0,
    });
  }

  // 2. MODEL Evidence
  const legacyRun = run as unknown as {
    model_calls?: Array<{ prompt_tokens?: number; total_tokens?: number }>;
  };
  const obs = run.observability as Record<string, unknown> | undefined;
  const modelCalls =
    run.models && run.models.length > 0
      ? run.models
      : legacyRun.model_calls && legacyRun.model_calls.length > 0
      ? legacyRun.model_calls
      : run.trajectory?.filter((t) => t.step_type === "model_call") ?? [];
  const hasModelTokens =
    (run.observability?.total_tokens ?? 0) > 0 ||
    ((obs?.input_tokens as number) ?? 0) > 0 ||
    ((obs?.output_tokens as number) ?? 0) > 0 ||
    (run.models?.some((m) => (m.total_tokens ?? 0) > 0) ?? false) ||
    (legacyRun.model_calls?.some(
      (m) => (m.total_tokens ?? 0) > 0 || (m.prompt_tokens ?? 0) > 0
    ) ?? false);
  if (modelCalls.length > 0 && hasModelTokens) {
    dimensions.push({
      name: "Model Evidence",
      category: "MODEL",
      level: "COMPLETE",
      details: `${modelCalls.length} model invocations captured with token counts and latencies.`,
      score: 10,
    });
  } else if (modelCalls.length > 0) {
    dimensions.push({
      name: "Model Evidence",
      category: "MODEL",
      level: "PARTIAL",
      details: `${modelCalls.length} model invocations captured without detailed token counts.`,
      score: 6,
    });
  } else {
    dimensions.push({
      name: "Model Evidence",
      category: "MODEL",
      level: "ABSENT",
      details: "No model calls captured in run trajectory.",
      score: 0,
    });
  }

  // 3. TOOLS Evidence
  const toolSteps = run.trajectory?.filter((t) => t.step_type === "tool_call") ?? [];
  const toolInvocations = run.tools ?? (run as unknown as { tool_invocations?: unknown[] }).tool_invocations ?? [];
  if (toolInvocations.length > 0) {
    dimensions.push({
      name: "Tool Invocations",
      category: "TOOLS",
      level: "COMPLETE",
      details: `${toolInvocations.length} tool calls captured with parameters and outputs.`,
      score: 10,
    });
  } else if (toolSteps.length > 0) {
    dimensions.push({
      name: "Tool Invocations",
      category: "TOOLS",
      level: "PARTIAL",
      details: `${toolSteps.length} tool steps present but lacking full payload detail.`,
      score: 6,
    });
  } else {
    dimensions.push({
      name: "Tool Invocations",
      category: "TOOLS",
      level: "NOT_APPLICABLE",
      details: "Agent trajectory did not execute external tools.",
      score: 0,
    });
  }

  // 4. RETRIEVAL Evidence
  const retrievalOps = run.retrieval ?? (run as unknown as { retrieval_operations?: unknown[] }).retrieval_operations ?? [];
  if (retrievalOps.length > 0) {
    dimensions.push({
      name: "Retrieval Context",
      category: "RETRIEVAL",
      level: "COMPLETE",
      details: `${retrievalOps.length} retrieval queries and document chunks captured.`,
      score: 10,
    });
  } else {
    dimensions.push({
      name: "Retrieval Context",
      category: "RETRIEVAL",
      level: "NOT_APPLICABLE",
      details: "No vector search or document retrieval in this execution.",
      score: 0,
    });
  }

  // 5. MEMORY / STATE & CHECKPOINTS
  const checkpoints = run.checkpoints ?? (run as unknown as { state_checkpoints?: unknown[] }).state_checkpoints ?? [];
  if (checkpoints.length > 0) {
    dimensions.push({
      name: "State & Checkpoints",
      category: "STATE",
      level: "COMPLETE",
      details: `${checkpoints.length} execution state checkpoints captured with state hashes.`,
      score: 10,
    });
  } else {
    dimensions.push({
      name: "State & Checkpoints",
      category: "STATE",
      level: "ABSENT",
      details: "No state checkpoints recorded. Safe forking requires state snapshots.",
      score: 0,
    });
  }

  // 6. CONFIGURATION Evidence
  const config = run.configuration_snapshot;
  if (config && config.config_hash) {
    dimensions.push({
      name: "Configuration & Prompts",
      category: "CONFIGURATION",
      level: "COMPLETE",
      details: `Declared effective configuration captured (hash: ${config.config_hash.slice(0, 12)}...).`,
      score: 10,
    });
  } else {
    dimensions.push({
      name: "Configuration & Prompts",
      category: "CONFIGURATION",
      level: "ABSENT",
      details: "Configuration snapshot absent.",
      score: 0,
    });
  }

  // 7. EVALS Evidence
  const evals = run.evals ?? (run as unknown as { eval_results?: unknown[] }).eval_results ?? [];
  if (evals.length > 0) {
    dimensions.push({
      name: "Evaluation Assertions",
      category: "EVALS",
      level: "COMPLETE",
      details: `${evals.length} eval checks executed on run output.`,
      score: 10,
    });
  } else {
    dimensions.push({
      name: "Evaluation Assertions",
      category: "EVALS",
      level: "ABSENT",
      details: "No automated eval assertions recorded.",
      score: 0,
    });
  }

  // Total score calculation (sum / max, excluding NOT_APPLICABLE dimensions from denominator)
  const applicableDimensions = dimensions.filter((d) => d.level !== "NOT_APPLICABLE");
  const totalScorePossible = applicableDimensions.length * 10;
  const actualScoreSum = applicableDimensions.reduce((acc, d) => acc + d.score, 0);
  const overallScore = Math.round((actualScoreSum / (totalScorePossible || 1)) * 100);

  let rating: CaptureReadinessReport["rating"] = "OPTIMAL";
  if (overallScore < 50) rating = "INSUFFICIENT";
  else if (overallScore < 75) rating = "BASIC";
  else if (overallScore < 90) rating = "ACTIONABLE";

  // Replay Readiness Projection leveraging ReplayPlanner
  let replayProjection: ReplayReadinessProjection;
  try {
    const plan = await buildReplayPlan(run, { verifyBlobs: false });
    const canFork = (run.checkpoints?.length ?? 0) > 0 || ((run as unknown as { state_checkpoints?: unknown[] }).state_checkpoints?.length ?? 0) > 0;

    if (plan.replayability_verdict === "REPLAYABLE") {
      replayProjection = {
        projectedMode: "DETERMINISTIC_MOCK",
        isFullyReplayable: true,
        canForkFromCheckpoint: canFork,
        hasStateSnapshots: canFork,
        missingRequirements: [],
        explanation: "Run contains complete boundaries and snapshots. Deterministic offline replay is fully supported.",
      };
    } else if (canFork) {
      replayProjection = {
        projectedMode: "LIVE_FORK",
        isFullyReplayable: false,
        canForkFromCheckpoint: true,
        hasStateSnapshots: true,
        missingRequirements: [...plan.missing_evidence, ...plan.unsupported_features],
        explanation: "Full deterministic replay is missing some boundary payloads, but checkpoint state allows live branching and forking.",
      };
    } else {
      replayProjection = {
        projectedMode: plan.replayability_verdict === "PARTIALLY_REPLAYABLE" ? "PARTIAL" : "UNSUPPORTED",
        isFullyReplayable: false,
        canForkFromCheckpoint: false,
        hasStateSnapshots: false,
        missingRequirements: [...plan.missing_evidence, ...plan.unsupported_features],
        explanation: "Some execution boundaries captured, but missing state checkpoints prevents checkpoint resumption.",
      };
    }
  } catch {
    const hasCheckpoints = (run.checkpoints?.length ?? 0) > 0 || ((run as unknown as { state_checkpoints?: unknown[] }).state_checkpoints?.length ?? 0) > 0;
    replayProjection = {
      projectedMode: hasCheckpoints ? "EXACT_CHECKPOINT_RESUME" : "UNSUPPORTED",
      isFullyReplayable: false,
      canForkFromCheckpoint: hasCheckpoints,
      hasStateSnapshots: hasCheckpoints,
      missingRequirements: ["Artifact missing boundary manifests required for replay planning."],
      explanation: "Unable to plan replay for this run structure.",
    };
  }

  const recommendations: string[] = [];
  if (dimensions.some((d) => d.category === "STATE" && d.level === "ABSENT")) {
    recommendations.push("Capture agent memory or state checkpoints before and after tool calls to enable Fork & Replay.");
  }
  if (dimensions.some((d) => d.category === "CONFIGURATION" && d.level === "ABSENT")) {
    recommendations.push("Capture system prompts and model hyperparameters to track prompt drift and configuration regressions.");
  }
  if (dimensions.some((d) => d.category === "EVALS" && d.level === "ABSENT")) {
    recommendations.push("Attach evaluation assertions (schema validity, output quality) to automate regression gates.");
  }

  return {
    runId: run.identity?.run_id,
    projectId: run.identity?.project_id,
    overallScore,
    rating,
    dimensions,
    replayProjection,
    recommendations,
  };
}
