/**
 * Run Alignment Engine.
 *
 * Deterministically aligns execution steps and boundaries across runs.
 * Uses a strict fallback hierarchy:
 * 1. Shared lineage prefix / stable IDs
 * 2. Explicit node/workflow IDs in sequence
 * 3. Step names + relative order
 * 4. Boundary identities
 * 5. Sequence alignment heuristic (with explicit AMBIGUOUS status for close ties)
 *
 * Does NOT use an LLM for basic alignment.
 */

import type { RunArtifact } from "../contracts/runArtifact";
import type { ExecutionStep } from "../contracts/execution";
import type { ExecutionBoundary } from "../contracts/replay";
import type {
  AlignedStep,
  AlignedBoundary,
  ComparisonAlignment,
  AlignmentStatus,
  BoundaryChangeType,
} from "../contracts/comparison";
import {
  materializeComparableRuns,
  materializeComparisonViews,
  type MaterializedComparableStep,
} from "./lineageMaterializer";
import { canonicalJsonStringify } from "../capture/hashing";

export interface RunAlignmentOptions {
  similarityThreshold?: number; // default 0.7
  ambiguityDelta?: number;       // default 0.1
}

function computeStepSimilarity(a: ExecutionStep, b: ExecutionStep): number {
  let score = 0;
  let weights = 0;

  // Name equality
  weights += 3;
  if (a.name === b.name) score += 3;

  // Node ID equality
  weights += 3;
  if (a.node_id && b.node_id && a.node_id === b.node_id) score += 3;

  // Type / status equality
  weights += 1;
  if (a.status === b.status) score += 1;
  weights += 1;
  if (a.step_type === b.step_type) score += 1;

  // Input summary equality
  weights += 2;
  if (a.input_summary && b.input_summary && a.input_summary === b.input_summary) score += 2;

  // Output summary equality
  weights += 2;
  if (a.output_summary && b.output_summary && a.output_summary === b.output_summary) score += 2;

  return weights > 0 ? score / weights : 0;
}

