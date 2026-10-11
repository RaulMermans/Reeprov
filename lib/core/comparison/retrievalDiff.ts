/**
 * Retrieval Operation Diff Engine.
 *
 * Compares observable retrieval queries, candidate IDs, rankings, scores,
 * and context admission between executions.
 */

import type { RetrievalOperation } from "../contracts/retrieval";
import type { RetrievalDiff, RetrievalChange } from "../contracts/comparison";

export function diffRetrievalOperations(
  baseline: RetrievalOperation[] = [],
  candidate: RetrievalOperation[] = []
): RetrievalDiff {
  const changes: RetrievalChange[] = [];

  const maxLen = Math.max(baseline.length, candidate.length);
  for (let i = 0; i < maxLen; i++) {
    const b = baseline[i];
    const c = candidate[i];

    if (!b && c) {
      changes.push({
        retrieval_id: c.operation_id,
        change_type: "RESULT_ADDED",
        query_after: c.query,
        details: { index: i, count: c.results?.length ?? 0 },
      });
      continue;
    }

    if (b && !c) {
      changes.push({
        retrieval_id: b.operation_id,
        change_type: "RESULT_REMOVED",
        query_before: b.query,
        details: { index: i, count: b.results?.length ?? 0 },
      });
      continue;
    }

    if (b && c) {
      if (b.query !== c.query) {
        changes.push({
          retrieval_id: c.operation_id,
          change_type: "RETRIEVAL_QUERY_CHANGED",
          query_before: b.query,
          query_after: c.query,
          details: { index: i },
        });
      }

      // Compare results lists
      const bResults = b.results ?? [];
      const cResults = c.results ?? [];

      const bMap = new Map(bResults.map((r, idx) => [r.document_id, { ...r, calculatedRank: r.rank ?? idx + 1 }]));
      const cMap = new Map(cResults.map((r, idx) => [r.document_id, { ...r, calculatedRank: r.rank ?? idx + 1 }]));

      for (const [id, cItem] of cMap.entries()) {
        const bItem = bMap.get(id);
        if (!bItem) {
          changes.push({
            retrieval_id: c.operation_id,
            change_type: "RESULT_ADDED",
            item_id: id,
            rank_after: cItem.calculatedRank,
            score_after: cItem.score,
            details: { document_id: id },
          });
        } else {
          if (bItem.calculatedRank !== cItem.calculatedRank) {
            changes.push({
              retrieval_id: c.operation_id,
              change_type: "RESULT_RANK_CHANGED",
              item_id: id,
              rank_before: bItem.calculatedRank,
              rank_after: cItem.calculatedRank,
              details: { score_before: bItem.score, score_after: cItem.score },
            });
          }
          if (bItem.score !== cItem.score && bItem.calculatedRank === cItem.calculatedRank) {
            changes.push({
              retrieval_id: c.operation_id,
              change_type: "RESULT_SCORE_CHANGED",
              item_id: id,
              score_before: bItem.score,
              score_after: cItem.score,
              details: {},
            });
          }
        }
      }

      for (const [id, bItem] of bMap.entries()) {
        if (!cMap.has(id)) {
          changes.push({
            retrieval_id: b.operation_id,
            change_type: "RESULT_REMOVED",
            item_id: id,
            rank_before: bItem.calculatedRank,
            score_before: bItem.score,
            details: { document_id: id },
          });
        }
      }
    }
  }

  return { changes };
}
