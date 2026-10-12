/**
 * Deterministic Context Intelligence Engine.
 *
 * Implements decision-scoped context composition, provenance coverage classification,
 * exact duplicate detection, context churn analysis, retrieval admission tracking,
 * tool exposure intelligence, and bounded diagnostic signal generation.
 *
 * Invariant:
 * Pure derived analysis. Does NOT modify input RunArtifact or ContextSnapshots.
 */

import type { RunArtifact } from "../contracts/runArtifact";
import type { ContextSnapshot, ContextItem, ContextSourceType } from "../contracts/context";
import { hashPayload } from "../capture/hashing";
import {
  type ContextIntelligenceReport,
  type ContextSnapshotAnalysis,
  type ContextComposition,
  type ContextMeasurementQuality,
  type ContextProvenanceCoverage,
  type ItemProvenanceCoverage,
  type ContextToolExposure,
  type ContextDiagnosticSignal,
  type ContextChurnTransition,
  type RetrievalAdmissionAnalysis,
  type RetrievalAdmissionItem,
  type ContextAblationCandidate,
  type ContextItemAnalysis,
  type ContextRunSummary,
  type ContextProvenanceGraph,
  type ProvenanceGraphNode,
  type ProvenanceGraphEdge,
  type ProvenanceCompletenessClass,
  DEFAULT_CONTEXT_ANALYZER_NAME,
  DEFAULT_CONTEXT_ANALYZER_VERSION,
  DEFAULT_CONTEXT_RULESET_VERSION,
  CONTEXT_INTELLIGENCE_SCHEMA_VERSION,
} from "../contracts/contextIntelligence";

export interface AnalyzeContextOptions {
  analyzerName?: string;
  analyzerVersion?: string;
  rulesetVersion?: string;
  comparisonLinkId?: string;
}

/**
 * Classifies provenance completeness for a single ContextItem based on source type.
 */
export function classifyItemProvenance(item: ContextItem): ItemProvenanceCoverage {
  const prov = item.provenance;
  const declaredFields: string[] = [];
  const missingFields: string[] = [];

  if (item.availability === "UNAVAILABLE" || item.availability === "NOT_CAPTURED") {
    return {
      item_id: item.item_id,
      source_type: item.source_type,
      classification: "UNAVAILABLE",
      declared_fields: [],
      missing_fields: ["content_availability"],
    };
  }

  if (item.availability === "HASH_ONLY" && !prov && !item.source_reference) {
    return {
      item_id: item.item_id,
      source_type: item.source_type,
      classification: "HASH_ONLY",
      declared_fields: ["content_hash"],
      missing_fields: ["provenance_source", "source_reference"],
    };
  }

  // Type-specific field audits
  switch (item.source_type) {
    case "retrieved_document": {
      if (prov?.source_system) declaredFields.push("source_system");
      else missingFields.push("source_system");

      if (prov?.document_id || prov?.chunk_id || prov?.uri) declaredFields.push("document_or_chunk_id");
      else missingFields.push("document_or_chunk_id");

      if (prov?.retrieval_query || prov?.retrieval_score !== undefined || item.retrieval_score !== undefined) {
        declaredFields.push("retrieval_metadata");
      } else {
        missingFields.push("retrieval_metadata");
      }
      break;
    }
    case "retrieved_memory": {
      if (prov?.source_system || item.metadata?.["provider"]) declaredFields.push("source_system");
      else missingFields.push("source_system");

      if (prov?.document_id || item.metadata?.["memory_id"] || item.source_reference) declaredFields.push("memory_id");
      else missingFields.push("memory_id");

      if (item.version || prov?.version || item.metadata?.["version"]) declaredFields.push("version");
      else missingFields.push("version");
      break;
    }
    case "tool_definition": {
      if (item.source_reference || item.metadata?.["tool_name"] || item.metadata?.["tool_id"]) declaredFields.push("tool_id");
      else missingFields.push("tool_id");

      if (item.version || item.metadata?.["schema_version"] || prov?.version) declaredFields.push("version");
      else missingFields.push("version");
      break;
    }
    case "system_policy":
    case "agent_instructions":
    case "active_skill": {
      if (item.source_reference || prov?.uri || prov?.document_id) declaredFields.push("source_reference");
      else missingFields.push("source_reference");
      break;
    }
    default: {
      if (item.source_reference || prov?.source_system || prov?.uri) declaredFields.push("source_identifier");
      else missingFields.push("source_identifier");
      break;
    }
  }

  let classification: ProvenanceCompletenessClass;
  if (missingFields.length === 0) {
    classification = "COMPLETE";
  } else if (declaredFields.length > 0) {
    classification = "PARTIAL";
  } else if (item.availability === "HASH_ONLY") {
    classification = "HASH_ONLY";
  } else {
    classification = "UNKNOWN_SOURCE";
  }

  return {
    item_id: item.item_id,
    source_type: item.source_type,
    classification,
    declared_fields: declaredFields,
    missing_fields: missingFields,
  };
}

