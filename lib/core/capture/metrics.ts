/**
 * AgentPulse Capture Internal Observability Metrics.
 *
 * Tracks telemetry volume, boundary counts, redaction frequency, and capture overhead.
 * Invariant: Never log raw payloads in metrics.
 */

import type { ReplayabilityClass, SideEffectClass } from "../contracts/replay";
import type { CaptureMetricsSnapshot } from "./types";

export class CaptureMetricsCollector {
  private captureSuccessCount = 0;
  private captureFailureCount = 0;
  private boundaryCount = 0;
  private bytesCaptured = 0;
  private bytesPersisted = 0;
  private redactionCount = 0;
  private truncationCount = 0;
  private persistenceLatencyMsTotal = 0;
  private persistenceOpsCount = 0;
  private unsupportedBoundaryCount = 0;
  private replayabilityDistribution: Record<ReplayabilityClass, number> = {
    REPLAYABLE_RECORDED: 0,
    REPLAYABLE_DETERMINISTIC: 0,
    REPLAYABLE_SANDBOXED: 0,
    LIVE_REQUIRED: 0,
    SIDE_EFFECT_GATED: 0,
    NON_REPLAYABLE: 0,
    UNKNOWN: 0,
  };
  private sideEffectDistribution: Record<SideEffectClass, number> = {
    read_only: 0,
    write_draft: 0,
    external_side_effect: 0,
    sensitive_data: 0,
    destructive: 0,
  };

  recordBoundary(
    replayability: ReplayabilityClass,
    sideEffect: SideEffectClass,
    bytesIn: number,
    bytesStored: number,
    didRedact: boolean,
    didTruncate: boolean
  ): void {
    this.boundaryCount++;
    this.captureSuccessCount++;
    this.bytesCaptured += bytesIn;
    this.bytesPersisted += bytesStored;
    if (didRedact) this.redactionCount++;
    if (didTruncate) this.truncationCount++;

    this.replayabilityDistribution[replayability] =
      (this.replayabilityDistribution[replayability] || 0) + 1;
    this.sideEffectDistribution[sideEffect] =
      (this.sideEffectDistribution[sideEffect] || 0) + 1;
  }

  recordFailure(): void {
    this.captureFailureCount++;
  }

  recordUnsupportedBoundary(): void {
    this.unsupportedBoundaryCount++;
  }

  recordPersistenceLatency(latencyMs: number): void {
    this.persistenceLatencyMsTotal += latencyMs;
    this.persistenceOpsCount++;
  }

  getSnapshot(): CaptureMetricsSnapshot {
    return {
      captureSuccessCount: this.captureSuccessCount,
      captureFailureCount: this.captureFailureCount,
      boundaryCount: this.boundaryCount,
      bytesCaptured: this.bytesCaptured,
      bytesPersisted: this.bytesPersisted,
      redactionCount: this.redactionCount,
      truncationCount: this.truncationCount,
      persistenceLatencyMsTotal: this.persistenceLatencyMsTotal,
      persistenceOpsCount: this.persistenceOpsCount,
      unsupportedBoundaryCount: this.unsupportedBoundaryCount,
      replayabilityDistribution: { ...this.replayabilityDistribution },
      sideEffectDistribution: { ...this.sideEffectDistribution },
    };
  }

  reset(): void {
    this.captureSuccessCount = 0;
    this.captureFailureCount = 0;
    this.boundaryCount = 0;
    this.bytesCaptured = 0;
    this.bytesPersisted = 0;
    this.redactionCount = 0;
    this.truncationCount = 0;
    this.persistenceLatencyMsTotal = 0;
    this.persistenceOpsCount = 0;
    this.unsupportedBoundaryCount = 0;
    for (const k of Object.keys(this.replayabilityDistribution)) {
      this.replayabilityDistribution[k as ReplayabilityClass] = 0;
    }
    for (const k of Object.keys(this.sideEffectDistribution)) {
      this.sideEffectDistribution[k as SideEffectClass] = 0;
    }
  }
}

export const globalCaptureMetrics = new CaptureMetricsCollector();
