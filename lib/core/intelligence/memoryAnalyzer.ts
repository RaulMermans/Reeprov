/**
 * Deterministic Memory Intelligence Engine.
 *
 * Implements external memory observability analysis, lifecycle graph reconstruction,
 * retrieval-to-context injection tracking, stale and superseded memory detection,
 * and bounded diagnostic signal generation.
 *
 * Invariant:
 * Pure derived analysis. Does NOT mutate or delete external memories.
 */

import type { RunArtifact } from "../contracts/runArtifact";
import type { MemoryOperation, MemoryReference, MemoryCategory } from "../contracts/memory";
import type { ContextSnapshot, ContextItem } from "../contracts/context";
import {
  type MemoryIntelligenceReport,
  type MemoryLifecycle,
  type MemoryLifecycleNode,
  type MemoryLifecycleEdge,
  type MemoryInjectionRecord,
  type MemoryDiagnosticSignal,
  type MemoryImpactEvidence,
  type MemoryAblationCandidate,
  type MemoryOperationsSummary,
  type MemoryRetrievalSummary,
  DEFAULT_MEMORY_ANALYZER_NAME,
  DEFAULT_MEMORY_ANALYZER_VERSION,
  DEFAULT_MEMORY_RULESET_VERSION,
  MEMORY_INTELLIGENCE_SCHEMA_VERSION,
} from "../contracts/memoryIntelligence";

export interface AnalyzeMemoryOptions {
  analyzerName?: string;
  analyzerVersion?: string;
  rulesetVersion?: string;
}

/**
 * Extracts a stable identity key for a memory operation without relying primarily on array position.
 */
export function getMemoryOpKey(op: MemoryOperation, fallbackIndex: number): string {
  if (op.memory_id) return op.memory_id;
  if (op.provider_record_id) return `prov:${op.provider_record_id}`;
  if (op.context_injection_linkage?.context_item_id) return `item:${op.context_injection_linkage.context_item_id}`;
  if (op.operation_id) return `op:${op.operation_id}`;
  return `idx:${fallbackIndex}`;
}

/**
 * Reconstructs the observable lifecycle graph for memories in a run.
 */
export function buildMemoryLifecycles(
  operations: MemoryOperation[],
  references: MemoryReference[] = []
): Map<string, MemoryLifecycle> {
  const lifecycles = new Map<string, MemoryLifecycle>();

  // Initialize from references if available
  for (const ref of references) {
    const existing = lifecycles.get(ref.memory_id);
    if (!existing) {
      lifecycles.set(ref.memory_id, {
        memory_id: ref.memory_id,
        category: ref.category,
        current_version: ref.version,
        versions_seen: ref.version ? [ref.version] : [],
        nodes: [],
        edges: [],
        is_superseded: false,
      });
    } else {
      if (ref.version && !existing.versions_seen.includes(ref.version)) {
        existing.versions_seen.push(ref.version);
        existing.current_version = ref.version;
      }
    }
  }

  // Process operations in causal order
  operations.forEach((op, idx) => {
    const memId = op.memory_id || op.provider_record_id || `anon_mem_${idx}`;
    let lifecycle = lifecycles.get(memId);
    if (!lifecycle) {
      lifecycle = {
        memory_id: memId,
        provider: op.provider,
        category: op.memory_type,
        current_version: op.version ?? op.memory_version_id,
        versions_seen: [],
        nodes: [],
        edges: [],
        is_superseded: false,
        created_at: op.timestamps.created_at || op.timestamps.operation_at,
      };
      lifecycles.set(memId, lifecycle);
    }

    const version = op.version ?? op.memory_version_id;
    if (version && !lifecycle.versions_seen.includes(version)) {
      lifecycle.versions_seen.push(version);
      if (
        op.operation_type === "committed_write" ||
        op.operation_type === "update" ||
        op.operation_type === "supersede" ||
        !lifecycle.current_version
      ) {
        lifecycle.current_version = version;
      }
    }

    const nodeId = `node_${op.operation_id}`;
    const node: MemoryLifecycleNode = {
      node_id: nodeId,
      memory_id: memId,
      version,
      operation_id: op.operation_id,
      operation_type: op.operation_type,
      timestamp: op.timestamps.operation_at,
      step_id: op.step_id,
      content_hash: op.content_hash,
      summary_preview: op.source_provenance || (op.details?.["summary"] as string | undefined),
      category: op.memory_type,
      provider: op.provider,
      evidence_status: "OBSERVED",
    };
    lifecycle.nodes.push(node);

    // Link previous node in the same lifecycle if applicable
    if (lifecycle.nodes.length > 1) {
      const prevNode = lifecycle.nodes[lifecycle.nodes.length - 2]!;
      let relation: MemoryLifecycleEdge["relation"] = "updated_to";
      if (op.operation_type === "write_proposal") relation = "proposed_as";
      else if (op.operation_type === "committed_write") relation = "committed_from";
      else if (op.operation_type === "consolidation") relation = "consolidated_into";
      else if (op.operation_type === "supersede") relation = "superseded_by";
      else if (op.operation_type === "retrieval") relation = "retrieved_for";

      lifecycle.edges.push({
        source_node_id: prevNode.node_id,
        target_node_id: nodeId,
        relation,
        status: "OBSERVED",
      });
    }

    // Check explicit supersede
    if (op.operation_type === "supersede" || op.superseded_by_memory_id) {
      lifecycle.is_superseded = true;
      lifecycle.superseded_by = op.superseded_by_memory_id;
    }

    if (op.supersedes_memory_id) {
      const older = lifecycles.get(op.supersedes_memory_id);
      if (older) {
        older.is_superseded = true;
        older.superseded_by = memId;
      }
    }
  });

  return lifecycles;
}