/**
 * Computes composition breakdown for a snapshot.
 */
export function analyzeComposition(items: ContextItem[]): ContextComposition {
  const totalTokens = items.reduce((sum, item) => sum + (item.token_estimate ?? 0), 0);
  const bySourceMap = new Map<ContextSourceType, { tokens: number; count: number }>();
  const bySourceSystem: Record<string, number> = {};
  const bySensitivity: Record<string, number> = {};
  let capturedTokens = 0;
  let hashOnlyTokens = 0;
  let unavailableTokens = 0;
  let retrievedTokens = 0;
  let nonRetrievedTokens = 0;

  for (const item of items) {
    const tokens = item.token_estimate ?? 0;
    const currentSource = bySourceMap.get(item.source_type) ?? { tokens: 0, count: 0 };
    currentSource.tokens += tokens;
    currentSource.count += 1;
    bySourceMap.set(item.source_type, currentSource);

    const sourceSys = item.provenance?.source_system ?? "unspecified";
    bySourceSystem[sourceSys] = (bySourceSystem[sourceSys] ?? 0) + tokens;

    const sens = item.sensitivity ?? "internal";
    bySensitivity[sens] = (bySensitivity[sens] ?? 0) + tokens;

    if (item.availability === "HASH_ONLY") {
      hashOnlyTokens += tokens;
    } else if (item.availability === "UNAVAILABLE" || item.availability === "NOT_CAPTURED") {
      unavailableTokens += tokens;
    } else {
      capturedTokens += tokens;
    }

    if (item.source_type === "retrieved_document" || item.source_type === "retrieved_memory") {
      retrievedTokens += tokens;
    } else {
      nonRetrievedTokens += tokens;
    }
  }

  const by_source_type = Array.from(bySourceMap.entries()).map(([source_type, data]) => ({
    source_type,
    tokens: data.tokens,
    item_count: data.count,
    percentage: totalTokens > 0 ? Number(((data.tokens / totalTokens) * 100).toFixed(1)) : 0,
  }));

  return {
    total_tokens: totalTokens,
    item_count: items.length,
    by_source_type,
    by_source_system: bySourceSystem,
    by_sensitivity: bySensitivity,
    captured_tokens: capturedTokens,
    hash_only_tokens: hashOnlyTokens,
    unavailable_tokens: unavailableTokens,
    retrieved_tokens: retrievedTokens,
    non_retrieved_tokens: nonRetrievedTokens,
  };
}

/**
 * Computes measurement quality metrics for a snapshot.
 */
export function analyzeMeasurementQuality(items: ContextItem[]): ContextMeasurementQuality {
  let providerReported = 0;
  let tokenizerCounted = 0;
  let estimated = 0;
  let unknownTokens = 0;

  for (const item of items) {
    const tokens = item.token_estimate ?? 0;
    const method = item.token_measurement?.method ?? (tokens > 0 ? "ESTIMATED" : "UNKNOWN");
    if (method === "PROVIDER_REPORTED") {
      providerReported += tokens;
    } else if (method === "TOKENIZER_COUNTED") {
      tokenizerCounted += tokens;
    } else if (method === "ESTIMATED") {
      estimated += tokens;
    } else {
      unknownTokens += tokens;
    }
  }

  const total = providerReported + tokenizerCounted + estimated + unknownTokens;
  const exactPercentage = total > 0 ? Number((((providerReported + tokenizerCounted) / total) * 100).toFixed(1)) : 0;
  const estimatedPercentage = total > 0 ? Number(((estimated / total) * 100).toFixed(1)) : 0;

  return {
    provider_reported_tokens: providerReported,
    tokenizer_counted_tokens: tokenizerCounted,
    estimated_tokens: estimated,
    unknown_tokens: unknownTokens,
    exact_measured_percentage: exactPercentage,
    estimated_percentage: estimatedPercentage,
  };
}

/**
 * Analyzes tool exposure for a model decision against downstream tool calls in the run.
 */
