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

  const maxLen = Math.max(baselineOps.length, candidateOps.length);
  for (let i = 0; i < maxLen; i++) {
    const b = baselineOps[i];
    const c = candidateOps[i];

    if (!b && c) {
      const isWrite = c.operation_type === "committed_write" || (c.operation_type as string) === "write";
      changes.push({
        memory_id: c.memory_id,
        operation: isWrite ? "write" : "read",
        change_type: isWrite ? "MEMORY_WRITE_CHANGED" : "MEMORY_RETRIEVAL_CHANGED",
        details: { action: "added_in_candidate", type: c.operation_type },
      });
      continue;
    }

    if (b && !c) {
      const isWrite = b.operation_type === "committed_write" || (b.operation_type as string) === "write";
      changes.push({
        memory_id: b.memory_id,
        operation: isWrite ? "write" : "read",
        change_type: isWrite ? "MEMORY_WRITE_CHANGED" : "MEMORY_RETRIEVAL_CHANGED",
        details: { action: "missing_in_candidate", type: b.operation_type },
      });
      continue;
    }

    if (b && c) {
      if (b.operation_type !== c.operation_type || b.memory_id !== c.memory_id) {
        changes.push({
          memory_id: c.memory_id ?? b.memory_id,
          operation: c.operation_type === "committed_write" ? "write" : "read",
          change_type: "MEMORY_RETRIEVAL_CHANGED",
          details: {
            baseline_op: b.operation_type,
            candidate_op: c.operation_type,
            baseline_id: b.memory_id,
            candidate_id: c.memory_id,
          },
        });
      }
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
