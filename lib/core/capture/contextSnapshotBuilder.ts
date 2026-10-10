/**
 * Context Snapshot Materialization.
 *
 * Constructs real canonical ContextSnapshot records for model calls, attributing
 * tokens and provenance across system instructions, conversation turns,
 * retrieved documents, retrieved memory, and tool definitions.
 */

import { contextSnapshotSchema, type ContextSnapshot, type ContextItem, type ContextSourceType, type ContextProvenance } from "../contracts/context";
import { sanitizePayload } from "./redaction";
import { hashPayload } from "./hashing";
import { getContentStore } from "./contentStore";
import { resolvePolicy } from "./policy";
import type { CapturePolicy } from "./types";

export interface ContextItemInput {
  sourceType: ContextSourceType;
  content: string;
  sourceReference?: string;
  provenance?: ContextProvenance;
  tokenEstimate?: number;
  sensitivity?: "public" | "internal" | "confidential" | "restricted";
  inclusionReason?: string;
  retrievalScore?: number;
  version?: string;
  metadata?: Record<string, unknown>;
}

export interface BuildContextSnapshotParams {
  snapshotId?: string;
  stepId?: string;
  modelInvocationId?: string;
  items: ContextItemInput[];
  timestamp?: string;
  policyOverrides?: Partial<CapturePolicy>;
  metadata?: Record<string, unknown>;
}

/**
 * Heuristic estimation: ~4 English characters per token if not provided.
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Builds a validated canonical ContextSnapshot.
 */
export async function buildContextSnapshot(
  params: BuildContextSnapshotParams
): Promise<ContextSnapshot> {
  const policy = resolvePolicy(params.policyOverrides);
  const contentStore = getContentStore();
  const timestamp = params.timestamp || new Date().toISOString();
  const snapshotId =
    params.snapshotId ||
    `ctx_${params.modelInvocationId || params.stepId || Date.now()}`;

  let totalTokens = 0;
  const materializedItems: ContextItem[] = [];

  for (let idx = 0; idx < params.items.length; idx++) {
    const raw = params.items[idx];
    const itemId = `${snapshotId}_item_${idx}`;
    const tokenEst = raw.tokenEstimate ?? estimateTokens(raw.content);
    totalTokens += tokenEst;

    // Sanitize item content
    const redaction = sanitizePayload(raw.content, { policy });
    const contentHash = redaction.persisted_hash;
    const contentStr = String(redaction.value ?? "");
    const sizeBytes = Buffer.byteLength(contentStr, "utf8");

    let contentToStore: string | undefined = contentStr;
    let contentRef: string | undefined;
    let availability: ContextItem["availability"] = "CAPTURED";

    if (policy.contentMode === "STRUCTURE_ONLY") {
      contentToStore = undefined;
      availability = "HASH_ONLY";
    } else if (sizeBytes > policy.maxInlineBytes) {
      const putResult = await contentStore.put(contentStr, "text/plain");
      contentRef = putResult.contentRef;
      contentToStore = undefined;
      availability = "CAPTURED";
    }

    const item: ContextItem = {
      item_id: itemId,
      source_type: raw.sourceType,
      source_reference: raw.sourceReference,
      provenance: raw.provenance,
      token_estimate: tokenEst,
      position: idx,
      inclusion_reason: raw.inclusionReason,
      retrieval_score: raw.retrievalScore,
      timestamp,
      version: raw.version,
      sensitivity: raw.sensitivity ?? "internal",
      redaction_status: redaction.content_status,
      content_captured: true,
      content: contentToStore,
      content_hash: contentHash,
      content_ref: contentRef,
      availability,
      metadata: raw.metadata,
    };

    materializedItems.push(item);
  }

  const snapshot: ContextSnapshot = {
    snapshot_id: snapshotId,
    step_id: params.stepId,
    model_invocation_id: params.modelInvocationId,
    timestamp,
    total_token_estimate: totalTokens,
    items: materializedItems,
    metadata: params.metadata,
  };

  return contextSnapshotSchema.parse(snapshot);
}