export function analyzeToolExposure(
  snapshot: ContextSnapshot,
  run: RunArtifact
): ContextToolExposure {
  const toolItems = snapshot.items.filter((i) => i.source_type === "tool_definition");
  const toolDefinitionTokens = toolItems.reduce((sum, i) => sum + (i.token_estimate ?? 0), 0);
  const totalTokens = snapshot.total_token_estimate ?? snapshot.items.reduce((s, i) => s + (i.token_estimate ?? 0), 0);

  const exposedToolNames = new Set<string>();
  for (const item of toolItems) {
    const name = item.source_reference ?? (item.metadata?.["tool_name"] as string) ?? item.item_id;
    exposedToolNames.add(name);
  }

  // Find tool calls that occurred downstream from this decision
  const usedDownstream = new Set<string>();
  const boundaries = run.boundaries ?? [];
  for (const b of boundaries) {
    if (b.boundary_type === "tool_call") {
      const toolName = b.name.replace(/^tool:/, "");
      usedDownstream.add(toolName);
      usedDownstream.add(b.name);
    }
  }

  const toolsUsed: string[] = [];
  const unusedTools: string[] = [];

  for (const name of exposedToolNames) {
    const cleanName = name.replace(/^tool:/, "");
    if (usedDownstream.has(name) || usedDownstream.has(cleanName)) {
      toolsUsed.push(name);
    } else {
      unusedTools.push(name);
    }
  }

  const tokenShare = totalTokens > 0 ? Number(((toolDefinitionTokens / totalTokens) * 100).toFixed(1)) : 0;

  return {
    tools_exposed_count: exposedToolNames.size,
    tool_definition_tokens: toolDefinitionTokens,
    tool_token_share_percentage: tokenShare,
    tools_used_downstream: toolsUsed,
    unused_exposed_tools: unusedTools,
    tools_used_count: toolsUsed.length,
  };
}

/**
 * Analyzes Context Churn across consecutive snapshots.
 */
export function computeContextChurn(
  snapshots: ContextSnapshot[]
): ContextChurnTransition[] {
  const transitions: ContextChurnTransition[] = [];

  for (let i = 0; i < snapshots.length - 1; i++) {
    const fromSnap = snapshots[i]!;
    const toSnap = snapshots[i + 1]!;

    const fromMap = new Map<string, ContextItem>();
    fromSnap.items.forEach((it) => {
      const key = it.content_hash || it.item_id;
      fromMap.set(key, it);
    });

    const toMap = new Map<string, ContextItem>();
    toSnap.items.forEach((it) => {
      const key = it.content_hash || it.item_id;
      toMap.set(key, it);
    });

    let tokensRetained = 0;
    let tokensAdded = 0;
    let tokensRemoved = 0;
    let tokensChanged = 0;
    const churnBySource: Record<string, { added: number; removed: number; retained: number }> = {};

    for (const [key, toItem] of toMap.entries()) {
      const tokens = toItem.token_estimate ?? 0;
      const src = toItem.source_type;
      churnBySource[src] = churnBySource[src] ?? { added: 0, removed: 0, retained: 0 };

      const fromItem = fromMap.get(key);
      if (fromItem) {
        if (fromItem.token_estimate !== toItem.token_estimate) {
          tokensChanged += Math.abs(tokens - (fromItem.token_estimate ?? 0));
        }
        tokensRetained += Math.min(tokens, fromItem.token_estimate ?? 0);
        churnBySource[src]!.retained += tokens;
      } else {
        tokensAdded += tokens;
        churnBySource[src]!.added += tokens;
      }
    }

    for (const [key, fromItem] of fromMap.entries()) {
      if (!toMap.has(key)) {
        const tokens = fromItem.token_estimate ?? 0;
        const src = fromItem.source_type;
        churnBySource[src] = churnBySource[src] ?? { added: 0, removed: 0, retained: 0 };
        tokensRemoved += tokens;
        churnBySource[src]!.removed += tokens;
      }
    }

    const totalBefore = fromSnap.total_token_estimate ?? fromSnap.items.reduce((s, it) => s + (it.token_estimate ?? 0), 0);
    const totalAfter = toSnap.total_token_estimate ?? toSnap.items.reduce((s, it) => s + (it.token_estimate ?? 0), 0);
    const maxTokens = Math.max(1, Math.max(totalBefore, totalAfter));
    const churnRate = Number(Math.min(1, (tokensAdded + tokensRemoved + tokensChanged) / maxTokens).toFixed(3));

    transitions.push({
      from_snapshot_id: fromSnap.snapshot_id,
      to_snapshot_id: toSnap.snapshot_id,
      tokens_retained: tokensRetained,
      tokens_added: tokensAdded,
      tokens_removed: tokensRemoved,
      tokens_changed: tokensChanged,
      context_churn_rate: churnRate,
      churn_by_source_type: churnBySource,
    });
  }

  return transitions;
}

/**
 * Analyzes Retrieval Operations to Context Admission.
 */