/**
 * Analyzes memory retrieval to context injection flow.
 */
export function analyzeMemoryInjections(
  run: RunArtifact,
  lifecycles: Map<string, MemoryLifecycle>
): {
  injections: MemoryInjectionRecord[];
  diagnostics: MemoryDiagnosticSignal[];
  candidates: MemoryAblationCandidate[];
} {
  const injections: MemoryInjectionRecord[] = [];
  const diagnostics: MemoryDiagnosticSignal[] = [];
  const candidates: MemoryAblationCandidate[] = [];

  const memoryOps = run.memory?.operations ?? [];
  const snapshots = run.context ?? [];

  // Index context items by item_id and by memory_id
  const contextItemMap = new Map<string, { item: ContextItem; snapshot: ContextSnapshot }>();
  for (const snap of snapshots) {
    for (const item of snap.items) {
      contextItemMap.set(item.item_id, { item, snapshot: snap });
    }
  }

  // Find all memory injections
  // 1. Through explicit context_injection_linkage on memory operations
  for (const op of memoryOps) {
    if (op.context_injection_linkage) {
      const { context_item_id, context_snapshot_id } = op.context_injection_linkage;
      const found = contextItemMap.get(context_item_id);

      if (!found) {
        diagnostics.push({
          signal_id: `sig_broken_link_${op.operation_id}`,
          code: "MEMORY_CONTEXT_LINK_BROKEN",
          severity: "WARNING",
          memory_id: op.memory_id,
          operation_id: op.operation_id,
          context_item_id,
          description: `Memory operation ${op.operation_id} links to context item ${context_item_id} which does not exist in run context.`,
          evidence: { operation_id: op.operation_id, linked_item_id: context_item_id },
          bounded_finding: `Declared context link references missing context item ${context_item_id}.`,
        });
        continue;
      }

      const { item, snapshot } = found;
      const memId = op.memory_id || "unspecified";
      const lifecycle = lifecycles.get(memId);

      // Check staleness
      let isStale = false;
      let staleReason: string | undefined;

      if (lifecycle?.is_superseded) {
        isStale = true;
        staleReason = `Memory ${memId} was explicitly marked superseded by ${lifecycle.superseded_by ?? "a newer record"}.`;
        diagnostics.push({
          signal_id: `sig_superseded_ret_${op.operation_id}`,
          code: "MEMORY_SUPERSEDED_BUT_RETRIEVED",
          severity: "WARNING",
          memory_id: memId,
          operation_id: op.operation_id,
          context_item_id,
          token_impact: item.token_estimate,
          description: `Superseded memory ${memId} was retrieved and injected into context.`,
          evidence: { memory_id: memId, superseded_by: lifecycle.superseded_by, tokens: item.token_estimate },
          bounded_finding: `Memory record ${memId} was marked superseded prior to context injection.`,
        });

        candidates.push({
          candidate_id: `ablate_mem_${memId}_${context_item_id}`,
          memory_id: memId,
          memory_version: op.version,
          linked_context_item_id: context_item_id,
          token_savings_estimate: item.token_estimate,
          rationale: `Removes superseded memory ${memId} from context (${item.token_estimate ?? 0} tokens).`,
          signal_code: "MEMORY_SUPERSEDED_BUT_RETRIEVED",
          suggested_mutation: {
            mutation_type: "memory_exclusion",
            target_identifier: memId,
            description: `Exclude superseded memory ${memId}`,
          },
        });
      } else if (
        lifecycle?.current_version &&
        op.version &&
        lifecycle.current_version !== op.version
      ) {
        isStale = true;
        staleReason = `Injected version ${op.version} is older than current version ${lifecycle.current_version}.`;
        diagnostics.push({
          signal_id: `sig_old_version_${op.operation_id}`,
          code: "MEMORY_OLD_VERSION_INJECTED",
          severity: "WARNING",
          memory_id: memId,
          operation_id: op.operation_id,
          context_item_id,
          token_impact: item.token_estimate,
          description: `Memory version ${op.version} injected while current version is ${lifecycle.current_version}.`,
          evidence: { memory_id: memId, injected_version: op.version, current_version: lifecycle.current_version },
          bounded_finding: `Version mismatch: injected memory version ${op.version} has been superseded by ${lifecycle.current_version}.`,
        });

        candidates.push({
          candidate_id: `ablate_mem_${memId}_${context_item_id}`,
          memory_id: memId,
          memory_version: op.version,
          linked_context_item_id: context_item_id,
          token_savings_estimate: item.token_estimate,
          rationale: `Tests execution without stale memory version ${op.version} (${item.token_estimate ?? 0} tokens).`,
          signal_code: "MEMORY_OLD_VERSION_INJECTED",
          suggested_mutation: {
            mutation_type: "memory_exclusion",
            target_identifier: memId,
            description: `Exclude stale memory version ${memId}:${op.version}`,
          },
        });
      }

      // Check downstream tool calls
      const downstreamTools: string[] = [];
      for (const b of run.boundaries ?? []) {
        if (b.boundary_type === "tool_call") {
          downstreamTools.push(b.name);
        }
      }

      injections.push({
        injection_id: `inj_${op.operation_id}_${context_item_id}`,
        memory_id: memId,
        provider: op.provider,
        memory_version: op.version,
        category: op.memory_type,
        retrieval_operation_id: op.operation_id,
        retrieval_query: op.query,
        retrieval_score: op.score,
        retrieval_rank: op.rank,
        context_snapshot_id: snapshot.snapshot_id,
        context_item_id,
        model_invocation_id: snapshot.model_invocation_id,
        step_id: snapshot.step_id,
        injected_tokens: item.token_estimate,
        content_preview: item.content?.slice(0, 100),
        content_hash: item.content_hash,
        is_stale_at_injection: isStale,
        stale_reason: staleReason,
        downstream_tool_calls: downstreamTools,
        outcome_status: run.evidence?.final_outcome?.status,
      });

      diagnostics.push({
        signal_id: `sig_mem_injected_${op.operation_id}`,
        code: "MEMORY_INJECTED",
        severity: "INFO",
        memory_id: memId,
        operation_id: op.operation_id,
        context_item_id,
        token_impact: item.token_estimate,
        description: `Memory ${memId} (${item.token_estimate ?? 0} tokens) injected into decision snapshot ${snapshot.snapshot_id}.`,
        evidence: { memory_id: memId, snapshot_id: snapshot.snapshot_id, tokens: item.token_estimate },
        bounded_finding: `Memory ${memId} admitted into model decision context.`,
      });

      if (!candidates.some((c) => c.memory_id === memId && c.linked_context_item_id === context_item_id)) {
        candidates.push({
          candidate_id: `ablate_mem_${memId}_${context_item_id}`,
          memory_id: memId,
          memory_version: op.version,
          linked_context_item_id: context_item_id,
          token_savings_estimate: item.token_estimate,
          rationale: `Tests execution without injected memory ${memId} (${item.token_estimate ?? 0} tokens).`,
          signal_code: "MEMORY_INJECTED",
          suggested_mutation: {
            mutation_type: "memory_exclusion",
            target_identifier: memId,
            description: `Exclude memory ${memId}`,
          },
        });
      }
    } else if (op.operation_type === "retrieval") {
      // Retrieval that was NOT injected
      diagnostics.push({
        signal_id: `sig_mem_ret_not_inj_${op.operation_id}`,
        code: "MEMORY_RETRIEVED_NOT_INJECTED",
        severity: "INFO",
        memory_id: op.memory_id,
        operation_id: op.operation_id,
        description: `Memory ${op.memory_id ?? "unknown"} was retrieved but never linked or admitted to model context.`,
        evidence: { operation_id: op.operation_id, query: op.query, score: op.score },
        bounded_finding: `Retrieved memory was not injected into any recorded decision context snapshot.`,
      });
    }
  }

  // 2. Scan context snapshots directly for unlinked retrieved_memory items
  for (const snap of snapshots) {
    for (const item of snap.items) {
      if (item.source_type === "retrieved_memory") {
        const memId =
          item.provenance?.document_id ||
          (item.metadata?.["memory_id"] as string) ||
          item.source_reference ||
          `mem_${item.item_id}`;

        const alreadyRecorded = injections.some((inj) => inj.context_item_id === item.item_id);
        if (!alreadyRecorded) {
          const lifecycle = lifecycles.get(memId);
          injections.push({
            injection_id: `inj_ctx_${item.item_id}`,
            memory_id: memId,
            provider: item.provenance?.source_system || (item.metadata?.["provider"] as string),
            memory_version: item.version,
            category: (item.metadata?.["category"] as MemoryCategory) || "semantic",
            context_snapshot_id: snap.snapshot_id,
            context_item_id: item.item_id,
            model_invocation_id: snap.model_invocation_id,
            step_id: snap.step_id,
            injected_tokens: item.token_estimate,
            content_preview: item.content?.slice(0, 100),
            content_hash: item.content_hash,
            is_stale_at_injection: Boolean(lifecycle?.is_superseded),
            stale_reason: lifecycle?.is_superseded ? `Memory ${memId} is marked superseded.` : undefined,
            downstream_tool_calls: [],
            outcome_status: run.evidence?.final_outcome?.status,
          });

          // Also candidate for ablation
          candidates.push({
            candidate_id: `ablate_mem_${memId}_${item.item_id}`,
            memory_id: memId,
            memory_version: item.version,
            linked_context_item_id: item.item_id,
            token_savings_estimate: item.token_estimate,
            rationale: `Tests execution without injected memory ${memId} (${item.token_estimate ?? 0} tokens).`,
            signal_code: "MEMORY_INJECTED",
            suggested_mutation: {
              mutation_type: "memory_exclusion",
              target_identifier: memId,
              description: `Exclude memory ${memId}`,
            },
          });
        }
      }
    }
  }

  return { injections, diagnostics, candidates };
}

