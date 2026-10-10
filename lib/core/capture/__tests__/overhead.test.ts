import { describe, it, expect } from "vitest";
import { measureCaptureOverhead } from "../benchmark";

describe("Capture Overhead Measurement", () => {
  it("measures instrumentation runtime overhead, captured bytes, and deduplication ratio", async () => {
    const results = await measureCaptureOverhead(15);

    expect(results.iterations).toBe(15);
    expect(results.boundariesCaptured).toBe(45); // 3 boundaries per iteration * 15
    expect(results.bytesCaptured).toBeGreaterThan(0);
    expect(results.bytesPersisted).toBeGreaterThan(0);
    expect(results.deduplicationRatio).toBeGreaterThanOrEqual(1.0);

    console.info("--- AgentPulse Capture Benchmark Results ---");
    console.info(`Baseline Runtime:      ${results.baselineRuntimeMs} ms`);
    console.info(`Instrumented Runtime:  ${results.instrumentedRuntimeMs} ms`);
    console.info(`Overhead:              ${results.overheadMs} ms (${results.overheadPercent}%)`);
    console.info(`Boundaries Captured:   ${results.boundariesCaptured}`);
    console.info(`Context Snapshots:     ${results.contextSnapshotsCaptured}`);
    console.info(`Bytes Captured:        ${results.bytesCaptured} bytes`);
    console.info(`Bytes Persisted:       ${results.bytesPersisted} bytes`);
    console.info(`Deduplication Ratio:   ${results.deduplicationRatio}x`);
  });
});