export function analyzeRetrievalAdmission(
  retrievalOps: RunArtifact["retrieval"] = [],
  snapshots: ContextSnapshot[] = []
): RetrievalAdmissionAnalysis[] {
  const analyses: RetrievalAdmissionAnalysis[] = [];

  // Index context items by document_id, chunk_id, and content_hash
  const contextDocIds = new Set<string>();
  const contextChunkIds = new Set<string>();
  const contextHashes = new Set<string>();
  const itemMapByDoc = new Map<string, ContextItem>();

  for (const snap of snapshots) {
    for (const item of snap.items) {
      if (item.provenance?.document_id) {
        contextDocIds.add(item.provenance.document_id);
        itemMapByDoc.set(item.provenance.document_id, item);
      }
      if (item.provenance?.chunk_id) {
        contextChunkIds.add(item.provenance.chunk_id);
        itemMapByDoc.set(item.provenance.chunk_id, item);
      }
      if (item.content_hash) {
        contextHashes.add(item.content_hash);
      }
    }
  }

  for (const op of retrievalOps) {
    const items: RetrievalAdmissionItem[] = [];
    let injectedCount = 0;

    for (const res of op.results ?? []) {
      const resHash = (res.metadata?.["content_hash"] as string) || (res.content ? hashPayload(res.content) : undefined);
      const isInjected =
        contextDocIds.has(res.document_id) ||
        (res.chunk_id ? contextChunkIds.has(res.chunk_id) : false) ||
        (resHash ? contextHashes.has(resHash) : false);

      const matchedItem = itemMapByDoc.get(res.document_id) ?? (res.chunk_id ? itemMapByDoc.get(res.chunk_id) : undefined);
      const status = isInjected ? "RETRIEVED_AND_INJECTED" : "RETRIEVED_NOT_INJECTED";

      if (isInjected) {
        injectedCount++;
      }

      items.push({
        document_id: res.document_id,
        chunk_id: res.chunk_id,
        status,
        retrieval_score: res.score,
        retrieval_rank: res.rank,
        injected_context_item_id: matchedItem?.item_id,
        tokens: matchedItem?.token_estimate,
      });
    }

    const total = op.results?.length ?? 0;
    const admissionRate = total > 0 ? Number((injectedCount / total).toFixed(3)) : 0;

    analyses.push({
      operation_id: op.operation_id,
      query: op.query,
      service_name: op.service_name,
      candidates_count: total,
      injected_count: injectedCount,
      admission_rate: admissionRate,
      items,
    });
  }

  return analyses;
}

/**
 * Builds the Context Provenance Graph.
 */
export function buildContextProvenanceGraph(
  run: RunArtifact,
  snapshots: ContextSnapshot[]
): ContextProvenanceGraph {
  const nodes: ProvenanceGraphNode[] = [];
  const edges: ProvenanceGraphEdge[] = [];
  const nodeIds = new Set<string>();

  const addNode = (node: ProvenanceGraphNode) => {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id);
      nodes.push(node);
    }
  };

  // Add snapshots and items
  for (const snap of snapshots) {
    addNode({
      id: snap.snapshot_id,
      label: `Snapshot ${snap.snapshot_id}`,
      type: "context_snapshot",
      metadata: {
        step_id: snap.step_id,
        model_invocation_id: snap.model_invocation_id,
        total_tokens: snap.total_token_estimate,
      },
    });

    if (snap.model_invocation_id) {
      addNode({
        id: snap.model_invocation_id,
        label: `Model Call ${snap.model_invocation_id}`,
        type: "model_invocation",
      });
      edges.push({
        source: snap.snapshot_id,
        target: snap.model_invocation_id,
        relation: "consumed_by",
        verified: true,
      });
    }

    for (const item of snap.items) {
      addNode({
        id: item.item_id,
        label: `${item.source_type} (${item.token_estimate ?? 0} tokens)`,
        type: "context_item",
        metadata: {
          source_type: item.source_type,
          tokens: item.token_estimate,
          content_hash: item.content_hash,
        },
      });

      edges.push({
        source: item.item_id,
        target: snap.snapshot_id,
        relation: "injected_into",
        verified: true,
      });

      if (item.provenance?.document_id) {
        const docId = `doc:${item.provenance.document_id}`;
        addNode({
          id: docId,
          label: item.provenance.document_id,
          type: "source_document",
          metadata: {
            chunk_id: item.provenance.chunk_id,
            uri: item.provenance.uri,
            source_system: item.provenance.source_system,
          },
        });
        edges.push({
          source: docId,
          target: item.item_id,
          relation: "sourced_from",
          verified: true,
        });
      }
    }
  }

  // Add retrieval operations
  for (const ret of run.retrieval ?? []) {
    addNode({
      id: ret.operation_id,
      label: `Retrieval: ${ret.query.slice(0, 30)}`,
      type: "retrieval_operation",
      metadata: { service: ret.service_name, count: ret.results_count },
    });

    for (const res of ret.results ?? []) {
      const docId = `doc:${res.document_id}`;
      if (nodeIds.has(docId)) {
        edges.push({
          source: ret.operation_id,
          target: docId,
          relation: "retrieved",
          verified: true,
        });
      }
    }
  }

  // Add tool calls
  for (const b of run.boundaries ?? []) {
    if (b.boundary_type === "tool_call") {
      addNode({
        id: b.boundary_id,
        label: `Tool: ${b.name}`,
        type: "tool_action",
        metadata: { status: b.status },
      });
    }
  }

  // Add final outcome
  if (run.evidence?.final_outcome) {
    addNode({
      id: `outcome_${run.identity.run_id}`,
      label: `Outcome: ${run.evidence.final_outcome.status}`,
      type: "outcome",
      metadata: { status: run.evidence.final_outcome.status },
    });
  }

  return { nodes, edges };
}