/**
 * Main entry point: Analyzes Memory Intelligence for a RunArtifact.
 */
export function analyzeRunMemory(
  run: RunArtifact,
  options: AnalyzeMemoryOptions = {}
): MemoryIntelligenceReport {
  const reportId = `mem_rpt_${run.identity.run_id}_${Date.now()}`;
  const memoryOps = run.memory?.operations ?? [];
  const memoryRefs = run.memory?.references ?? [];

  // 1. Build Lifecycle Graphs
  const lifecycleMap = buildMemoryLifecycles(memoryOps, memoryRefs);
  const lifecycles = Array.from(lifecycleMap.values());

  // 2. Injections, Diagnostics, and Candidates
  const { injections, diagnostics, candidates } = analyzeMemoryInjections(run, lifecycleMap);

  // 3. Detect duplicate memories (exact content hash across distinct IDs)
  const hashToMemories = new Map<string, string[]>();
  for (const op of memoryOps) {
    if (op.content_hash && op.memory_id) {
      const existing = hashToMemories.get(op.content_hash) ?? [];
      if (!existing.includes(op.memory_id)) {
        existing.push(op.memory_id);
      }
      hashToMemories.set(op.content_hash, existing);
    }
  }

  for (const [hash, memIds] of hashToMemories.entries()) {
    if (memIds.length > 1) {
      diagnostics.push({
        signal_id: `sig_mem_dup_${hash.slice(0, 8)}`,
        code: "MEMORY_EXACT_DUPLICATE",
        severity: "WARNING",
        description: `Exact duplicate memory content observed under distinct memory IDs: ${memIds.join(", ")}.`,
        evidence: { content_hash: hash, memory_ids: memIds },
        bounded_finding: `Records ${memIds.join(", ")} share identical content hash ${hash.slice(0, 8)} (EXACT_DUPLICATE_CANDIDATE).`,
      });
    }
  }

  // Detect repeated retrievals of the same memory
  const retrievalCounts = new Map<string, number>();
  for (const op of memoryOps) {
    if (op.operation_type === "retrieval" && op.memory_id) {
      const c = (retrievalCounts.get(op.memory_id) ?? 0) + 1;
      retrievalCounts.set(op.memory_id, c);
    }
  }
  for (const [mId, c] of retrievalCounts.entries()) {
    if (c > 1) {
      diagnostics.push({
        signal_id: `sig_mem_repeat_ret_${mId}`,
        code: "MEMORY_EXACT_DUPLICATE",
        severity: "INFO",
        memory_id: mId,
        description: `Memory ${mId} retrieved ${c} times across run.`,
        evidence: { memory_id: mId, count: c },
        bounded_finding: `Memory ${mId} was retrieved ${c} times across execution trajectory.`,
      });
    }
  }

  // 4. Detect write failures or rejections
  for (const op of memoryOps) {
    if (op.outcome === "rejected") {
      diagnostics.push({
        signal_id: `sig_write_rej_${op.operation_id}`,
        code: "MEMORY_WRITE_REJECTED",
        severity: "WARNING",
        memory_id: op.memory_id,
        operation_id: op.operation_id,
        description: `Memory write proposal ${op.operation_id} was rejected.`,
        evidence: { operation_id: op.operation_id, details: op.details },
        bounded_finding: `Memory write proposal rejected before commit.`,
      });
    } else if (op.outcome === "failed") {
      diagnostics.push({
        signal_id: `sig_write_fail_${op.operation_id}`,
        code: "MEMORY_WRITE_FAILED",
        severity: "CRITICAL",
        memory_id: op.memory_id,
        operation_id: op.operation_id,
        description: `Memory operation ${op.operation_id} failed.`,
        evidence: { operation_id: op.operation_id, details: op.details },
        bounded_finding: `External memory operation failed to persist.`,
      });
    }

    if (op.operation_type === "consolidation" && op.consolidated_from_memory_ids.length === 0 && op.parent_memory_ids.length === 0) {
      diagnostics.push({
        signal_id: `sig_cons_untrace_${op.operation_id}`,
        code: "MEMORY_CONSOLIDATION_UNTRACEABLE",
        severity: "INFO",
        memory_id: op.memory_id,
        operation_id: op.operation_id,
        description: `Consolidation operation ${op.operation_id} did not record source memory IDs.`,
        evidence: { operation_id: op.operation_id },
        bounded_finding: `Consolidation provenance gap: source memory records unlisted.`,
      });
    }
  }

  // 5. Operations Summary
  const byType: Record<string, number> = {};
  let readsCount = 0;
  let writesCount = 0;
  let updatesCount = 0;
  let supersedesCount = 0;
  let consolidationsCount = 0;
  let extractionsCount = 0;
  let writeFailuresCount = 0;
  let retrievalsCount = 0;

  for (const op of memoryOps) {
    byType[op.operation_type] = (byType[op.operation_type] ?? 0) + 1;
    if (op.operation_type === "read") readsCount++;
    else if (op.operation_type === "committed_write") writesCount++;
    else if (op.operation_type === "update") updatesCount++;
    else if (op.operation_type === "supersede") supersedesCount++;
    else if (op.operation_type === "consolidation") consolidationsCount++;
    else if (op.operation_type === "extraction") extractionsCount++;
    else if (op.operation_type === "retrieval") retrievalsCount++;

    if (op.outcome === "failed" || op.outcome === "rejected") {
      writeFailuresCount++;
    }
  }

  const operationsSummary: MemoryOperationsSummary = {
    total_operations: memoryOps.length,
    by_type: byType,
    unique_memories_observed: lifecycles.length,
    reads_count: readsCount,
    writes_committed_count: writesCount,
    updates_count: updatesCount,
    supersedes_count: supersedesCount,
    consolidations_count: consolidationsCount,
    extractions_count: extractionsCount,
    write_failures_count: writeFailuresCount,
  };

  // 6. Retrieval Summary
  const memoriesRetrievedCount = retrievalsCount;
  const memoriesInjectedCount = injections.length;
  const admissionRate = memoriesRetrievedCount > 0 ? Number(Math.min(1, memoriesInjectedCount / memoriesRetrievedCount).toFixed(3)) : 1;

  const retrievalSummary: MemoryRetrievalSummary = {
    total_retrieval_ops: retrievalsCount,
    memories_retrieved_count: memoriesRetrievedCount,
    memories_injected_count: memoriesInjectedCount,
    admission_rate: admissionRate,
    superseded_retrieved_count: injections.filter((i) => i.is_stale_at_injection).length,
    stale_versions_retrieved_count: diagnostics.filter((d) => d.code === "MEMORY_OLD_VERSION_INJECTED").length,
  };

  // 7. Formulate bounded Impact Evidence
  const impactEvidence: MemoryImpactEvidence[] = [];
  for (const inj of injections) {
    impactEvidence.push({
      memory_id: inj.memory_id,
      memory_version: inj.memory_version,
      evidence_level: "CORRELATED",
      injected_into_snapshot_id: inj.context_snapshot_id,
      context_tokens: inj.injected_tokens,
      observed_behavior: `Injected into decision ${inj.context_snapshot_id}; run finished with status ${inj.outcome_status ?? "completed"}.`,
      notes: "Observation is correlated. Controlled counterfactual ablation required to demonstrate causal necessity or sufficiency.",
    });
  }

  return {
    report_id: reportId,
    run_id: run.identity.run_id,
    analyzer_name: options.analyzerName ?? DEFAULT_MEMORY_ANALYZER_NAME,
    analyzer_version: options.analyzerVersion ?? DEFAULT_MEMORY_ANALYZER_VERSION,
    ruleset_version: options.rulesetVersion ?? DEFAULT_MEMORY_RULESET_VERSION,
    schema_version: MEMORY_INTELLIGENCE_SCHEMA_VERSION,
    source_artifact_schema_version: run.schema_version,
    generated_at: new Date().toISOString(),
    operations_summary: operationsSummary,
    retrieval_summary: retrievalSummary,
    injections,
    lifecycles,
    diagnostics,
    impact_evidence: impactEvidence,
    ablation_candidates: candidates,
  };
}

export const analyzeMemoryRun = analyzeRunMemory;
