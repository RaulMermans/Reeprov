/**
 * Replay Performance Benchmarking.
 *
 * Measures:
 * - ReplayPlan creation duration
 * - Full replay runtime duration vs original execution
 * - Boundary substitution average latency
 * - Content blob resolution latency
 * - State restoration latency
 * - Storage overhead
 */

import type { RunArtifact } from "../contracts/runArtifact";
import { buildReplayPlan } from "./planner";
import { StateRestorer } from "./stateRestorer";
import { BoundaryResolver } from "./resolver";
import { getContentStore } from "../capture/contentStore";
import { type ReplayResult } from "./contracts";

export interface ReplayBenchmarkMetrics {
  replayPlanDurationMs: number;
  stateRestorationDurationMs: number;
  boundarySubstitutionAvgLatencyMs: number;
  blobResolutionLatencyMs: number;
  fullReplayDurationMs: number;
  originalExecutionDurationMs: number;
  speedupMultiplier: number;
  storageOverheadBytes: number;
}

export async function measureReplayPerformance(
  artifact: RunArtifact,
  replayResult: ReplayResult
): Promise<ReplayBenchmarkMetrics> {
  const perf = typeof performance !== "undefined" ? performance : { now: () => Date.now() };

  // 1. Measure ReplayPlan creation time
  const t0 = perf.now();
  await buildReplayPlan(artifact, { verifyBlobs: true });
  const replayPlanDurationMs = Math.round((perf.now() - t0) * 100) / 100;

  // 2. Measure State Restoration time
  const t1 = perf.now();
  const restorer = new StateRestorer(artifact);
  restorer.restoreInitialState();
  const stateRestorationDurationMs = Math.round((perf.now() - t1) * 100) / 100;

  // 3. Measure Boundary Substitution latency
  const resolver = new BoundaryResolver(artifact);
  const boundaryLatencies: number[] = [];
  for (let i = 0; i < (artifact.boundaries ?? []).length; i++) {
    const b = artifact.boundaries[i];
    const tb0 = perf.now();
    await resolver.resolve({
      expectedType: b.boundary_type,
      name: b.name,
      dependencyIdentity: b.dependency_identity,
      input: b.input.content ?? {},
    });
    boundaryLatencies.push(perf.now() - tb0);
  }
  const avgBoundaryLatency =
    boundaryLatencies.length > 0
      ? boundaryLatencies.reduce((a, b) => a + b, 0) / boundaryLatencies.length
      : 0;

  // 4. Measure Blob resolution latency
  let blobResolutionLatencyMs = 0;
  const contentStore = getContentStore();
  const ref = artifact.boundaries?.find((b) => b.output?.content_ref)?.output?.content_ref;
  if (ref) {
    const tr0 = perf.now();
    await contentStore.get(ref);
    blobResolutionLatencyMs = Math.round((perf.now() - tr0) * 100) / 100;
  }

  // 5. Total replay vs original duration
  const fullReplayDurationMs = Math.max(
    0.1,
    new Date(replayResult.completed_at).getTime() - new Date(replayResult.started_at).getTime()
  );
  const originalExecutionDurationMs = Math.max(0.1, artifact.execution.duration_ms ?? 10);
  const speedupMultiplier =
    Math.round((originalExecutionDurationMs / fullReplayDurationMs) * 10) / 10;

  // 6. Storage overhead
  const serialized = JSON.stringify(replayResult);
  const storageOverheadBytes = Buffer.byteLength(serialized, "utf8");

  return {
    replayPlanDurationMs,
    stateRestorationDurationMs,
    boundarySubstitutionAvgLatencyMs: Math.round(avgBoundaryLatency * 100) / 100,
    blobResolutionLatencyMs,
    fullReplayDurationMs,
    originalExecutionDurationMs,
    speedupMultiplier,
    storageOverheadBytes,
  };
}
