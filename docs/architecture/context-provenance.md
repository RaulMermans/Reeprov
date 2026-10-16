# Architecture: Context Provenance Graph

## 1. Provenance Integrity Model

Every piece of information presented to a model must be traceable back to its origin without fabricating links where evidence is missing.

```
External Source (KB doc, user input, external tool)
       │
       ▼
Retrieval / Memory Operation
       │
       ▼
ContextItem (inside Decision-Scoped ContextSnapshot)
       │
       ▼
ModelInvocation (Boundary)
       │
       ▼
ExecutionStep & Downstream Action
```

---

## 2. Completeness Classification

For every `ContextItem`, deterministic classification assigns one of five classes:

| Class | Definition | Required Fields |
| :--- | :--- | :--- |
| `COMPLETE` | Unbroken trace from origin to injection | For documents: `source_system`, `document_id`, `chunk_id`, hash/version, retrieval operation reference. |
| `PARTIAL` | Known origin system or ID, but missing retrieval op or chunk boundaries | At least one verifiable origin field. |
| `HASH_ONLY` | Content payload withheld or purged; only deterministic cryptographic hash preserved | `content_hash` present, content unavailable. |
| `UNKNOWN_SOURCE` | Item injected into context without origin metadata or provenance references | Missing all verifiable lineage metadata. |
| `UNAVAILABLE` | External reference is broken, expired, or unresolvable | Link recorded but content and source unretrievable. |

---

## 3. Provenance Coverage Metrics

For each decision snapshot and run summary, Reeprov reports:
$$\text{Provenance Coverage Ratio} = \frac{N_{\text{complete}}}{N_{\text{total\_items}}}$$

Signals flag provenance gaps (`PROVENANCE_GAP`) when retrieved documents or external memories enter context without traceable operation IDs or chunk metadata.
