# Product Surface: Context Intelligence

> **Canonical Role:** First-class inspection, token attribution, provenance tracking, and ablation analysis of what an AI agent knew at each decision.

---

## 1. Job to Be Done

Model hallucinations, reasoning failures, and context window bloat often stem directly from poor context engineering: missing instructions, stale documents, misleading few-shot examples, or noisy retrieval chunks.

Context Intelligence enables developers to:
1. Answer definitively: *"What exact information was present in the prompt when the model made decision $X$?"*
2. Deconstruct prompt context into semantic categories (system policy, agent instructions, active skills, chat history, state variables, retrieved documents, retrieved memories, tool definitions).
3. Attribute token consumption and dollar costs to specific context sources.
4. Trace provenance: verify where each piece of context came from (repository file, vector DB chunk ID, memory entry, or user turn).
5. Compare context composition between two runs to identify how prompt drift or retrieval changes affected the agent's behavior.
6. Design future controlled ablation experiments (e.g. measure impact of excluding few-shot examples or trimming retrieved documents).

---

## 2. Data Required

- **`ContextSnapshot`:** Point-in-time container linked to a `step_id` and `model_invocation_id`.
- **`ContextItem[]`:**
  - `source_type`: Category (`system_policy`, `agent_instructions`, `retrieved_document`, `retrieved_memory`, etc.).
  - `position`: Order in which the item was injected.
  - `token_estimate`: Number of tokens attributed to this specific item.
  - `provenance`: `ContextProvenance` with `source_system`, `document_id`, `chunk_id`, `uri`, `version`, `retrieval_query`, and `retrieval_score`.
  - `inclusion_reason`: Why this context was selected.
  - `content_captured`: Boolean flag indicating whether raw content was stored or hashed.
  - `redaction_status`: Validation status of credential stripping.

---

## 3. Primary Views

- **Context Composition Breakdown:** Interactive stacked bar chart and treemap showing token percentage and raw count by category (`system_policy`, `retrieved_document`, `history`, `tools`, etc.).
- **Token Attribution Table:** Sortable list of all context items ranked by token consumption, cost attribution, and source system.
- **Provenance Inspector:** Visual card linking context items back to source documents, chunk IDs, memory operations, and retrieval queries.
- **Context Diff Viewer:** Side-by-side diff of context snapshots between baseline and candidate runs, highlighting added, removed, or mutated context blocks.
- **Ablation Candidate Matrix:** Highlights high-cost, low-retrieval-score context items that are candidates for exclusion in Experiment Lab.

---

## 4. Primary Actions

- **Inspect Item Provenance:** Click any context block to view its origin URI, chunk boundary, and retrieval score.
- **Mark for Ablation Experiment:** Send a context item (or category) to Experiment Lab with a `context_exclusion` mutation to test if performance degrades without it.
- **Verify Redaction:** Confirm that sensitive PII or credentials in context items were sanitized prior to model submission.
- **Export Context Breakdown:** Export token attribution JSON for budget modeling and prompt optimization analysis.

---

## 5. Dependencies

- Canonical `ContextSnapshot`, `ContextItem`, and `ContextProvenance` contracts.
- Linkage to `ModelInvocation` and `ExecutionStep`.

---

## 6. Non-Goals

- **Automatic Prompt Rewriting:** Does not automatically compress or rewrite prompts using LLMs.
- **Automated Relevance Scoring:** Does not guess "relevance" without explicit ground truth or eval graders.
- **Live Vector Retrieval Execution:** Does not perform vector searches itself; it observes and audits external retrieval operations.

---

## 7. Future Evals

- `context`: Context utilization efficiency, noise ratio, and token economy.
- `retrieval`: Precision and recall of retrieved chunks against gold reference chunks.
- `source_grounding`: Faithfulness of model output to the provided context items.

---

## 8. Risks

- **Context Volume:** Full prompts for large context models (100k-1M tokens) can exceed storage budgets. Mitigation: support `content_captured: false` with `content_hash` and token count estimation.
- **Provenance Drift:** External knowledge bases may mutate documents after retrieval. Mitigation: capture immutable content hashes and version tags in `ContextProvenance`.
