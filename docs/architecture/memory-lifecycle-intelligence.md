# Architecture: Memory Lifecycle Intelligence

## 1. Product Boundaries & Scope

Reeprov is strictly an observation, audit, and diagnostic plane for external memory systems (Mem0, Letta, Zep, LangGraph memory stores, custom databases).

- Reeprov **does not** act as a memory database or vector index.
- Reeprov **does not** mutate live external memory stores.
- Reeprov **records and audits** observable memory operations: read, write proposals, committed writes, updates, superseding, evictions, consolidations, and retrievals.

---

## 2. Memory Lifecycle Entity Model

A memory entity evolves across multiple lifecycle events:

```
  Write / Extraction (v1)
          │
          ▼
       Update (v2)
          │
          ▼
     Consolidation / Superseding (v3)
          │
          ├──────────────────────────┐
          ▼                          ▼
     Active State              Superseded State
(Valid for retrieval)      (Should NOT be injected)
```

### Graph Nodes and Edges
- **`MemoryLifecycleNode`**: Represents a recorded operation touching a memory record (`operation_type`, `version`, `content_hash`, `summary_preview`, `provider`, `timestamp`).
- **`MemoryLifecycleEdge`**: Represents evolutionary transitions (`extracted_from`, `proposed_as`, `committed_from`, `updated_to`, `consolidated_into`, `superseded_by`, `retrieved_for`, `injected_into`).

---

## 3. Retrieval → Injection Auditing

Tracks whether memories retrieved from external stores actually entered prompt context:
- `is_stale_at_injection`: Flags when a memory version older than the latest active version was injected.
- `MEMORY_SUPERSEDED_BUT_RETRIEVED`: Flags when a superseded memory record was retrieved by the external retriever.
- `MEMORY_OLD_VERSION_INJECTED`: Flags when an outdated memory version entered model context while a newer version existed in evidence.

---

## 4. Strictly Bounded Causal Proof Standard

Reeprov enforces 4 strictly bounded evidence levels:

1. **`OBSERVED`**: Memory was retrieved or injected into context.
2. **`CORRELATED`**: Memory presence co-occurs with specific downstream model actions.
3. **`CONTROLLED_ABLATION`**: An isolated fork execution was conducted excluding the targeted memory.
4. **`CAUSALLY_SUPPORTED`**: Deterministic run comparison proves a specific behavioral divergence followed the controlled ablation.

Claims such as "memory improved performance" are forbidden without a corresponding controlled ablation fork proof.
