# Product Surface: Memory Intelligence

> **Canonical Role:** Neutral observability, lifecycle auditing, and downstream impact analysis for AI agent memory systems.

---

## 1. Job to Be Done

When agents leverage persistent memory (e.g. Mem0, Letta/MemGPT, Zep, Cognee, or custom databases), bugs frequently occur when incorrect memories are extracted, stale memories override recent facts, or irrelevant memories pollute reasoning.

Memory Intelligence enables developers to:
1. Audit memory operations across all categories (working, episodic, semantic, procedural).
2. Inspect the lifecycle of memories: when were they proposed, written, updated, superseded, or deleted?
3. Track context injection linkage: verify which memory operations resulted in context items fed to subsequent model decisions.
4. Assess downstream effect: determine whether recalling a specific memory improved or poisoned a subsequent tool choice or answer.
5. Trace consolidation lineage: understand how raw conversation turns were compressed into semantic rules or episodic summaries.
6. Design future memory ablation experiments: test whether removing or pre-seeding a memory improves task success.

---

## 2. Data Required

- **`MemoryOperation[]`:**
  - `operation_type`: `read`, `write_proposal`, `committed_write`, `update`, `supersede`, `delete`, `extraction`, `consolidation`, `retrieval`.
  - `memory_type`: `working`, `episodic`, `semantic`, `procedural`.
  - `provider`: Underlying memory backend (e.g. `mem0`, `letta`, `custom_pg`).
  - `query`, `score`, `rank`: Retrieval queries and relevance scores.
  - `timestamps`: Creation, update, and operation timestamps.
  - `outcome`: `success`, `rejected`, `not_found`, `failed`.
  - `context_injection_linkage`: Linkage to `context_item_id` and `context_snapshot_id`.
  - `originating_run_id`, `originating_step_id`: Cross-run memory provenance.
- **`MemoryReference[]`:**
  - Stable memory IDs, categories, keys, summaries, and content hashes.

---

## 3. Primary Views

- **Memory Operation Timeline:** Chronological stream of memory reads, writes, consolidations, and deletes synchronized with the execution trajectory.
- **Context Injection Flow:** Visual diagram illustrating how memory retrieval flowed into prompt context snapshots and affected subsequent model decisions.
- **Memory Evolution & Lineage Tree:** Shows the lifecycle of a memory key over time (initial write $\rightarrow$ update $\rightarrow$ consolidation $\rightarrow$ superseding $\rightarrow$ deletion).
- **Memory Impact Inspector:** Correlates injected memories with eval pass/fail rates to highlight potentially toxic or misleading memories.
- **Memory System Health Panel:** Aggregate stats on retrieval hit rates, query latencies, rejection counts, and memory pool size.

---

## 4. Primary Actions

- **Inspect Memory Detail:** View exact key, payload summary, provider, and provenance for any memory operation.
- **Trace to Context:** Jump from a memory read operation directly to the `ContextItem` it populated.
- **Trace to Originating Run:** Navigate back to the historical run where a long-term memory was initially committed.
- **Create Memory Ablation Experiment:** Send a `memory_exclusion` mutation to Experiment Lab to test execution without the suspect memory.
- **Flag Poisoned Memory:** Mark an erroneous memory for external cleanup or deletion in the external memory provider.

---

## 5. Dependencies

- Canonical `MemoryOperation` and `MemoryReference` contracts.
- Linkage to `ContextSnapshot`, `ContextItem`, and `ExecutionStep`.

---

## 6. Non-Goals

- **Built-in Memory Database:** Reeprov does not store, index, or manage long-term agent memory. It is purely an observability layer.
- **Autonomous Memory Optimization:** Reeprov does not unilaterally delete or overwrite memories in external memory engines.
- **Memory Schema Enforcement:** Does not mandate an external memory data model; adapts neutrally to any provider.

---

## 7. Future Evals

- `memory`: Precision, recall, and hallucination rate of memory extraction and consolidation.
- `source_grounding`: Consistency of recalled memories with historical source evidence.
- `safety`: Guard against sensitive data leakage into long-term memory.

---

## 8. Risks

- **Cross-Run State Linkage:** Tracking memories across thousands of historical runs requires robust correlation IDs. Mitigation: capture `originating_run_id` and stable external `memory_id`.
- **Sensitive Data in Memories:** Long-term memories may contain user personal data. Mitigation: apply redaction pipelines before displaying or storing memory summaries.
