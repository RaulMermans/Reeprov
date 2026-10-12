/**
 * Divergence Analysis & Causality Attribution Engine.
 *
 * Implements deterministic classification of execution divergences:
 * - Distinguishes First Structural Divergence vs First Meaningful Divergence.
 * - Enforces strict causality language policy:
 *     CONTROLLED_MUTATION vs CAUSALLY_SUPPORTED vs OBSERVED_DIFFERENCE vs PLAUSIBLE_CONTRIBUTOR.
 * - Leverages controlled fork advantages: isolates intentional mutations from downstream consequences.
 */

import type { RunArtifact } from "../contracts/runArtifact";
import type { ConfigurationDiff } from "../contracts/configuration";
import type {
  ComparisonAlignment,
  ComparisonDivergence,
  ComparisonDimension,
  CausalStatus,
  EvidenceDiff,
  StateDiff,
  ContextDiff,
  RetrievalDiff,
  MemoryDiff,
  MetricsDiff,
  OutcomeDiff,
} from "../contracts/comparison";
import type { ToolChange } from "./toolDiff";
import type { ModelChange } from "./modelDiff";

export interface DivergenceCollectionInput {
  baseline: RunArtifact;
  candidate: RunArtifact;
  configurationDiff: ConfigurationDiff;
  alignment: ComparisonAlignment;
  toolChanges: ToolChange[];
  modelChanges: ModelChange[];
  stateDiffs: StateDiff[];
  contextDiff?: ContextDiff;
  retrievalDiff?: RetrievalDiff;
  memoryDiff?: MemoryDiff;
  evidenceDiff: EvidenceDiff;
  metricsDiff: MetricsDiff;
  outcomeDiff: OutcomeDiff;
}

