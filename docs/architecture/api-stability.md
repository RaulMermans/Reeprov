# AgentPulse Public API & Contract Stability Classification

This document formally defines the stability taxonomy and compatibility commitments for AgentPulse interfaces as of version `0.1.0-beta.1`.

---

## 1. Stability Classification Taxonomy

| Level | Definition | Deprecation Policy |
|---|---|---|
| **`PUBLIC`** | Stable, supported external contract. Backwards compatibility maintained across minor beta versions. | Minimum 1 release deprecation warning before removal. |
| **`EXPERIMENTAL`** | Available for evaluation and feedback. Signature or semantics may change across minor releases. | May change without deprecation window. |
| **`INTERNAL`** | Private implementation details. Not intended for external consumption. | No stability guarantees. |
| **`LEGACY`** | Deprecated interfaces retained for temporary backward compatibility. | Subject to removal in next major release. |

---

## 2. Core Interface Inventory

| Interface / Component | Classification | Package / Location | Notes |
|---|---|---|---|
| **HTTP Ingest API** | `PUBLIC` | `POST /api/runs/*`, `POST /api/traces/*` | Standard JSON contracts for external agents. |
| **TypeScript Client SDK** | `PUBLIC` | `@agentpulse/client` | Official npm package. |
| **Python Client SDK** | `PUBLIC` | `agentpulse-client` | Official PyPI package. |
| **CLI (`pulse`)** | `PUBLIC` | `bin/pulse.mjs` | Core developer tool commands (`data-path`, `projects`, `replay`, `diff`, `regression check`). |
| **RunArtifact Schema** | `PUBLIC` (Beta) | `lib/core/contracts/runArtifact.ts` | Serialized canonical execution evidence envelope (`schemaVersion: 1.0.0-beta`). |
| **Execution Boundary Schema** | `PUBLIC` (Beta) | `lib/core/contracts/replay.ts` | Model calls, tool invocations, retrieval operations, and checkpoints. |
| **Evaluation Suite Schema** | `PUBLIC` (Beta) | `lib/core/contracts/evalDefinitions.ts` | Declarative eval suites and test case assertions. |
| **Project Export Bundle** | `PUBLIC` (Beta) | `lib/projects/projectExport.ts` | Portable JSON project export manifest (`version: 1`). |
| **Advanced Evaluators** | `EXPERIMENTAL` | `lib/core/evals/` | Semantic trajectory matching and custom scoring adapters. |
| **Context/Memory Ablation** | `EXPERIMENTAL` | `lib/core/intelligence/` | State ablation simulation engines. |
| **Storage Adapters** | `INTERNAL` | `lib/storage/`, `lib/db/` | Direct filesystem and Postgres query layers. |
| **Studio Web Components** | `INTERNAL` | `app/`, `components/` | React dashboard UI implementation. |

---

## 3. Data Format Compatibility & Evolution

### Schema Evolution Rules
1. **Additive Changes:** New optional fields may be added to `RunArtifact` and `TraceEvent` without breaking backward compatibility.
2. **Schema Versioning:** Serialized artifacts specify `schemaVersion`. Importers and evaluators reject unsupported future major versions cleanly.
3. **Export Manifests:** Project export bundles contain `version: 1` metadata. If an export contains unrecognized properties, the importer ignores them safely.

---

## 4. Replay Limitations

AgentPulse provides **deterministic offline boundary substitution**, not process virtualization:
- **What is guaranteed:** If an external boundary (LLM call, tool output, retrieval query) was captured with complete input hashes and recorded responses, the replay engine substitutes the recorded response without network access.
- **What is NOT supported:** Arbitrary OS process snapshots, in-memory heap virtualization, or unrecorded non-deterministic runtime interactions.
