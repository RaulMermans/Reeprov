# Architecture: Context Intelligence Runtime

## 1. Overview and Invariant Principles

AgentPulse Context Intelligence observes, reconstructs, audits, and analyzes what an agent knew at every individual decision point.

### Non-Negotiable Invariants
1. **Decision-Scoped Analysis:** Prompts and context items are evaluated per decision (`step_id`, `model_invocation_id`, `snapshot_id`). Aggregating all run context into a single undifferentiated pool is strictly forbidden; run-level summaries are derived only after decision-scoped analysis.
2. **Read-Only / Derived Boundary:** Context Intelligence produces `ContextIntelligenceReport` objects. It **never** mutates the immutable baseline `RunArtifact` or underlying `ContextSnapshot` records.
3. **Capture Truth Semantics:**
   - `content_captured = true` ONLY when raw or redacted content is accessible.
   - For `HASH_ONLY`, `NOT_CAPTURED`, or `UNAVAILABLE`, `content_captured = false`.
4. **Token Measurement Provenance:** Token values expose exact provenance via `TokenMeasurement`:
   - `PROVIDER_REPORTED`: Provided directly by the model provider API.
   - `TOKENIZER_COUNTED`: Counted by a local deterministic tokenizer.
   - `ESTIMATED`: Fallback approximation (e.g. chars/4).
   - `UNKNOWN`: No measurement available.
5. **Private Reasoning Contract:** `generated_intermediate_context` strictly denotes observable intermediate summaries, scratchpad plans, drafts, or application-emitted artifacts. It **never** denotes private model chain-of-thought.

---

## 2. Runtime Pipeline

```
  RunArtifact (Evidence)
         │
         ▼
  ┌────────────────────────────────────────────────────────┐
  │              ContextAnalyzer Runtime                   │
  │  1. Extract & Index Snapshots (Decision-Scoped)        │
  │  2. Compute Decision Composition & Measurement Quality │
  │  3. Track Exact Duplicate Hashes & Repetitions         │
  │  4. Compute Consecutive Churn Transitions (N → N+1)    │
  │  5. Audit Retrieval Admission (Retrieved vs Admitted)  │
  │  6. Calculate Tool Exposure Cost & Schema Bloat        │
  │  7. Generate Deterministic Diagnostic Signals          │
  │  8. Identify Controlled Ablation Candidates            │
  └────────────────────────────────────────────────────────┘
         │
         ▼
  ContextIntelligenceReport (Derived Analysis)
```

---

## 3. Composition & Token Measurement

For every `ContextSnapshot`, the analyzer calculates:
- `total_tokens` and token measurement quality distribution.
- Tokens, percentages, and item counts by `source_type` (`system_policy`, `agent_instructions`, `prompt`, `conversation`, `retrieved_document`, `retrieved_memory`, `tool_definition`, `state`, `generated_intermediate_context`, `other`).
- Availability breakdown (`captured_tokens`, `hash_only_tokens`, `unavailable_tokens`).
- Provenance coverage classification (`COMPLETE`, `PARTIAL`, `HASH_ONLY`, `UNKNOWN_SOURCE`, `UNAVAILABLE`).

---

## 4. Churn Transitions

Consecutive context transitions ($S_N \to S_{N+1}$) record:
- $\text{tokens\_retained}$: Identical item hashes present in both snapshots.
- $\text{tokens\_added}$: New item hashes appearing in $S_{N+1}$.
- $\text{tokens\_removed}$: Item hashes present in $S_N$ but omitted in $S_{N+1}$.
- $\text{context\_churn\_rate}$: $\frac{\text{added} + \text{removed} + \text{changed}}{\max(\text{tokens}_N, \text{tokens}_{N+1})}$.

---

## 5. Tool Exposure Intelligence

Tool schemas occupy prompt token budget whether invoked or not:
- Measures exposed tools count and tokens.
- Compares with downstream boundary calls (`tools_used_downstream`).
- Detects unused exposed tools and flags `TOOL_DEFINITION_BLOAT` when definitions consume substantial context with low invocation efficiency.

---

## 6. Diagnostic Signals vs. Causality

Diagnostic signals (`EXACT_DUPLICATE_CONTENT`, `TOOL_DEFINITION_BLOAT`, `RETRIEVED_NOT_ADMITTED`, `STALE_BY_EXPLICIT_TIMESTAMP`, etc.) are deterministic facts and hypotheses. They flag candidate areas for controlled ablation; they never unilaterally declare context useless without experimental proof.
