/**
 * Retrieval Operation Capture Adapter.
 *
 * Captures query-driven searches across vector engines, hybrid indexes, and document stores.
 * Links retrieved candidate chunks to the subset that ultimately enters model ContextSnapshots.
 */

import {
  retrievalOperationSchema,
  type RetrievalOperation,
  type RetrievalResultItem,
} from "../../contracts/retrieval";
import { normalizeBoundary } from "../normalizeBoundary";
import { hashPayload } from "../hashing";
import { resolvePolicy } from "../policy";
import { sanitizeCanonicalValue } from "../redaction";
import type { RetrievalCaptureInput, RetrievalCaptureResult, CapturePolicy } from "../types";

/**
 * Captures a knowledge retrieval operation and produces linked canonical records.
 */
export async function captureRetrievalOperation(
  input: RetrievalCaptureInput,
  policyOverrides?: Partial<CapturePolicy>
): Promise<RetrievalCaptureResult> {
  const policy = resolvePolicy(policyOverrides);
  const operationId = `retrieval_${input.runId}_${input.stepId || Date.now()}`;
  const startedAt = input.startedAt;
  const completedAt = input.completedAt || new Date().toISOString();
  const durationMs =
    input.durationMs ??
    Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());

  // 1. Process Result Items
  const contextItemIds: string[] = [];
  const resultItems: RetrievalResultItem[] = input.results.map((item, idx) => {
    const safeContent = sanitizeCanonicalValue(item.content, policy);
    const contentHash = hashPayload(safeContent);
    const contextItemId = `${operationId}_item_${idx}`;
    if (item.enteredModelContext !== false) {
      contextItemIds.push(contextItemId);
    }

    return {
      document_id: item.documentId,
      chunk_id: item.chunkId,
      title: item.title,
      uri: item.uri,
      score: item.score,
      rank: item.rank ?? idx + 1,
      content_preview: safeContent ? safeContent.slice(0, 250) : undefined,
      content: safeContent,
      metadata: {
        ...(item.metadata ?? {}),
        content_hash: contentHash,
        entered_model_context: item.enteredModelContext ?? true,
      },
    };
  });

  // 2. Build RetrievalOperation
  const retrievalOperation: RetrievalOperation = retrievalOperationSchema.parse(sanitizeCanonicalValue({
    operation_id: operationId,
    step_id: input.stepId,
    service_name: input.serviceName,
    query: input.query,
    filters: input.filters,
    top_k: input.topK ?? input.results.length,
    results_count: input.results.length,
    results: resultItems,
    duration_ms: durationMs,
    timestamp: startedAt,
    context_item_ids: contextItemIds,
  }, policy));

  // 3. Build ExecutionBoundary
  const boundary = await normalizeBoundary(
    {
      runId: input.runId,
      stepId: input.stepId,
      nodeId: input.nodeId,
      sequenceIndex: input.sequenceIndex,
      boundaryType: "retrieval_call",
      name: `${input.serviceName}:search`,
      startedAt,
      completedAt,
      durationMs,
      input: {
        query: input.query,
        filters: input.filters,
        top_k: input.topK,
      },
      output: {
        results_count: input.results.length,
        results: resultItems,
      },
      error: input.error,
      declaredSideEffectClass: "read_only",
      declaredReplayability: "REPLAYABLE_RECORDED",
      dependencyIdentity: `retrieval:${input.serviceName}`,
      linkedRetrievalOperationId: operationId,
      metadata: {
        results_count: input.results.length,
        context_items_entered_count: contextItemIds.length,
      },
    },
    policy
  );

  return { boundary, retrievalOperation };
}
