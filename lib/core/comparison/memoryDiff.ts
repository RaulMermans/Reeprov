/**
 * Memory Operations Diff Engine.
 *
 * Compares observable memory operations (reads, writes, retrievals, evictions)
 * and references between runs.
 */

import type { MemoryOperation, MemoryReference } from "../contracts/memory";
import type { MemoryDiff, MemoryChange } from "../contracts/comparison";

export function diffMemoryOperations(
  baselineOps: MemoryOperation[] = [],
  candidateOps: MemoryOperation[] = [],
  baselineRefs: MemoryReference[] = [],
  candidateRefs: MemoryReference[] = []
): MemoryDiff {
  const changes: MemoryChange[] = [];

  // Helper to extract a stable identity key for an operation
  const getOpIdentityKey = (op: MemoryOperation, index: number): string => {
    if (op.memory_id) return `mem:${op.memory_id}:${op.operation_type}`;
    if (op.provider_record_id) return `prov:${op.provider_record_id}:${op.operation_type}`;
    if (op.operation_id) return `op:${op.operation_id}`;
    if (op.query) return `query:${op.query}:${op.operation_type}`;
    if (op.source_provenance) return `src:${op.source_provenance}:${op.operation_type}`;
    return `pos:${index}`;
  };

  const baseMap = new Map<string, MemoryOperation>();
  const candMap = new Map<string, MemoryOperation>();

  baselineOps.forEach((op, idx) => {
    baseMap.set(getOpIdentityKey(op, idx), op);
  });
  candidateOps.forEach((op, idx) => {
    candMap.set(getOpIdentityKey(op, idx), op);
  });

  // Check added & changed
  for (const [key, c] of candMap.entries()) {
    const b = baseMap.get(key);
    const isWrite = c.operation_type === "committed_write" || (c.operation_type as string) === "write";

    if (!b) {
      changes.push({
        memory_id: c.memory_id,
        operation: isWrite ? "write" : "read",
        change_type: isWrite ? "MEMORY_WRITE_CHANGED" : "MEMORY_RETRIEVAL_CHANGED",
        details: { action: "added_in_candidate", type: c.operation_type, provider: c.provider, score: c.score },
      });
    } else {
      const typeMismatch = b.operation_type !== c.operation_type;
      const versionMismatch = b.version !== c.version;
      const scoreDiff = b.score !== undefined && c.score !== undefined && Math.abs(b.score - c.score) > 0.001;

      if (typeMismatch || versionMismatch || scoreDiff) {
        changes.push({
          memory_id: c.memory_id ?? b.memory_id,
          operation: isWrite ? "write" : "read",
          change_type: "MEMORY_RETRIEVAL_CHANGED",
          details: {
            baseline_op: b.operation_type,
            candidate_op: c.operation_type,
            baseline_version: b.version,
            candidate_version: c.version,
            baseline_score: b.score,
            candidate_score: c.score,
          },
        });
      }
    }
  }

  // Check missing from candidate
  for (const [key, b] of baseMap.entries()) {
    if (!candMap.has(key)) {
      const isWrite = b.operation_type === "committed_write" || (b.operation_type as string) === "write";
      changes.push({
        memory_id: b.memory_id,
        operation: isWrite ? "write" : "read",
        change_type: isWrite ? "MEMORY_WRITE_CHANGED" : "MEMORY_RETRIEVAL_CHANGED",
        details: { action: "missing_in_candidate", type: b.operation_type, provider: b.provider, score: b.score },
      });
    }
  }

  // Compare Memory References for context injection
  const baseRefMap = new Map(baselineRefs.map((r) => [r.memory_id, r]));
  const candRefMap = new Map(candidateRefs.map((r) => [r.memory_id, r]));

  for (const [id, cRef] of candRefMap.entries()) {
    const bRef = baseRefMap.get(id);
    if (!bRef) {
      changes.push({
        memory_id: id,
        change_type: "MEMORY_ADDED_TO_CONTEXT",
        version_after: cRef.version,
        details: { category: cRef.category },
      });
    } else {
      if (bRef.version !== cRef.version) {
        changes.push({
          memory_id: id,
          change_type: "MEMORY_VERSION_CHANGED",
          version_before: bRef.version,
          version_after: cRef.version,
          details: { category: cRef.category },
        });
      }
    }
  }

  for (const [id, bRef] of baseRefMap.entries()) {
    if (!candRefMap.has(id)) {
      changes.push({
        memory_id: id,
        change_type: "MEMORY_REMOVED_FROM_CONTEXT",
        version_before: bRef.version,
        details: { category: bRef.category },
      });
    }
  }

  return { changes };
}
