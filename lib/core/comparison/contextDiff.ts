/**
 * Context Snapshot Diff Engine.
 *
 * Compares observable ContextSnapshots across agent runs by source type,
 * source reference, content hash, position, and token count.
 */

import type { ContextSnapshot, ContextItem } from "../contracts/context";
import type { ContextDiff, ContextItemChange } from "../contracts/comparison";

export function diffContextSnapshots(
  baselineSnapshots: ContextSnapshot[] = [],
  candidateSnapshots: ContextSnapshot[] = []
): ContextDiff {
  if (baselineSnapshots.length === 0 && candidateSnapshots.length === 0) {
    return { token_delta: 0, changes: [], unavailable: true };
  }

  // Aggregate items across all snapshots for baseline & candidate
  const baseItems: Array<{ item: ContextItem; position: number }> = [];
  let baseTokens = 0;
  for (const snap of baselineSnapshots) {
    baseTokens += snap.total_token_estimate ?? 0;
    (snap.items ?? []).forEach((item, idx) => {
      baseItems.push({ item, position: item.position ?? idx });
    });
  }

  const candItems: Array<{ item: ContextItem; position: number }> = [];
  let candTokens = 0;
  for (const snap of candidateSnapshots) {
    candTokens += snap.total_token_estimate ?? 0;
    (snap.items ?? []).forEach((item, idx) => {
      candItems.push({ item, position: item.position ?? idx });
    });
  }

  const tokenDelta = candTokens - baseTokens;
  const changes: ContextItemChange[] = [];

  const baseMap = new Map<string, { item: ContextItem; position: number }>();
  for (const b of baseItems) {
    const key = b.item.item_id || `${b.item.source_type}:${b.item.source_reference ?? ""}`;
    baseMap.set(key, b);
  }

  const candMap = new Map<string, { item: ContextItem; position: number }>();
  for (const c of candItems) {
    const key = c.item.item_id || `${c.item.source_type}:${c.item.source_reference ?? ""}`;
    candMap.set(key, c);
  }

  // Find added & modified
  for (const [key, c] of candMap.entries()) {
    const b = baseMap.get(key);
    if (!b) {
      changes.push({
        item_id: c.item.item_id || key,
        source_type: c.item.source_type,
        source_ref: c.item.source_reference,
        change_type: "CONTEXT_ITEM_ADDED",
        after_hash: c.item.content_hash,
        token_delta: c.item.token_estimate ?? 0,
        position_after: c.position,
      });
    } else {
      const hashChanged = b.item.content_hash !== c.item.content_hash;
      const orderChanged = b.position !== c.position;
      const sourceChanged = b.item.source_type !== c.item.source_type;

      if (sourceChanged) {
        changes.push({
          item_id: key,
          source_type: c.item.source_type,
          source_ref: c.item.source_reference,
          change_type: "CONTEXT_SOURCE_CHANGED",
          before_hash: b.item.content_hash,
          after_hash: c.item.content_hash,
          token_delta: (c.item.token_estimate ?? 0) - (b.item.token_estimate ?? 0),
          position_before: b.position,
          position_after: c.position,
        });
      } else if (hashChanged) {
        changes.push({
          item_id: key,
          source_type: c.item.source_type,
          source_ref: c.item.source_reference,
          change_type: "CONTEXT_ITEM_CHANGED",
          before_hash: b.item.content_hash,
          after_hash: c.item.content_hash,
          token_delta: (c.item.token_estimate ?? 0) - (b.item.token_estimate ?? 0),
          position_before: b.position,
          position_after: c.position,
        });
      } else if (orderChanged) {
        changes.push({
          item_id: key,
          source_type: c.item.source_type,
          source_ref: c.item.source_reference,
          change_type: "CONTEXT_ORDER_CHANGED",
          before_hash: b.item.content_hash,
          after_hash: c.item.content_hash,
          token_delta: 0,
          position_before: b.position,
          position_after: c.position,
        });
      }
    }
  }

  // Find removed
  for (const [key, b] of baseMap.entries()) {
    if (!candMap.has(key)) {
      changes.push({
        item_id: b.item.item_id || key,
        source_type: b.item.source_type,
        source_ref: b.item.source_reference,
        change_type: "CONTEXT_ITEM_REMOVED",
        before_hash: b.item.content_hash,
        token_delta: -(b.item.token_estimate ?? 0),
        position_before: b.position,
      });
    }
  }

  return {
    token_delta: tokenDelta,
    changes,
    unavailable: false,
  };
}
