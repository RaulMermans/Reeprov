/**
 * Memory Observability Adapter & Instrumentation Hook.
 *
 * Framework-neutral observability contracts for external memory systems
 * (e.g. Mem0, Letta, Zep, custom DB).
 *
 * Invariant: AgentPulse observes memory operations; it does not manage or persist long-term memory.
 */

import {
  memoryOperationSchema,
  type MemoryOperation,
  type MemoryCategory,
  type MemoryOperationType,
} from "../../contracts/memory";
import { normalizeBoundary } from "../normalizeBoundary";
import { resolvePolicy } from "../policy";
import type { MemoryCaptureInput, MemoryCaptureResult, CapturePolicy } from "../types";

/**
 * Captures an observed memory operation and emits canonical records.
 */
export async function captureMemoryOperation(
  input: MemoryCaptureInput,
  policyOverrides?: Partial<CapturePolicy>
): Promise<MemoryCaptureResult> {
  const policy = resolvePolicy(policyOverrides);
  const operationId = `mem_${input.runId}_${input.stepId || Date.now()}`;
  const timestamp = input.timestamps.operationAt || new Date().toISOString();

  // 1. Determine boundary type and side effect class
  const isReadOp =
    input.operationType === "read" || input.operationType === "retrieval";
  const boundaryType = isReadOp ? "memory_read" : "memory_write";
  const sideEffectClass = isReadOp ? "read_only" : "external_side_effect";

  // 2. Build MemoryOperation
  const memoryOperation: MemoryOperation = memoryOperationSchema.parse({
    operation_id: operationId,
    step_id: input.stepId,
    operation_type: input.operationType,
    memory_id: input.memoryId,
    memory_type: input.category,
    provider: input.provider,
    query: input.query,
    score: input.score,
    rank: input.rank,
    source_provenance: input.sourceProvenance,
    version: input.version,
    timestamps: {
      operation_at: input.timestamps.operationAt,
      created_at: input.timestamps.createdAt,
      updated_at: input.timestamps.updatedAt,
    },
    outcome: input.outcome,
    context_injection_linkage: input.contextInjectionLinkage,
    originating_run_id: input.originatingRunId ?? input.runId,
    originating_step_id: input.originatingStepId ?? input.stepId,
    details: input.details,
  });

  // 3. Build ExecutionBoundary
  const boundary = await normalizeBoundary(
    {
      runId: input.runId,
      stepId: input.stepId,
      nodeId: input.nodeId,
      sequenceIndex: input.sequenceIndex,
      boundaryType,
      name: `${input.provider}:${input.operationType}`,
      startedAt: input.timestamps.operationAt,
      completedAt: input.timestamps.operationAt,
      input: {
        operation_type: input.operationType,
        memory_id: input.memoryId,
        category: input.category,
        query: input.query,
        key: input.key,
        value: input.value,
      },
      output: input.details ?? { outcome: input.outcome, memory_id: input.memoryId },
      error: input.error,
      declaredSideEffectClass: sideEffectClass,
      declaredReplayability: isReadOp ? "REPLAYABLE_RECORDED" : "SIDE_EFFECT_GATED",
      dependencyIdentity: `memory:${input.provider}`,
      linkedMemoryOperationId: operationId,
      metadata: {
        memory_category: input.category,
        operation_type: input.operationType,
        outcome: input.outcome,
      },
    },
    policy
  );

  return { boundary, memoryOperation };
}

// ── Simple Reference Memory Adapter ─────────────────────────────────────────

export interface ExampleMemoryEntry {
  id: string;
  category: MemoryCategory;
  key: string;
  value: unknown;
  createdAt: string;
}

/**
 * Example in-memory store adapter to demonstrate instrumentation hooks.
 */
export class ExampleInstrumentedMemoryProvider {
  private readonly store = new Map<string, ExampleMemoryEntry>();
  public readonly providerName = "example_memory_provider";

  constructor(
    private readonly onMemoryOp: (op: MemoryCaptureInput) => Promise<void> | void
  ) {}

  async write(
    runId: string,
    key: string,
    value: unknown,
    category: MemoryCategory = "episodic",
    stepId?: string
  ): Promise<ExampleMemoryEntry> {
    const id = `mem_rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const entry: ExampleMemoryEntry = {
      id,
      category,
      key,
      value,
      createdAt: now,
    };
    this.store.set(key, entry);

    await this.onMemoryOp({
      runId,
      stepId,
      provider: this.providerName,
      operationType: "committed_write",
      category,
      memoryId: id,
      key,
      value,
      timestamps: { operationAt: now, createdAt: now },
      outcome: "success",
      details: { key, entry_id: id },
    });

    return entry;
  }

  async read(
    runId: string,
    key: string,
    category: MemoryCategory = "episodic",
    stepId?: string
  ): Promise<ExampleMemoryEntry | null> {
    const now = new Date().toISOString();
    const entry = this.store.get(key) || null;

    await this.onMemoryOp({
      runId,
      stepId,
      provider: this.providerName,
      operationType: "read",
      category,
      memoryId: entry?.id,
      key,
      query: key,
      timestamps: { operationAt: now },
      outcome: entry ? "success" : "not_found",
      details: entry ? { found: true, entry_id: entry.id } : { found: false },
    });

    return entry;
  }
}