export function alignSteps(
  baselineSteps: MaterializedComparableStep[],
  candidateSteps: MaterializedComparableStep[],
  options: RunAlignmentOptions = {}
): AlignedStep[] {
  const threshold = options.similarityThreshold ?? 0.7;
  const ambiguityDelta = options.ambiguityDelta ?? 0.1;

  const aligned: AlignedStep[] = [];
  const matchedCandIndices = new Set<number>();
  let logicalIndex = 0;

  for (let bIdx = 0; bIdx < baselineSteps.length; bIdx++) {
    const b = baselineSteps[bIdx];

    // 1. Shared lineage / stable ID match (identical step_id)
    let candidateMatchIdx = candidateSteps.findIndex(
      (c, cIdx) => !matchedCandIndices.has(cIdx) && c.step_id === b.step_id
    );
    let matchBasis = "LINEAGE_STABLE_ID";
    let confidence = 1.0;
    let isAmbiguous = false;

    // 2. Explicit node_id match
    if (candidateMatchIdx === -1 && b.node_id) {
      const candidates = candidateSteps
        .map((c, idx) => ({ c, idx }))
        .filter(({ c, idx }) => !matchedCandIndices.has(idx) && c.node_id === b.node_id);

      if (candidates.length === 1) {
        candidateMatchIdx = candidates[0].idx;
        matchBasis = "NODE_ID_MATCH";
        confidence = 0.95;
      } else if (candidates.length > 1) {
        candidateMatchIdx = candidates[0].idx;
        matchBasis = "NODE_ID_MATCH";
        confidence = 0.85;
      }
    }

    // 3. Step name + relative order match
    if (candidateMatchIdx === -1) {
      const candidates = candidateSteps
        .map((c, idx) => ({ c, idx }))
        .filter(({ c, idx }) => !matchedCandIndices.has(idx) && c.name === b.name);

      if (candidates.length === 1) {
        candidateMatchIdx = candidates[0].idx;
        matchBasis = "STEP_NAME_MATCH";
        confidence = 0.85;
      } else if (candidates.length > 1) {
        candidateMatchIdx = candidates[0].idx;
        matchBasis = "STEP_NAME_MATCH";
        confidence = 0.6;
        isAmbiguous = true;
      }
    }

    // 4. Sequence alignment heuristic (similarity matching)
    if (candidateMatchIdx === -1) {
      const scored = candidateSteps
        .map((c, idx) => ({ c, idx, sim: computeStepSimilarity(b, c) }))
        .filter(({ idx, sim }) => !matchedCandIndices.has(idx) && sim >= threshold)
        .sort((x, y) => y.sim - x.sim);

      if (scored.length > 0) {
        const top = scored[0];
        if (scored.length > 1 && top.sim - scored[1].sim < ambiguityDelta) {
          candidateMatchIdx = top.idx;
          matchBasis = "SEQUENCE_ALIGNMENT_HEURISTIC";
          confidence = 0.55;
          isAmbiguous = true;
        } else {
          candidateMatchIdx = top.idx;
          matchBasis = "SEQUENCE_ALIGNMENT_HEURISTIC";
          confidence = Math.round(top.sim * 100) / 100;
        }
      }
    }

    if (candidateMatchIdx !== -1) {
      matchedCandIndices.add(candidateMatchIdx);
      const c = candidateSteps[candidateMatchIdx];

      const diffs: string[] = [];
      if (b.name !== c.name) diffs.push(`name: "${b.name}" → "${c.name}"`);
      if (b.status !== c.status) diffs.push(`status: ${b.status} → ${c.status}`);
      if (b.input_summary !== c.input_summary && (b.input_summary || c.input_summary)) {
        diffs.push("input_summary_changed");
      }
      if (b.output_summary !== c.output_summary && (b.output_summary || c.output_summary)) {
        diffs.push("output_summary_changed");
      }

      let status: AlignmentStatus = "MATCHED";
      if (isAmbiguous) {
        status = "AMBIGUOUS";
      } else if (diffs.length > 0) {
        status = "MODIFIED";
      }

      const durDelta = typeof b.duration_ms === "number" && typeof c.duration_ms === "number"
        ? c.duration_ms - b.duration_ms
        : undefined;

      aligned.push({
        logical_index: logicalIndex++,
        baseline_step_id: b.step_id,
        candidate_step_id: c.step_id,
        name: b.name === c.name ? b.name : `${b.name} / ${c.name}`,
        alignment_status: status,
        alignment_confidence: confidence,
        alignment_basis: matchBasis,
        segment_type: b.segment_type === "HISTORICAL_SHARED" ? "HISTORICAL_SHARED" : "BASELINE_ONLY",
        differences: diffs,
        duration_delta_ms: durDelta,
      });
    } else {
      aligned.push({
        logical_index: logicalIndex++,
        baseline_step_id: b.step_id,
        name: b.name,
        alignment_status: "BASELINE_ONLY",
        alignment_confidence: 1.0,
        alignment_basis: "EXCLUDED_IN_CANDIDATE",
        segment_type: b.segment_type,
        differences: ["Step executed in baseline only"],
      });
    }
  }

  // Any remaining candidate steps are CANDIDATE_ONLY
  for (let cIdx = 0; cIdx < candidateSteps.length; cIdx++) {
    if (!matchedCandIndices.has(cIdx)) {
      const c = candidateSteps[cIdx];
      aligned.push({
        logical_index: logicalIndex++,
        candidate_step_id: c.step_id,
        name: c.name,
        alignment_status: "CANDIDATE_ONLY",
        alignment_confidence: 1.0,
        alignment_basis: "NEW_IN_CANDIDATE",
        segment_type: c.segment_type === "FORK_EXECUTION" ? "FORK_EXECUTION" : "CANDIDATE_ONLY",
        differences: ["Step executed in candidate only"],
      });
    }
  }

  return aligned;
}

