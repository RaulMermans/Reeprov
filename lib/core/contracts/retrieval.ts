/**
 * Canonical Retrieval Operation Contracts.
 *
 * Captures query-driven retrieval operations across vector search, keyword search,
 * and hybrid knowledge engines. Links directly to ContextSnapshot items.
 */

import { z } from "zod";

export const retrievalResultItemSchema = z.object({
  document_id: z.string(),
  chunk_id: z.string().optional(),
  title: z.string().optional(),
  uri: z.string().optional(),
  score: z.number().optional(),
  rank: z.number().int().positive().optional(),
  content_preview: z.string().optional(),
  content: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type RetrievalResultItem = z.infer<typeof retrievalResultItemSchema>;

export const retrievalOperationSchema = z.object({
  operation_id: z.string(),
  step_id: z.string().optional(),
  service_name: z.string().optional(),           // e.g. "pinecone", "qdrant", "weaviate", "pgvector"
  query: z.string(),
  filters: z.record(z.string(), z.unknown()).optional(),
  top_k: z.number().int().positive().optional(),
  results_count: z.number().int().nonnegative(),
  results: z.array(retrievalResultItemSchema).default([]),
  duration_ms: z.number().optional(),
  timestamp: z.string(),
  context_item_ids: z.array(z.string()).default([]),
});

export type RetrievalOperation = z.infer<typeof retrievalOperationSchema>;
