/**
 * Lineage-Aware Execution View Materializer for Run Comparison.
 *
 * Sibling forks and parent-child forks store only their newly executed suffixes.
 * This module reconstructs comparable execution views without mutating either RunArtifact.
 *
 * Each step is tagged with its lineage segment type:
 * - HISTORICAL_SHARED
 * - BASELINE_ONLY
 * - CANDIDATE_ONLY
 * - FORK_EXECUTION
 */

import type { RunArtifact } from "../contracts/runArtifact";
import type { ExecutionStep } from "../contracts/execution";
import type { RunRelationship, LineageSegmentType } from "../contracts/comparison";

export interface MaterializedComparableStep extends ExecutionStep {
  segment_type: LineageSegmentType;
  origin_run_id: string;
}

export interface MaterializedExecutionPair {
  relationship: RunRelationship;
  shared_prefix_step_ids: string[];
  baseline_steps: MaterializedComparableStep[];
  candidate_steps: MaterializedComparableStep[];
  fork_checkpoint_id?: string;
  fork_step_id?: string;
}

/**
 * Detects the relationship between two runs based on lineage metadata.
 */
export function detectRunRelationship(
  baseline: RunArtifact,
  candidate: RunArtifact
): RunRelationship {
  const baselineId = baseline.identity.run_id;
  const candidateId = candidate.identity.run_id;

  // 1. Parent-child relationship
  if (
    candidate.lineage?.parent_run_id === baselineId ||
    baseline.lineage?.parent_run_id === candidateId
  ) {
    return "PARENT_CHILD";
  }

  // 2. Replay source
  const candTopMeta = (candidate as any).metadata as Record<string, unknown> | undefined;
  const baseTopMeta = (baseline as any).metadata as Record<string, unknown> | undefined;
  const candProvenanceMeta = candidate.provenance?.metadata as Record<string, unknown> | undefined;
  const baseProvenanceMeta = baseline.provenance?.metadata as Record<string, unknown> | undefined;

  if (
    candTopMeta?.["replay_of_run_id"] === baselineId ||
    candTopMeta?.["replay_source_run_id"] === baselineId ||
    baseTopMeta?.["replay_of_run_id"] === candidateId ||
    baseTopMeta?.["replay_source_run_id"] === candidateId ||
    candProvenanceMeta?.["replay_of_run_id"] === baselineId ||
    candProvenanceMeta?.["replay_source_run_id"] === baselineId ||
    baseProvenanceMeta?.["replay_of_run_id"] === candidateId ||
    baseProvenanceMeta?.["replay_source_run_id"] === candidateId ||
    (candidate.replay?.notes ?? []).some((n) => n.includes(baselineId)) ||
    (baseline.replay?.notes ?? []).some((n) => n.includes(candidateId))
  ) {
    return "REPLAY_SOURCE";
  }

  // 3. Sibling forks (same parent or root)
  const baseParent = baseline.lineage?.parent_run_id;
  const candParent = candidate.lineage?.parent_run_id;
  if (baseParent && candParent && baseParent === candParent && baselineId !== candidateId) {
    return "SIBLING_FORKS";
  }

  const baseRoot = baseline.lineage?.root_run_id;
  const candRoot = candidate.lineage?.root_run_id;
  if (baseRoot && candRoot && baseRoot === candRoot && baselineId !== candidateId) {
    return "SIBLING_FORKS";
  }

  // 4. Same experiment
  const baseExp = baseline.lineage?.experiment_id;
  const candExp = candidate.lineage?.experiment_id;
  if (baseExp && candExp && baseExp === candExp) {
    return "SAME_EXPERIMENT";
  }

  // 5. Independent runs
  if (baseline.identity.project_id && candidate.identity.project_id) {
    return "INDEPENDENT";
  }

  return "UNKNOWN";
}

/**
 * Materializes comparable execution views for baseline and candidate runs.
 * Does not mutate either RunArtifact.
 */
