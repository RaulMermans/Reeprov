/**
 * Capture Overhead Measurement & Benchmark Suite.
 *
 * Runs deterministic reference workloads with and without instrumentation
 * to measure runtime overhead, byte footprint, and deduplication ratios.
 */

import { ReeprovCaptureService } from "./sdk";
import { InMemoryContentStore, setContentStore, _resetContentStore } from "./contentStore";

export interface BenchmarkResult {
  baselineRuntimeMs: number;
  instrumentedRuntimeMs: number;
  overheadMs: number;
  overheadPercent: number;
  boundariesCaptured: number;
  contextSnapshotsCaptured: number;
  bytesCaptured: number;
  bytesPersisted: number;
  deduplicationRatio: number; // e.g. 1.5x
  iterations: number;
}

/**
 * Runs a simulated agent workload (math, string formatting, dictionary lookup)
 * without Reeprov capture.
 */
async function runBaselineWorkload(iterations: number): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    // 1. Model call simulation
    const prompt = `Translate task ${i}: summary of user query and context items`;
    const response = `Translated response for ${prompt}. Tokens processed.`;

    // 2. Retrieval simulation
    const query = `search term ${i}`;
    const docs = [
      { id: `doc_${i}_1`, text: `Content of document 1 for query ${query}` },
      { id: `doc_${i}_2`, text: `Content of document 2 for query ${query}` },
    ];

    // 3. Tool call simulation
    const toolArgs = { customer_id: `cust_${i}`, amount: i * 100 };
    const toolResult = { status: "success", balance: i * 100 };

    // Fake CPU work
    JSON.stringify({ prompt, response, docs, toolArgs, toolResult });
  }
}

/**
 * Runs the exact same workload instrumented with Reeprov capture.
 */
async function runInstrumentedWorkload(
  capture: ReeprovCaptureService,
  iterations: number
): Promise<{
  boundaries: number;
  contexts: number;
  bytesCaptured: number;
  bytesPersisted: number;
  dedupeRatio: number;
}> {
  const store = new InMemoryContentStore();
  setContentStore(store);

  const session = capture.startRun({
    projectId: "benchmark-suite",
    workflowId: "overhead-benchmark",
    summary: `Benchmark run over ${iterations} iterations`,
  });

  for (let i = 0; i < iterations; i++) {
    const prompt = `Translate task ${i}: summary of user query and context items`;
    const response = `Translated response for ${prompt}. Tokens processed.`;

    await session.captureModel({
      model: "gpt-4o",
      provider: "openai",
      prompt,
      response,
      inputTokens: 50,
      outputTokens: 20,
      startedAt: new Date().toISOString(),
    });

    const query = `search term ${i}`;
    const sharedLargeDoc = "Canonical Reeprov Architecture Manual chunk with guidelines ".repeat(100); // ~6KB > 4KB
    await session.captureRetrieval({
      serviceName: "mock_vector_db",
      query,
      results: [
        { documentId: `doc_${i}_1`, content: sharedLargeDoc },
        { documentId: `doc_${i}_2`, content: sharedLargeDoc },
      ],
      startedAt: new Date().toISOString(),
    });

    const toolArgs = { customer_id: `cust_${i}`, amount: i * 100 };
    await session.captureTool({
      toolName: "get_customer_balance",
      arguments: toolArgs,
      output: { status: "success", balance: i * 100 },
      startedAt: new Date().toISOString(),
    });
  }

  const artifact = await session.finishRun();
  const stats = await store.getStats();

  const totalBoundaryBytes = artifact.boundaries.reduce(
    (sum, b) => sum + (b.input.raw_size_bytes ?? 0) + (b.output?.raw_size_bytes ?? 0),
    0
  );
  const totalRawBytes = totalBoundaryBytes + stats.dedupeSavingsBytes;
  const persistedBytes = stats.totalBytes + totalBoundaryBytes;
  const dedupeRatio =
    stats.totalBytes > 0
      ? Number(((stats.totalBytes + stats.dedupeSavingsBytes) / stats.totalBytes).toFixed(2))
      : 1.0;

  _resetContentStore();

  return {
    boundaries: artifact.boundaries.length,
    contexts: artifact.context.length,
    bytesCaptured: totalRawBytes,
    bytesPersisted: persistedBytes,
    dedupeRatio,
  };
}

/**
 * Executes a comparative overhead benchmark.
 */
export async function measureCaptureOverhead(iterations = 20): Promise<BenchmarkResult> {
  // Warmup
  await runBaselineWorkload(5);

  // Baseline
  const t0 = performance.now();
  await runBaselineWorkload(iterations);
  const baselineRuntimeMs = performance.now() - t0;

  // Instrumented
  const capture = new ReeprovCaptureService();
  const t1 = performance.now();
  const instStats = await runInstrumentedWorkload(capture, iterations);
  const instrumentedRuntimeMs = performance.now() - t1;

  const overheadMs = Math.max(0, instrumentedRuntimeMs - baselineRuntimeMs);
  const overheadPercent =
    baselineRuntimeMs > 0
      ? Number(((overheadMs / baselineRuntimeMs) * 100).toFixed(1))
      : 0;

  return {
    baselineRuntimeMs: Number(baselineRuntimeMs.toFixed(2)),
    instrumentedRuntimeMs: Number(instrumentedRuntimeMs.toFixed(2)),
    overheadMs: Number(overheadMs.toFixed(2)),
    overheadPercent,
    boundariesCaptured: instStats.boundaries,
    contextSnapshotsCaptured: instStats.contexts,
    bytesCaptured: instStats.bytesCaptured,
    bytesPersisted: instStats.bytesPersisted,
    deduplicationRatio: instStats.dedupeRatio,
    iterations,
  };
}
