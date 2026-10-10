/**
 * Deterministic Divergence Detector.
 *
 * Compares expected execution steps, boundary identities, input hashes, state hashes,
 * and final outputs to generate typed ReplayDivergence records.
 */

import { type ReplayDivergence, type DivergenceType } from "./contracts";
import { hashPayload } from "../capture/hashing";

export class DivergenceDetector {
  private readonly divergences: ReplayDivergence[] = [];
  private divergenceCounter = 0;

  constructor(
    public readonly replayId: string,
    public readonly sourceRunId: string
  ) {}

  recordDivergence(params: {
    type: DivergenceType;
    message: string;
    expected?: Record<string, unknown>;
    actual?: Record<string, unknown>;
    stepIndex?: number;
    boundarySequence?: number;
    severity?: "critical" | "warning";
  }): ReplayDivergence {
    const divId = `div_${this.replayId}_${this.divergenceCounter++}`;
    const div: ReplayDivergence = {
      divergence_id: divId,
      replay_id: this.replayId,
      source_run_id: this.sourceRunId,
      divergence_type: params.type,
      step_index: params.stepIndex,
      boundary_sequence: params.boundarySequence,
      expected: params.expected ?? {},
      actual: params.actual ?? {},
      severity: params.severity ?? "critical",
      message: params.message,
      timestamp: new Date().toISOString(),
    };

    this.divergences.push(div);
    return div;
  }

  checkStep(
    expectedIndex: number,
    expectedName: string,
    actualIndex: number,
    actualName: string
  ): ReplayDivergence | null {
    if (expectedIndex !== actualIndex || expectedName !== actualName) {
      return this.recordDivergence({
        type: "STEP_MISMATCH",
        message: `Step mismatch at index ${actualIndex}. Expected step ${expectedIndex} ('${expectedName}'), executed step ${actualIndex} ('${actualName}').`,
        stepIndex: actualIndex,
        expected: { stepIndex: expectedIndex, name: expectedName },
        actual: { stepIndex: actualIndex, name: actualName },
      });
    }
    return null;
  }

  checkFinalOutput(
    recordedOutput: unknown,
    producedOutput: unknown
  ): ReplayDivergence | null {
    if (recordedOutput === undefined) return null;

    const recordedHash = hashPayload(recordedOutput);
    const producedHash = hashPayload(producedOutput);

    if (recordedHash !== producedHash) {
      return this.recordDivergence({
        type: "OUTPUT_MISMATCH",
        message: `Final application output diverged from recorded output. Expected hash '${recordedHash}', produced '${producedHash}'.`,
        expected: { hash: recordedHash, value: recordedOutput },
        actual: { hash: producedHash, value: producedOutput },
      });
    }
    return null;
  }

  getDivergences(): ReplayDivergence[] {
    return [...this.divergences];
  }

  hasCriticalDivergence(): boolean {
    return this.divergences.some((d) => d.severity === "critical");
  }

  getFirstDivergence(): ReplayDivergence | undefined {
    return this.divergences[0];
  }
}