export function alignBoundaries(
  baseBoundaries: ExecutionBoundary[] = [],
  candBoundaries: ExecutionBoundary[] = []
): AlignedBoundary[] {
  const aligned: AlignedBoundary[] = [];
  const candMatched = new Set<number>();

  for (let bIdx = 0; bIdx < baseBoundaries.length; bIdx++) {
    const b = baseBoundaries[bIdx];

    // Try matching by boundary_id, then type + name
    let cIdx = candBoundaries.findIndex(
      (c, idx) => !candMatched.has(idx) && c.boundary_id === b.boundary_id
    );

    if (cIdx === -1) {
      cIdx = candBoundaries.findIndex(
        (c, idx) => !candMatched.has(idx) && c.boundary_type === b.boundary_type && c.name === b.name
      );
    }

    if (cIdx !== -1) {
      candMatched.add(cIdx);
      const c = candBoundaries[cIdx];

      const diffs: string[] = [];
      let changeType: BoundaryChangeType = "MATCHED";

      const bInputHash = b.input?.hash ?? canonicalJsonStringify(b.input?.content);
      const cInputHash = c.input?.hash ?? canonicalJsonStringify(c.input?.content);
      const bOutputHash = b.output?.hash ?? canonicalJsonStringify(b.output?.content);
      const cOutputHash = c.output?.hash ?? canonicalJsonStringify(c.output?.content);

      if (b.boundary_type !== c.boundary_type) {
        diffs.push(`type: ${b.boundary_type} -> ${c.boundary_type}`);
        if (changeType === "MATCHED") changeType = "BOUNDARY_TYPE_CHANGED";
      }
      if (bInputHash !== cInputHash) {
        diffs.push("input_changed");
        if (changeType === "MATCHED") changeType = "BOUNDARY_INPUT_CHANGED";
      }
      if (bOutputHash !== cOutputHash) {
        diffs.push("output_changed");
        if (changeType === "MATCHED") changeType = "BOUNDARY_OUTPUT_CHANGED";
      }
      const bSideEffect = String(b.side_effect_class ?? "").toUpperCase();
      const cSideEffect = String(c.side_effect_class ?? "").toUpperCase();
      if (bSideEffect !== cSideEffect) {
        diffs.push(`side_effect_class: ${bSideEffect} -> ${cSideEffect}`);
        if (changeType === "MATCHED") changeType = "SIDE_EFFECT_CLASS_CHANGED";
      }
      if (b.replayability !== c.replayability) {
        diffs.push(`replayability: ${b.replayability} -> ${c.replayability}`);
        if (changeType === "MATCHED") changeType = "REPLAYABILITY_CHANGED";
      }
      if (bIdx !== cIdx) {
        diffs.push(`reordered: pos ${bIdx} -> pos ${cIdx}`);
        if (changeType === "MATCHED") changeType = "BOUNDARY_REORDERED";
      }

      aligned.push({
        boundary_id: b.boundary_id,
        candidate_boundary_id: c.boundary_id,
        boundary_type: b.boundary_type,
        name: b.name,
        alignment_status: diffs.length > 0 ? "MODIFIED" : "MATCHED",
        change_type: changeType,
        differences: diffs,
      });
    } else {
      aligned.push({
        boundary_id: b.boundary_id,
        boundary_type: b.boundary_type,
        name: b.name,
        alignment_status: "BASELINE_ONLY",
        change_type: "BOUNDARY_REMOVED",
        differences: ["Boundary present in baseline only"],
      });
    }
  }

  for (let cIdx = 0; cIdx < candBoundaries.length; cIdx++) {
    if (!candMatched.has(cIdx)) {
      const c = candBoundaries[cIdx];
      aligned.push({
        candidate_boundary_id: c.boundary_id,
        boundary_type: c.boundary_type,
        name: c.name,
        alignment_status: "CANDIDATE_ONLY",
        change_type: "BOUNDARY_ADDED",
        differences: ["Boundary added in candidate"],
      });
    }
  }

  return aligned;
}

export function alignRuns(
  baseline: RunArtifact,
  candidate: RunArtifact,
  options: RunAlignmentOptions = {}
): ComparisonAlignment {
  const materialized = materializeComparableRuns(baseline, candidate);

  const alignedSteps = alignSteps(
    materialized.baseline_steps,
    materialized.candidate_steps,
    options
  );

  const alignedBoundaries = alignBoundaries(
    baseline.boundaries,
    candidate.boundaries
  );

  let matchedCount = 0;
  let modifiedCount = 0;
  let baselineOnlyCount = 0;
  let candidateOnlyCount = 0;
  let ambiguousCount = 0;

  for (const step of alignedSteps) {
    if (step.alignment_status === "MATCHED") matchedCount++;
    else if (step.alignment_status === "MODIFIED") modifiedCount++;
    else if (step.alignment_status === "BASELINE_ONLY") baselineOnlyCount++;
    else if (step.alignment_status === "CANDIDATE_ONLY") candidateOnlyCount++;
    else if (step.alignment_status === "AMBIGUOUS") ambiguousCount++;
  }

  const views = materializeComparisonViews(baseline, candidate);

  return {
    aligned_steps: alignedSteps,
    aligned_boundaries: alignedBoundaries,
    materialized_baseline: views.materializedBaseline,
    materialized_candidate: views.materializedCandidate,
    alignment_summary: {
      total_baseline_steps: baseline.trajectory.length,
      total_candidate_steps: candidate.trajectory.length,
      matched_count: matchedCount,
      modified_count: modifiedCount,
      baseline_only_count: baselineOnlyCount,
      candidate_only_count: candidateOnlyCount,
      ambiguous_count: ambiguousCount,
    },
  };
}