export function detectDivergences(input: DivergenceCollectionInput): {
  divergences: ComparisonDivergence[];
  first_structural_divergence?: ComparisonDivergence;
  first_meaningful_divergence?: ComparisonDivergence;
} {
  const {
    baseline,
    candidate,
    configurationDiff,
    alignment,
    toolChanges,
    modelChanges,
    stateDiffs,
    contextDiff,
    retrievalDiff,
    memoryDiff,
    evidenceDiff,
    outcomeDiff,
  } = input;

  const divergences: ComparisonDivergence[] = [];
  let divCounter = 1;

  // Check controlled mutations from fork lineage
  const controlledMutations = candidate.lineage?.mutations ?? [];
  const getMutType = (m: any) => m.mutation_type || m.type;
  const isFork = Boolean(candidate.lineage?.parent_run_id === baseline.identity.run_id);

  let initialMutationDivId: string | undefined;

  // ── 1. Configuration Divergences ───────────────────────────────────────────
  if (!configurationDiff.identical) {
    for (const summaryItem of configurationDiff.summary) {
      let dimension: ComparisonDimension = "CONFIGURATION";
      let matchedMutation = controlledMutations.find((m) =>
        (getMutType(m) === "prompt" && summaryItem.includes("prompt")) ||
        (getMutType(m) === "model" && summaryItem.includes("model")) ||
        (getMutType(m) === "tool_exposure" && summaryItem.includes("tool")) ||
        (getMutType(m) === "agent_configuration" && summaryItem.includes("agent"))
      );

      const divId = `div_cfg_${divCounter++}`;
      const causalStatus: CausalStatus = matchedMutation
        ? "CONTROLLED_MUTATION"
        : isFork
        ? "PLAUSIBLE_CONTRIBUTOR"
        : "OBSERVED_DIFFERENCE";

      if (causalStatus === "CONTROLLED_MUTATION" && !initialMutationDivId) {
        initialMutationDivId = divId;
      }

      divergences.push({
        divergence_id: divId,
        dimension,
        severity: "info",
        deterministic: true,
        confidence: 1.0,
        description: `Configuration change: ${summaryItem}`,
        evidence_refs: ["configuration_snapshot"],
        causal_status: causalStatus,
        origin_mutation_id: matchedMutation?.mutation_id,
        is_meaningful: true,
      });
    }
  }

  // ── 2. Tool Invocation Divergences ─────────────────────────────────────────
  for (const tc of toolChanges) {
    const divId = `div_tool_${divCounter++}`;
    let dimension: ComparisonDimension = "TOOL_OUTPUT";
    if (tc.change_type === "TOOL_SELECTION_CHANGED" || tc.change_type === "TOOL_ADDED" || tc.change_type === "TOOL_REMOVED") {
      dimension = "TOOL_SELECTION";
    } else if (tc.change_type === "TOOL_ARGUMENT_CHANGED") {
      dimension = "TOOL_ARGUMENT";
    }

    // Check if this tool change was an explicit intentional mutation
    const matchedMutation = controlledMutations.find(
      (m) =>
        (getMutType(m) === "tool_result_override" || getMutType(m) === "tool_exposure") &&
        (m.target_identifier === tc.tool_name || tc.description.includes(m.target_identifier))
    );

    let causalStatus: CausalStatus = "OBSERVED_DIFFERENCE";
    let originMutationId: string | undefined;
    let downstreamId: string | undefined;

    if (matchedMutation) {
      causalStatus = "CONTROLLED_MUTATION";
      originMutationId = matchedMutation.mutation_id;
      if (!initialMutationDivId) initialMutationDivId = divId;
    } else if (initialMutationDivId) {
      causalStatus = "CAUSALLY_SUPPORTED";
      downstreamId = initialMutationDivId;
    } else if (isFork) {
      causalStatus = "PLAUSIBLE_CONTRIBUTOR";
    }

    divergences.push({
      divergence_id: divId,
      dimension,
      step_id: tc.step_id,
      boundary_id: tc.boundary_id,
      baseline_evidence: tc.baseline_value ?? tc.baseline_tool,
      candidate_evidence: tc.candidate_value ?? tc.candidate_tool,
      severity: tc.change_type === "TOOL_OUTPUT_CHANGED" ? "warning" : "info",
      deterministic: true,
      confidence: 1.0,
      description: tc.description,
      evidence_refs: tc.boundary_id ? [`boundary:${tc.boundary_id}`] : ["tools"],
      causal_status: causalStatus,
      origin_mutation_id: originMutationId,
      downstream_of_divergence_id: downstreamId,
      is_meaningful: true,
    });
  }

  // ── 3. Model Invocations Divergences ───────────────────────────────────────
  for (const mc of modelChanges) {
    const divId = `div_model_${divCounter++}`;
    const dimension: ComparisonDimension =
      mc.change_type === "MODEL_INPUT_CHANGED" ? "MODEL_INPUT" : "MODEL_OUTPUT";

    let causalStatus: CausalStatus = "OBSERVED_DIFFERENCE";
    let downstreamId: string | undefined;

    if (initialMutationDivId) {
      causalStatus = "CAUSALLY_SUPPORTED";
      downstreamId = initialMutationDivId;
    } else if (isFork) {
      causalStatus = "PLAUSIBLE_CONTRIBUTOR";
    }

    divergences.push({
      divergence_id: divId,
      dimension,
      step_id: mc.step_id,
      boundary_id: mc.boundary_id,
      baseline_evidence: mc.baseline_value,
      candidate_evidence: mc.candidate_value,
      severity: "info",
      deterministic: true,
      confidence: 1.0,
      description: mc.description,
      evidence_refs: mc.boundary_id ? [`boundary:${mc.boundary_id}`] : ["models"],
      causal_status: causalStatus,
      downstream_of_divergence_id: downstreamId,
      is_meaningful: true,
    });
  }

  // ── 4. State Divergences ───────────────────────────────────────────────────
  for (const sd of stateDiffs) {
    for (const change of sd.changes) {
      const divId = `div_state_${divCounter++}`;
      const matchedMutation = controlledMutations.find(
        (m) =>
          getMutType(m) === "state_patch" &&
          (change.path.includes(m.target_identifier) || m.target_identifier.includes(change.path))
      );

      let causalStatus: CausalStatus = "OBSERVED_DIFFERENCE";
      let originMutationId: string | undefined;
      let downstreamId: string | undefined;

      if (matchedMutation) {
        causalStatus = "CONTROLLED_MUTATION";
        originMutationId = matchedMutation.mutation_id;
        if (!initialMutationDivId) initialMutationDivId = divId;
      } else if (initialMutationDivId) {
        causalStatus = "CAUSALLY_SUPPORTED";
        downstreamId = initialMutationDivId;
      } else if (isFork) {
        causalStatus = "PLAUSIBLE_CONTRIBUTOR";
      }

      divergences.push({
        divergence_id: divId,
        dimension: "STATE",
        step_id: sd.step_id,
        candidate_step_id: sd.candidate_step_id,
        baseline_evidence: change.before,
        candidate_evidence: change.after,
        severity: "info",
        deterministic: true,
        confidence: 1.0,
        description: `State change at path '${change.path}': ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`,
        evidence_refs: ["state"],
        causal_status: causalStatus,
        origin_mutation_id: originMutationId,
        downstream_of_divergence_id: downstreamId,
        is_meaningful: true,
      });
    }
  }

  // ── 5. Context Divergences ─────────────────────────────────────────────────
  if (contextDiff && !contextDiff.unavailable) {
    for (const cc of contextDiff.changes) {
      const divId = `div_ctx_${divCounter++}`;
      const matchedMutation = controlledMutations.find(
        (m) =>
          ((getMutType(m) === "context_inclusion" || getMutType(m) === "context_exclusion") &&
            (m.target_identifier === cc.item_id || m.target_identifier === cc.source_type)) ||
          ((getMutType(m) === "memory_inclusion" || getMutType(m) === "memory_exclusion") &&
            (m.target_identifier === cc.item_id ||
              cc.source_type === "retrieved_memory" ||
              cc.item_id.includes(m.target_identifier) ||
              m.target_identifier.includes(cc.item_id)))
      );

      let causalStatus: CausalStatus = "OBSERVED_DIFFERENCE";
      let originMutationId: string | undefined;
      let downstreamId: string | undefined;

      if (matchedMutation) {
        causalStatus = "CONTROLLED_MUTATION";
        originMutationId = matchedMutation.mutation_id;
        if (!initialMutationDivId) initialMutationDivId = divId;
      } else if (initialMutationDivId) {
        causalStatus = "CAUSALLY_SUPPORTED";
        downstreamId = initialMutationDivId;
      } else if (isFork) {
        causalStatus = "PLAUSIBLE_CONTRIBUTOR";
      }

      divergences.push({
        divergence_id: divId,
        dimension: "CONTEXT",
        severity: "info",
        deterministic: true,
        confidence: 1.0,
        description: `Context ${cc.change_type} for item '${cc.item_id}' (${cc.source_type})`,
        evidence_refs: ["context"],
        causal_status: causalStatus,
        origin_mutation_id: originMutationId,
        downstream_of_divergence_id: downstreamId,
        is_meaningful: true,
      });
    }
  }

  // ── 6. Retrieval Divergences ───────────────────────────────────────────────
  if (retrievalDiff) {
    for (const rc of retrievalDiff.changes) {
      const divId = `div_ret_${divCounter++}`;
      divergences.push({
        divergence_id: divId,
        dimension: "RETRIEVAL",
        severity: "info",
        deterministic: true,
        confidence: 1.0,
        description: `Retrieval ${rc.change_type}: ${rc.query_before ? `"${rc.query_before}" → "${rc.query_after}"` : rc.item_id ?? ""}`,
        evidence_refs: ["retrieval"],
        causal_status: initialMutationDivId ? "CAUSALLY_SUPPORTED" : isFork ? "PLAUSIBLE_CONTRIBUTOR" : "OBSERVED_DIFFERENCE",
        downstream_of_divergence_id: initialMutationDivId,
        is_meaningful: true,
      });
    }
  }

  // ── 7. Memory Divergences ──────────────────────────────────────────────────
  if (memoryDiff) {
    for (const mc of memoryDiff.changes) {
      const divId = `div_mem_${divCounter++}`;
      const matchedMutation = controlledMutations.find(
        (m) =>
          (m.mutation_type === "memory_exclusion" || m.mutation_type === "memory_inclusion") &&
          (m.target_identifier === mc.memory_id || m.target_identifier.startsWith(`${mc.memory_id}:`))
      );

      let causalStatus: CausalStatus = "OBSERVED_DIFFERENCE";
      let originMutationId: string | undefined;
      let downstreamId: string | undefined;

      if (matchedMutation) {
        causalStatus = "CONTROLLED_MUTATION";
        originMutationId = matchedMutation.mutation_id;
        if (!initialMutationDivId) initialMutationDivId = divId;
      } else if (initialMutationDivId) {
        causalStatus = "CAUSALLY_SUPPORTED";
        downstreamId = initialMutationDivId;
      } else if (isFork) {
        causalStatus = "PLAUSIBLE_CONTRIBUTOR";
      }

      divergences.push({
        divergence_id: divId,
        dimension: "MEMORY",
        severity: "info",
        deterministic: true,
        confidence: 1.0,
        description: `Memory ${mc.change_type} on item '${mc.memory_id ?? "unknown"}'`,
        evidence_refs: ["memory"],
        causal_status: causalStatus,
        origin_mutation_id: originMutationId,
        downstream_of_divergence_id: downstreamId,
        is_meaningful: true,
      });
    }
  }

  // ── 8. Evidence: Plan Divergences ──────────────────────────────────────────
  if (evidenceDiff.plan_diff) {
    const pd = evidenceDiff.plan_diff;
    if (pd.plan_added || pd.plan_removed || pd.status_changed || pd.changes.length > 0) {
      for (const itemChange of pd.changes) {
        const divId = `div_plan_${divCounter++}`;
        divergences.push({
          divergence_id: divId,
          dimension: "PLAN",
          severity: "info",
          deterministic: true,
          confidence: 1.0,
          description: `Plan item ${itemChange.item_id}: ${itemChange.change_type} (${itemChange.before_status ?? ""} → ${itemChange.after_status ?? ""})`,
          evidence_refs: ["evidence.plan"],
          causal_status: initialMutationDivId ? "CAUSALLY_SUPPORTED" : isFork ? "PLAUSIBLE_CONTRIBUTOR" : "OBSERVED_DIFFERENCE",
          downstream_of_divergence_id: initialMutationDivId,
          is_meaningful: true,
        });
      }
    }
  }

  // ── 9. Evidence: Tests Divergences ─────────────────────────────────────────
  for (const td of evidenceDiff.test_diffs) {
    if (td.change_type === "TEST_STATUS_CHANGED" || td.change_type === "TEST_ADDED" || td.change_type === "TEST_REMOVED") {
      const divId = `div_test_${divCounter++}`;
      divergences.push({
        divergence_id: divId,
        dimension: "TEST",
        severity: td.after_status === "FAILED" ? "error" : "info",
        deterministic: true,
        confidence: 1.0,
        description: `Test '${td.suite}:${td.name}' status: ${td.before_status ?? "none"} → ${td.after_status ?? "none"}`,
        evidence_refs: [`test:${td.test_id}`],
        causal_status: initialMutationDivId ? "CAUSALLY_SUPPORTED" : isFork ? "PLAUSIBLE_CONTRIBUTOR" : "OBSERVED_DIFFERENCE",
        downstream_of_divergence_id: initialMutationDivId,
        is_meaningful: true,
      });
    }
  }

  // ── 10. Evidence: Reviews Divergences ──────────────────────────────────────
  for (const rd of evidenceDiff.review_diffs) {
    const divId = `div_rev_${divCounter++}`;
    divergences.push({
      divergence_id: divId,
      dimension: "REVIEW",
      severity: rd.after_status === "FAILED" || rd.after_status === "CHANGES_REQUESTED" ? "warning" : "info",
      deterministic: true,
      confidence: 1.0,
      description: `Review '${rd.reviewer}' (${rd.review_type}) status: ${rd.before_status ?? "none"} → ${rd.after_status ?? "none"}`,
      evidence_refs: [`review:${rd.review_id}`],
      causal_status: initialMutationDivId ? "CAUSALLY_SUPPORTED" : isFork ? "PLAUSIBLE_CONTRIBUTOR" : "OBSERVED_DIFFERENCE",
      downstream_of_divergence_id: initialMutationDivId,
      is_meaningful: true,
    });
  }

  // ── 11. Evidence: Security & Permissions Divergences ───────────────────────
  for (const sd of evidenceDiff.security_diffs) {
    const divId = `div_sec_${divCounter++}`;
    divergences.push({
      divergence_id: divId,
      dimension: "SECURITY",
      severity: sd.severity,
      deterministic: true,
      confidence: 1.0,
      description: `Security decision: ${sd.change_type} (${sd.before_decision ?? "none"} → ${sd.after_decision ?? "none"})`,
      evidence_refs: sd.action_id ? [`action:${sd.action_id}`] : ["evidence.security_events"],
      causal_status: initialMutationDivId ? "CAUSALLY_SUPPORTED" : isFork ? "PLAUSIBLE_CONTRIBUTOR" : "OBSERVED_DIFFERENCE",
      downstream_of_divergence_id: initialMutationDivId,
      is_meaningful: true,
    });
  }

  // ── 12. Execution Step Alignment Differences ───────────────────────────────
  for (const step of alignment.aligned_steps) {
    if (step.alignment_status === "BASELINE_ONLY") {
      const divId = `div_step_${divCounter++}`;
      divergences.push({
        divergence_id: divId,
        dimension: "PLAN",
        step_id: step.baseline_step_id,
        step_name: step.name,
        severity: "info",
        deterministic: true,
        confidence: step.alignment_confidence,
        description: `Step '${step.name}' was executed in baseline only`,
        evidence_refs: [`step:${step.baseline_step_id}`],
        causal_status: isFork ? "CAUSALLY_SUPPORTED" : "OBSERVED_DIFFERENCE",
        is_meaningful: true,
      });
    } else if (step.alignment_status === "CANDIDATE_ONLY") {
      const divId = `div_step_${divCounter++}`;
      divergences.push({
        divergence_id: divId,
        dimension: "PLAN",
        candidate_step_id: step.candidate_step_id,
        step_name: step.name,
        severity: "info",
        deterministic: true,
        confidence: step.alignment_confidence,
        description: `Step '${step.name}' was executed in candidate only`,
        evidence_refs: [`step:${step.candidate_step_id}`],
        causal_status: isFork ? "CAUSALLY_SUPPORTED" : "OBSERVED_DIFFERENCE",
        is_meaningful: true,
      });
    } else if (step.alignment_status === "AMBIGUOUS") {
      const divId = `div_step_${divCounter++}`;
      divergences.push({
        divergence_id: divId,
        dimension: "PLAN",
        step_id: step.baseline_step_id,
        candidate_step_id: step.candidate_step_id,
        step_name: step.name,
        severity: "warning",
        deterministic: true,
        confidence: step.alignment_confidence,
        description: `Ambiguous step alignment for '${step.name}'`,
        evidence_refs: [],
        causal_status: "OBSERVED_DIFFERENCE",
        is_meaningful: false,
      });
    }
  }

  // ── 13. Outcome Divergence ─────────────────────────────────────────────────
  if (outcomeDiff.status_changed) {
    const divId = `div_out_${divCounter++}`;
    divergences.push({
      divergence_id: divId,
      dimension: "OUTCOME",
      severity: outcomeDiff.candidate_status === "SUCCESS" ? "info" : "critical",
      deterministic: true,
      confidence: 1.0,
      description: `Run outcome changed: ${outcomeDiff.baseline_status} → ${outcomeDiff.candidate_status}`,
      evidence_refs: ["evidence.final_outcome"],
      causal_status: initialMutationDivId ? "CAUSALLY_SUPPORTED" : isFork ? "PLAUSIBLE_CONTRIBUTOR" : "OBSERVED_DIFFERENCE",
      downstream_of_divergence_id: initialMutationDivId,
      is_meaningful: true,
    });
  }

  // ── Causal Linking Pass for Controlled Forks ─────────────────────────────
  const rootControlledDiv = divergences.find((d) => d.causal_status === "CONTROLLED_MUTATION");
  if (rootControlledDiv && isFork) {
    for (const d of divergences) {
      if (d.divergence_id !== rootControlledDiv.divergence_id && d.causal_status !== "CONTROLLED_MUTATION") {
        d.causal_status = "CAUSALLY_SUPPORTED";
        if (!d.downstream_of_divergence_id) {
          d.downstream_of_divergence_id = rootControlledDiv.divergence_id;
        }
      }
    }
  }

  // ── First Structural vs First Meaningful Divergence ────────────────────────
  const firstStructural = divergences.length > 0 ? divergences[0] : undefined;
  const firstMeaningful = divergences.find((d) => d.is_meaningful);

  return {
    divergences,
    first_structural_divergence: firstStructural,
    first_meaningful_divergence: firstMeaningful,
  };
}