/**
 * Main entry point: Analyzes context for a RunArtifact.
 */
export function analyzeRunContext(
  run: RunArtifact,
  options: AnalyzeContextOptions = {}
): ContextIntelligenceReport {
  const reportId = `ctx_rpt_${run.identity.run_id}_${Date.now()}`;
  const snapshots = run.context ?? [];
  const runBoundaries = run.boundaries ?? [];

  const snapshotAnalyses: ContextSnapshotAnalysis[] = [];
  const runSignals: ContextDiagnosticSignal[] = [];
  const runAblationCandidates: ContextAblationCandidate[] = [];

  let totalContextTokens = 0;
  let exactRepeatedTokens = 0;
  let totalToolDefinitionTokens = 0;
  let exactDuplicatesCount = 0;
  let provenanceGapsCount = 0;

  // Track global content hashes across snapshots to find repetitions
  const seenHashesAcrossRun = new Map<string, { count: number; tokenCount: number; firstSnapshotId: string }>();

  // 1. Decision-scoped analysis for each snapshot
  for (const snap of snapshots) {
    const composition = analyzeComposition(snap.items);
    const measurementQuality = analyzeMeasurementQuality(snap.items);
    totalContextTokens += composition.total_tokens;

    // Provenance coverage per item
    const itemCoverages: ItemProvenanceCoverage[] = [];
    let completeCount = 0;
    let partialCount = 0;
    let hashOnlyCount = 0;
    let unknownCount = 0;
    let unavailableCount = 0;

    for (const item of snap.items) {
      const cov = classifyItemProvenance(item);
      itemCoverages.push(cov);
      if (cov.classification === "COMPLETE") completeCount++;
      else if (cov.classification === "PARTIAL") partialCount++;
      else if (cov.classification === "HASH_ONLY") hashOnlyCount++;
      else if (cov.classification === "UNKNOWN_SOURCE") unknownCount++;
      else if (cov.classification === "UNAVAILABLE") unavailableCount++;
    }

    const coverageRatio = snap.items.length > 0 ? Number((completeCount / snap.items.length).toFixed(3)) : 1;
    const provenanceCoverage: ContextProvenanceCoverage = {
      coverage_ratio: coverageRatio,
      complete_count: completeCount,
      partial_count: partialCount,
      hash_only_count: hashOnlyCount,
      unknown_count: unknownCount,
      unavailable_count: unavailableCount,
      items: itemCoverages,
    };

    provenanceGapsCount += (unknownCount + hashOnlyCount);

    // Tool exposure
    const toolExposure = analyzeToolExposure(snap, run);
    totalToolDefinitionTokens += toolExposure.tool_definition_tokens;

    // Snapshot-level signals & candidate generation
    const snapSignals: ContextDiagnosticSignal[] = [];
    const snapCandidates: ContextAblationCandidate[] = [];
    const itemAnalyses: ContextItemAnalysis[] = [];

    // Check duplicate content hashes within this single snapshot
    const hashInSnapshot = new Map<string, string[]>();
    for (const item of snap.items) {
      if (item.content_hash) {
        const existing = hashInSnapshot.get(item.content_hash) ?? [];
        existing.push(item.item_id);
        hashInSnapshot.set(item.content_hash, existing);
      }
    }

    for (const [hash, itemIds] of hashInSnapshot.entries()) {
      if (itemIds.length > 1) {
        exactDuplicatesCount += (itemIds.length - 1);
        const dupItem = snap.items.find((i) => i.item_id === itemIds[1]);
        const tokens = dupItem?.token_estimate ?? 0;
        const sig: ContextDiagnosticSignal = {
          signal_id: `sig_${snap.snapshot_id}_dup_${hash.slice(0, 8)}`,
          code: "EXACT_DUPLICATE_CONTENT",
          severity: "WARNING",
          snapshot_id: snap.snapshot_id,
          item_ids: itemIds,
          token_impact: tokens * (itemIds.length - 1),
          description: `Exact duplicate content detected across ${itemIds.length} items in decision snapshot ${snap.snapshot_id}.`,
          evidence: { content_hash: hash, item_ids: itemIds, tokens_each: tokens },
          bounded_finding: `Snapshot contains ${itemIds.length} items with identical content hash (${tokens * (itemIds.length - 1)} redundant tokens).`,
        };
        snapSignals.push(sig);
        runSignals.push(sig);

        // Candidate for ablation
        for (let idx = 1; idx < itemIds.length; idx++) {
          const id = itemIds[idx]!;
          const cand: ContextAblationCandidate = {
            candidate_id: `ablate_${snap.snapshot_id}_${id}`,
            snapshot_id: snap.snapshot_id,
            item_id: id,
            source_type: dupItem?.source_type ?? "custom",
            token_savings_estimate: tokens,
            rationale: `Removes redundant duplicate context item ${id} with identical hash ${hash.slice(0, 8)}.`,
            signal_code: "EXACT_DUPLICATE_CONTENT",
            suggested_mutation: {
              mutation_type: "context_exclusion",
              target_identifier: id,
              description: `Exclude exact duplicate context item ${id}`,
            },
          };
          snapCandidates.push(cand);
          runAblationCandidates.push(cand);
        }
      }
    }

    // Inspect individual items
    for (const item of snap.items) {
      const itemSignals: ContextDiagnosticSignal["code"][] = [];
      const tokens = item.token_estimate ?? 0;
      const totalTokens = composition.total_tokens;

      // Track cross-snapshot repeats
      if (item.content_hash && tokens > 100) {
        const prior = seenHashesAcrossRun.get(item.content_hash);
        if (prior) {
          prior.count += 1;
          exactRepeatedTokens += tokens;
        } else {
          seenHashesAcrossRun.set(item.content_hash, {
            count: 1,
            tokenCount: tokens,
            firstSnapshotId: snap.snapshot_id,
          });
        }
      }

      // High token share
      if (totalTokens > 0 && tokens / totalTokens > 0.4 && tokens > 1000) {
        itemSignals.push("HIGH_TOKEN_SHARE");
        const sig: ContextDiagnosticSignal = {
          signal_id: `sig_${snap.snapshot_id}_share_${item.item_id}`,
          code: "HIGH_TOKEN_SHARE",
          severity: "INFO",
          snapshot_id: snap.snapshot_id,
          item_id: item.item_id,
          token_impact: tokens,
          description: `Item ${item.item_id} (${item.source_type}) accounts for ${((tokens / totalTokens) * 100).toFixed(1)}% of decision tokens.`,
          evidence: { tokens, total_tokens: totalTokens, share: tokens / totalTokens },
          bounded_finding: `Context item consumes ${tokens} tokens (${((tokens / totalTokens) * 100).toFixed(1)}% of decision context).`,
        };
        snapSignals.push(sig);
        runSignals.push(sig);

        // Candidate for testing
        if (item.source_type === "retrieved_document" || item.source_type === "retrieved_memory") {
          snapCandidates.push({
            candidate_id: `ablate_${snap.snapshot_id}_${item.item_id}`,
            snapshot_id: snap.snapshot_id,
            item_id: item.item_id,
            source_type: item.source_type,
            token_savings_estimate: tokens,
            rationale: `Tests execution without high token share retrieved item (${tokens} tokens).`,
            signal_code: "HIGH_TOKEN_SHARE",
            suggested_mutation: {
              mutation_type: "context_exclusion",
              target_identifier: item.item_id,
              description: `Exclude high token share context item ${item.item_id}`,
            },
          });
        }
      }

      // Low retrieval score
      const score = item.retrieval_score ?? item.provenance?.retrieval_score;
      if (score !== undefined && score < 0.5) {
        itemSignals.push("LOW_RETRIEVAL_SCORE");
        const sig: ContextDiagnosticSignal = {
          signal_id: `sig_${snap.snapshot_id}_score_${item.item_id}`,
          code: "LOW_RETRIEVAL_SCORE",
          severity: "WARNING",
          snapshot_id: snap.snapshot_id,
          item_id: item.item_id,
          token_impact: tokens,
          description: `Retrieved item ${item.item_id} entered context with provider score ${score}.`,
          evidence: { retrieval_score: score, item_id: item.item_id },
          bounded_finding: `External retrieval system assigned score ${score} (<0.50 threshold).`,
        };
        snapSignals.push(sig);
        runSignals.push(sig);

        snapCandidates.push({
          candidate_id: `ablate_${snap.snapshot_id}_${item.item_id}`,
          snapshot_id: snap.snapshot_id,
          item_id: item.item_id,
          source_type: item.source_type,
          token_savings_estimate: tokens,
          rationale: `Tests execution without low-scoring retrieved item (score: ${score}, tokens: ${tokens}).`,
          signal_code: "LOW_RETRIEVAL_SCORE",
          suggested_mutation: {
            mutation_type: "context_exclusion",
            target_identifier: item.item_id,
            description: `Exclude low-score context item ${item.item_id}`,
          },
        });
      }

      // Hash only or unavailable
      if (item.availability === "HASH_ONLY") {
        itemSignals.push("HASH_ONLY_CONTEXT");
      } else if (item.availability === "UNAVAILABLE" || item.availability === "NOT_CAPTURED") {
        itemSignals.push("UNAVAILABLE_CONTEXT");
      }

      const cov = itemCoverages.find((c) => c.item_id === item.item_id);
      if (cov && (cov.classification === "UNKNOWN_SOURCE" || cov.classification === "HASH_ONLY")) {
        itemSignals.push("PROVENANCE_GAP");
      }

      itemAnalyses.push({
        item_id: item.item_id,
        source_type: item.source_type,
        source_reference: item.source_reference,
        token_count: tokens,
        measurement_method: item.token_measurement?.method ?? "ESTIMATED",
        position: item.position,
        provenance_class: cov?.classification ?? "UNKNOWN_SOURCE",
        content_captured: item.content_captured,
        content_hash: item.content_hash,
        signals: itemSignals,
      });
    }

    // Tool definition bloat check
    if (toolExposure.tools_exposed_count >= 10 && toolExposure.tools_used_count <= 2 && toolExposure.tool_token_share_percentage > 25) {
      const sig: ContextDiagnosticSignal = {
        signal_id: `sig_${snap.snapshot_id}_tool_bloat`,
        code: "TOOL_DEFINITION_BLOAT",
        severity: "WARNING",
        snapshot_id: snap.snapshot_id,
        token_impact: toolExposure.tool_definition_tokens,
        description: `${toolExposure.tools_exposed_count} tools defined (${toolExposure.tool_definition_tokens} tokens, ${toolExposure.tool_token_share_percentage}% of context); ${toolExposure.tools_used_count} called downstream.`,
        evidence: {
          exposed: toolExposure.tools_exposed_count,
          used: toolExposure.tools_used_count,
          unused: toolExposure.unused_exposed_tools,
          tokens: toolExposure.tool_definition_tokens,
        },
        bounded_finding: `${toolExposure.unused_exposed_tools.length} unused tool schemas exposed to model decision consuming ${toolExposure.tool_definition_tokens} tokens.`,
      };
      snapSignals.push(sig);
      runSignals.push(sig);
    }

    snapshotAnalyses.push({
      snapshot_id: snap.snapshot_id,
      step_id: snap.step_id,
      model_invocation_id: snap.model_invocation_id,
      timestamp: snap.timestamp,
      composition,
      measurement_quality: measurementQuality,
      provenance_coverage: provenanceCoverage,
      tool_exposure: toolExposure,
      items: itemAnalyses,
      signals: snapSignals,
      ablation_candidates: snapCandidates,
    });
  }

  // 2. Churn Transitions
  const churnTransitions = computeContextChurn(snapshots);
  for (const trans of churnTransitions) {
    if (trans.context_churn_rate > 0.7 && (trans.tokens_added + trans.tokens_removed) > 1000) {
      runSignals.push({
        signal_id: `sig_churn_${trans.from_snapshot_id}_${trans.to_snapshot_id}`,
        code: "CONTEXT_CHURN",
        severity: "INFO",
        snapshot_id: trans.to_snapshot_id,
        token_impact: trans.tokens_added + trans.tokens_removed,
        description: `Context churn rate of ${(trans.context_churn_rate * 100).toFixed(1)}% between snapshots ${trans.from_snapshot_id} and ${trans.to_snapshot_id}.`,
        evidence: {
          from_snapshot_id: trans.from_snapshot_id,
          to_snapshot_id: trans.to_snapshot_id,
          tokens_added: trans.tokens_added,
          tokens_removed: trans.tokens_removed,
          churn_rate: trans.context_churn_rate,
        },
        bounded_finding: `Decision transition replaced ${trans.tokens_removed} tokens and added ${trans.tokens_added} tokens (churn rate ${(trans.context_churn_rate * 100).toFixed(1)}%).`,
      });
    }
  }

  // 3. Retrieval Admission Analysis
  const retrievalAdmissions = analyzeRetrievalAdmission(run.retrieval, snapshots);
  let totalCandidates = 0;
  let admittedCandidates = 0;
  for (const ra of retrievalAdmissions) {
    totalCandidates += ra.candidates_count;
    admittedCandidates += ra.injected_count;
    for (const item of ra.items) {
      if (item.status === "RETRIEVED_NOT_INJECTED") {
        runSignals.push({
          signal_id: `sig_ret_not_inj_${ra.operation_id}_${item.document_id}`,
          code: "RETRIEVED_NOT_ADMITTED",
          severity: "INFO",
          description: `Retrieved document ${item.document_id} was not admitted into model context.`,
          evidence: {
            operation_id: ra.operation_id,
            document_id: item.document_id,
            score: item.retrieval_score,
            rank: item.retrieval_rank,
          },
          bounded_finding: `Document ${item.document_id} returned by search operation ${ra.operation_id} was filtered before model context injection.`,
        });
      }
    }
  }

  // 4. Repeated context across run signal
  for (const [hash, info] of seenHashesAcrossRun.entries()) {
    if (info.count >= 3 && info.tokenCount > 300) {
      runSignals.push({
        signal_id: `sig_run_repeated_${hash.slice(0, 8)}`,
        code: "REPEATED_UNCHANGED_CONTEXT",
        severity: "INFO",
        token_impact: info.tokenCount * (info.count - 1),
        description: `Identical item repeated across ${info.count} decisions consuming ${info.tokenCount * (info.count - 1)} repeated tokens.`,
        evidence: {
          content_hash: hash,
          occurrences: info.count,
          tokens_per_occurrence: info.tokenCount,
          total_repeated_tokens: info.tokenCount * (info.count - 1),
        },
        bounded_finding: `Same context block resent across ${info.count} model calls (${info.tokenCount * (info.count - 1)} tokens re-transmitted).`,
      });
    }
  }

  // 5. Build Provenance Graph
  const provenanceGraph = buildContextProvenanceGraph(run, snapshots);

  // 6. Overall Run Summary
  const runProvenanceCoverage =
    snapshotAnalyses.length > 0
      ? Number(
          (
            snapshotAnalyses.reduce((s, a) => s + a.provenance_coverage.coverage_ratio, 0) /
            snapshotAnalyses.length
          ).toFixed(3)
        )
      : 1;

  const runSummary: ContextRunSummary = {
    total_decisions: snapshots.length,
    total_context_tokens: totalContextTokens,
    exact_repeated_tokens: exactRepeatedTokens,
    tool_definition_tokens: totalToolDefinitionTokens,
    retrieved_docs_admitted_count: admittedCandidates,
    retrieved_docs_total_count: totalCandidates,
    retrieved_docs_admission_rate: totalCandidates > 0 ? Number((admittedCandidates / totalCandidates).toFixed(3)) : 0,
    memory_items_injected_count: snapshots.reduce(
      (sum, s) => sum + s.items.filter((i) => i.source_type === "retrieved_memory").length,
      0
    ),
    provenance_coverage_ratio: runProvenanceCoverage,
    exact_duplicates_count: exactDuplicatesCount,
    provenance_gaps_count: provenanceGapsCount,
  };

  return {
    report_id: reportId,
    run_id: run.identity.run_id,
    analyzer_name: options.analyzerName ?? DEFAULT_CONTEXT_ANALYZER_NAME,
    analyzer_version: options.analyzerVersion ?? DEFAULT_CONTEXT_ANALYZER_VERSION,
    ruleset_version: options.rulesetVersion ?? DEFAULT_CONTEXT_RULESET_VERSION,
    schema_version: CONTEXT_INTELLIGENCE_SCHEMA_VERSION,
    source_artifact_schema_version: run.schema_version,
    generated_at: new Date().toISOString(),
    run_summary: runSummary,
    snapshots: snapshotAnalyses,
    churn_transitions: churnTransitions,
    retrieval_admissions: retrievalAdmissions,
    provenance_graph: provenanceGraph,
    signals: runSignals,
    ablation_candidates: runAblationCandidates,
    comparison_link_id: options.comparisonLinkId,
  };
}

export const analyzeContextRun = analyzeRunContext;