export function materializeComparableRuns(
  baseline: RunArtifact,
  candidate: RunArtifact
): MaterializedExecutionPair {
  const relationship = detectRunRelationship(baseline, candidate);
  const baselineId = baseline.identity.run_id;
  const candidateId = candidate.identity.run_id;

  // Case A: Candidate is a child fork of baseline
  if (candidate.lineage?.parent_run_id === baselineId) {
    const candLineage = candidate.lineage as any;
    const forkCheckpointId = candLineage?.fork_checkpoint_id ?? candLineage?.fork_checkpoint?.checkpoint_id;
    const forkStepId = candLineage?.fork_step_id ?? candLineage?.fork_checkpoint?.step_id;
    const checkpoint = baseline.checkpoints?.find((c) => c.checkpoint_id === forkCheckpointId);

    const sharedStepIds: string[] = [];
    const baselineSteps: MaterializedComparableStep[] = [];
    const candidateSteps: MaterializedComparableStep[] = [];

    let forkReached = false;
    for (const step of baseline.trajectory) {
      const isForkPoint =
        step.step_id === forkStepId ||
        (checkpoint && step.step_id === checkpoint.step_id);

      if (!forkReached) {
        sharedStepIds.push(step.step_id);
        baselineSteps.push({
          ...step,
          segment_type: "HISTORICAL_SHARED",
          origin_run_id: baselineId,
        });
        candidateSteps.push({
          ...step,
          segment_type: "HISTORICAL_SHARED",
          origin_run_id: baselineId,
        });

        if (isForkPoint) {
          forkReached = true;
        }
      } else {
        // Step was executed in baseline after the fork point
        baselineSteps.push({
          ...step,
          segment_type: "BASELINE_ONLY",
          origin_run_id: baselineId,
        });
      }
    }

    // Append child's newly executed fork suffix
    for (const step of candidate.trajectory) {
      candidateSteps.push({
        ...step,
        segment_type: "FORK_EXECUTION",
        origin_run_id: candidateId,
      });
    }

    return {
      relationship,
      shared_prefix_step_ids: sharedStepIds,
      baseline_steps: baselineSteps,
      candidate_steps: candidateSteps,
      fork_checkpoint_id: forkCheckpointId,
      fork_step_id: forkStepId ?? checkpoint?.step_id,
    };
  }

  // Case B: Baseline is a child fork of candidate (reverse direction)
  if (baseline.lineage?.parent_run_id === candidateId) {
    const baseLineage = baseline.lineage as any;
    const forkCheckpointId = baseLineage?.fork_checkpoint_id ?? baseLineage?.fork_checkpoint?.checkpoint_id;
    const forkStepId = baseLineage?.fork_step_id ?? baseLineage?.fork_checkpoint?.step_id;
    const checkpoint = candidate.checkpoints?.find((c) => c.checkpoint_id === forkCheckpointId);

    const sharedStepIds: string[] = [];
    const candidateSteps: MaterializedComparableStep[] = [];
    const baselineSteps: MaterializedComparableStep[] = [];

    let forkReached = false;
    for (const step of candidate.trajectory) {
      const isForkPoint =
        step.step_id === forkStepId ||
        (checkpoint && step.step_id === checkpoint.step_id);

      if (!forkReached) {
        sharedStepIds.push(step.step_id);
        candidateSteps.push({
          ...step,
          segment_type: "HISTORICAL_SHARED",
          origin_run_id: candidateId,
        });
        baselineSteps.push({
          ...step,
          segment_type: "HISTORICAL_SHARED",
          origin_run_id: candidateId,
        });

        if (isForkPoint) {
          forkReached = true;
        }
      } else {
        candidateSteps.push({
          ...step,
          segment_type: "CANDIDATE_ONLY",
          origin_run_id: candidateId,
        });
      }
    }

    for (const step of baseline.trajectory) {
      baselineSteps.push({
        ...step,
        segment_type: "FORK_EXECUTION",
        origin_run_id: baselineId,
      });
    }

    return {
      relationship,
      shared_prefix_step_ids: sharedStepIds,
      baseline_steps: baselineSteps,
      candidate_steps: candidateSteps,
      fork_checkpoint_id: forkCheckpointId,
      fork_step_id: forkStepId ?? checkpoint?.step_id,
    };
  }

  // Case C: Independent runs or sibling runs without local parent materialization
  return {
    relationship,
    shared_prefix_step_ids: [],
    baseline_steps: baseline.trajectory.map((s) => ({
      ...s,
      segment_type: "BASELINE_ONLY",
      origin_run_id: baselineId,
    })),
    candidate_steps: candidate.trajectory.map((s) => ({
      ...s,
      segment_type: "CANDIDATE_ONLY",
      origin_run_id: candidateId,
    })),
  };
}

export interface ComparisonExecutionSegment {
  segment_type: LineageSegmentType;
  source_run_id: string;
  steps: MaterializedComparableStep[];
}

export interface MaterializedExecutionView {
  run_id: string;
  segments: ComparisonExecutionSegment[];
  total_steps: number;
}

export interface MaterializedComparisonViews {
  relationship: RunRelationship;
  materializedBaseline: MaterializedExecutionView;
  materializedCandidate: MaterializedExecutionView;
  shared_prefix_step_ids: string[];
}

/**
 * High-level comparison view materializer partitioning steps into lineage-tagged segments.
 */
export function materializeComparisonViews(
  baseline: RunArtifact,
  candidate: RunArtifact
): MaterializedComparisonViews {
  const pair = materializeComparableRuns(baseline, candidate);

  function groupSegments(steps: MaterializedComparableStep[], defaultRunId: string): ComparisonExecutionSegment[] {
    if (steps.length === 0) {
      return [{ segment_type: "HISTORICAL_SHARED", source_run_id: defaultRunId, steps: [] }];
    }
    const segments: ComparisonExecutionSegment[] = [];
    let currentSegment: ComparisonExecutionSegment | null = null;

    for (const step of steps) {
      if (!currentSegment || currentSegment.segment_type !== step.segment_type) {
        if (currentSegment) {
          segments.push(currentSegment);
        }
        currentSegment = {
          segment_type: step.segment_type,
          source_run_id: step.origin_run_id ?? defaultRunId,
          steps: [step],
        };
      } else {
        currentSegment.steps.push(step);
      }
    }
    if (currentSegment) {
      segments.push(currentSegment);
    }
    return segments;
  }

  const baseSegments = groupSegments(pair.baseline_steps, baseline.identity.run_id);
  const candSegments = groupSegments(pair.candidate_steps, candidate.identity.run_id);

  return {
    relationship: pair.relationship,
    shared_prefix_step_ids: pair.shared_prefix_step_ids,
    materializedBaseline: {
      run_id: baseline.identity.run_id,
      segments: baseSegments,
      total_steps: pair.baseline_steps.length,
    },
    materializedCandidate: {
      run_id: candidate.identity.run_id,
      segments: candSegments,
      total_steps: pair.candidate_steps.length,
    },
  };
}
