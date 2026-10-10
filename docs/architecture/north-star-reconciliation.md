# North Star Reconciliation: Architectural Audit

> **Status:** Approved Architecture Reconciliation  
> **Target:** AgentPulse v1.0+ Canonical Architecture  
> **Core Principle:** AgentPulse is an open-source debugging and optimization workbench for AI agents.

---

## 1. Executive Summary

AgentPulse originated as a static repository audit scanner and proof layer for AI agent repositories. Over successive milestones, it added trace event ingestion, a visual execution canvas, a workflow registry, integration onboarding, and diagnostic telemetry.

This audit evaluates every existing subsystem against the new **North Star Mission**:

```
CAPTURE → INSPECT → REPRODUCE → DIAGNOSE → FORK → EXPERIMENT → EVALUATE → COMPARE → REGRESSION
```

AgentPulse must eventually let developers understand not only **WHAT** an agent did, but:
- what context it saw;
- where that context came from;
- what memories were retrieved, written, or consolidated;
- which tools and models were available and used;
- what state changed;
- what evaluations passed or failed;
- where two executions diverged;
- whether a context, memory, tool, prompt, or model change actually improved the result.

This document classifies every subsystem to guide foundational contract evolution while preserving backward compatibility for running workloads.

---

## 2. Classification Key

- **KEEP**: Foundational subsystem that directly serves the north star with minor or no modifications.
- **KEEP_AND_EXTEND**: Critical subsystem that will be preserved and extended with canonical schemas and contracts.
- **REFACTOR**: Subsystem whose core purpose is aligned, but whose current abstractions or coupling need restructuring.
- **DEMOTE**: Subsystem that remains functional for backward compatibility but is no longer the central focus or primary entry point of the product.
- **REMOVE**: Subsystem or code that actively conflicts with the north star, creates maintenance debt, or is obsolete.
- **UNKNOWN**: Subsystem requiring further discovery before long-term architectural commitment.

---

## 3. Subsystem Audit Matrix

| Subsystem | Location | Classification | Current Responsibility | North-Star Responsibility | Reason | Migration Risk | Persisted Data Affected? |
|---|---|---|---|---|---|---|---|
| **1. Run Ingestion** | `app/api/runs/*`, `app/api/traces/events`, `lib/runs/runStore.ts` | **KEEP_AND_EXTEND** | Ingests `RunRecord`, `TraceEvent`, `ToolCallRecord`, and `EvalResult` over HTTP. | Ingest canonical `RunArtifact` envelopes, streaming execution steps, boundaries, context snapshots, and memory ops. | Ingestion is the entry gate for the CAPTURE phase. Must remain backwards-compatible with existing SDKs while accepting canonical v1 payloads. | Low. Additive endpoints or payload shape negotiation. | No. Existing runs remain valid. |
| **2. Trace & Event Storage** | `lib/runs/runStore.ts`, `lib/runs/pgRunStore.ts`, `ap_trace_events` | **KEEP_AND_EXTEND** | Stores chronological `TraceEvent` rows in dual-mode (file `.agentpulse/runs` or Postgres `ap_trace_events`). | Persist raw trace events as primary evidence; index execution steps and boundary references. | Raw events are indispensable immutable evidence. Future queries need step and boundary indices. | Low. Storage interface remains swappable. Additive columns or child tables. | No. Existing tables remain unmolested. |
| **3. Workflow & Run Graphs** | `lib/runs/runGraph.ts`, `lib/runs/runIntelligence.ts` | **REFACTOR** | Pure deterministic transformation of events and records into grouped stages and graph nodes. | Map canonical `RunArtifact` trajectory, boundaries, and evidence into execution timeline and causality graph. | Current graph engine couples tightly to legacy `TraceEvent` types and UI stage heuristics. Needs separation between logical trajectory and visual presentation. | Medium. Graph transformation logic is widely tested; must adapt canonical types without breaking UI. | No. Derived at read-time. |
| **4. Workflow Specifications** | `lib/workflows/*`, `lib/proof-layer/schemas.ts`, `ap_workflow_specs` | **KEEP_AND_EXTEND** | Declarative contract of intended workflow nodes, edges, allowed tools, and approval gates. | Serves as baseline topology contract against which executions and mutations are validated and compared. | Intended topology is essential for detecting runtime structural divergence and missing boundaries. | Low. Additive fields for replayability requirements and state scopes. | No. Schema is backward-compatible. |
| **5. Visual Execution Canvas** | `components/proof-layer/VisualExecutionCanvas.tsx`, `@xyflow/react` | **KEEP_AND_EXTEND** | Renders interactive node-based graph with pan/zoom, minimap, filters, and node selection. | Primary surface for INSPECT, DIAGNOSE, and visual divergence between baseline and fork. | The XYFlow canvas is already clean, generic, and read-only. Will be extended to render context nodes and memory operations. | Low. Pure UI component driven by visual graph models. | No. UI-only. |
| **6. Run Inspector Panels** | `components/proof-layer/*` (`WorkflowInspector`, `NodeDetailPanel`, `ToolCallsPanel`, etc.) | **KEEP_AND_EXTEND** | Displays slide-over or tabbed details for stages, tools, evals, artifacts, and issues. | Inspect what the agent knew at each decision: context items, memory reads/writes, model prompts, and tool boundaries. | Must expand from displaying raw metadata to showing structured context snapshots and provenance. | Low. Additive inspector tabs for Context, Memory, and Lineage. | No. UI-only. |
| **7. Raw Traces Surface** | `components/proof-layer/TraceTimeline.tsx`, `/api/traces/events` | **KEEP** | Chronological timeline of raw trace events with search, filtering, and JSON inspector. | Forensic low-level audit view for un-abstracted runtime evidence. | Essential ground truth for developers when higher-level abstractions are ambiguous or failing. | Very Low. Component is stable. | No. UI-only. |
| **8. Artifact Storage & References** | `lib/runs/runTypes.ts` (`artifact_refs`), `ArtifactPreviewPanel.tsx` | **KEEP_AND_EXTEND** | Stores array of artifact string references produced during a run. | First-class `ArtifactReference` contract with content hash, URI, MIME type, size, and producing step linkage. | String arrays lack provenance, integrity hashing, and versioning needed for reproducibility and diffing. | Low. Adapter wraps legacy string refs in `ArtifactReference`. | No. Existing string arrays map cleanly. |
| **9. Eval Model & Results** | `lib/proof-layer/schemas.ts`, `ap_eval_results`, `lib/auditors/evalAuditor.ts` | **KEEP_AND_EXTEND** | Stores `EvalResult` (score, passed, severity, findings) linked to `run_id` and optional `node_id`. | Canonical run-linked proof contract covering 13 eval families, step linkage, evaluator version, dataset IDs, and graders. | Evals are the objective function of the workbench (EVALUATE and REGRESSION phases). Current schema is a solid foundation. | Low. Canonical `EvalResult` extends legacy fields seamlessly. | No. Existing eval records fit cleanly. |
| **10. Models & Providers** | `lib/llm/*`, `lib/scanner/modelDetection.ts` | **KEEP_AND_EXTEND** | Detects model references in code; provides mock LLM client for internal audits. | Canonical `ModelInvocation` contract capturing exact provider, model name, hyperparameters, token usage, cost, and context linkage. | Debugging requires knowing exact model configuration and prompt token attribution per decision. | Low. Internal mock client stays unchanged. | No. Extends trace metadata. |
| **11. Tool Calls** | `lib/proof-layer/schemas.ts`, `ap_tool_calls`, `ToolCallsPanel.tsx` | **KEEP_AND_EXTEND** | Records tool name, input/output summary, duration, permission class, and status. | Canonical `ToolInvocation` linked to execution boundaries, replayability class, and side-effect class. | Tool invocations are the primary boundary where agents effect external reality. Replay requires precise boundary contracts. | Low. Existing permission classes match side-effect classes. | No. Extends existing records. |
| **12. Retrieval Subsystem** | `lib/proof-layer/schemas.ts` ("retrieval" node type) | **KEEP_AND_EXTEND** | Currently only an unelaborated node type and RAG architecture enum. | Canonical `RetrievalOperation` contract capturing queries, vector/keyword provider, scores, rank, chunks, and context linkage. | Essential for Context Intelligence. Developers must know what was retrieved vs what was included in context. | Low. Purely additive contract. | No. No legacy retrieval data exists yet. |
| **13. Memory Subsystem** | None (only developer scratchpad `memory/` for AGY/Claude) | **KEEP_AND_EXTEND** (New Contract) | No agent runtime memory subsystem existed in the application. | Framework-neutral `MemoryOperation` and `MemoryReference` observability contract (read, write, consolidate, recall). | AgentPulse must observe external memory systems (Mem0, Letta, custom) without becoming a memory database itself. | Zero. Entirely new contract, no legacy data to break. | No. |
| **14. Replay Concepts** | `lib/visualGraph/replay.ts`, `ReplayControls.tsx` | **REFACTOR** | Client-side visual timeline scrubber simulating chronological step progression. | Foundation for execution boundary replayability classification and sandbox execution planning. | The visual scrubber is useful for inspection, but true replay requires boundary contracts (`ExecutionBoundary`, replay classes). | Low. Current visual controls remain intact; backend contracts formalize replay semantics. | No. UI/client-side state. |
| **15. Persistence Architecture** | `lib/runs/runStore.ts`, `lib/reports/reportStore.ts`, `lib/db/*` | **KEEP_AND_EXTEND** | Dual-mode persistence: file-backed for local/dev and Postgres for durable production deployments. | Retain dual-mode architecture; introduce canonical schema migration paths and versioned storage interfaces. | Dual-mode makes local onboarding frictionless while enabling production deployment with zero external dependencies. | Medium. Need careful additive schema evolution. | No. Additive tables/columns only. |
| **16. Postgres Schema & Migrations** | `lib/db/migrate.ts` | **KEEP_AND_EXTEND** | Idempotent DDL migrations creating `ap_runs`, `ap_trace_events`, `ap_tool_calls`, `ap_eval_results`, etc. | Additive schema migrations supporting canonical run artifacts, lineage relations, and boundary records. | Idempotent migrations ensure zero-downtime evolution without breaking existing tables. | Low. All changes additive `CREATE TABLE IF NOT EXISTS` or `ALTER TABLE ADD COLUMN IF NOT EXISTS`. | No. Existing data intact. |
| **17. APIs & Routes** | `app/api/*` | **KEEP_AND_EXTEND** | REST endpoints for runs, traces, workflows, reports, integrations, and diagnostics. | Versioned endpoints for canonical RunArtifact ingestion, query, lineage traversal, and run comparison. | Existing endpoints must remain available for backward compatibility with existing clients and fixtures. | Low. Existing routes preserved; new canonical endpoints added under clean versioning. | No. |
| **18. CLI & Scripts** | `scripts/*` (`seed-trace-run`, `simulate-live-run`, `db-migrate`) | **KEEP_AND_EXTEND** | Node scripts for database migrations, run seeding, and live event simulation. | Expand scripts into a developer-facing CLI harness for local trace capture, replay testing, and fixture generation. | Developer workbench ergonomics require seamless CLI integration into developer workflows. | Low. Scripts remain functional. | No. |
| **19. Test Suite** | 76 vitest suites, 1408 passing tests | **KEEP_AND_EXTEND** | Comprehensive unit, integration, and UI tests covering all existing subsystems. | Expand with canonical contract validation, legacy run mapping verification, fixture roundtripping, and lineage tests. | Existing high test coverage prevents regressions. All 1408 tests must remain green. | Zero. Additive test suites. | No. |
| **20. Static Scanner & Auditors** | `lib/scanner/*`, `lib/auditors/*`, `prompts/*`, `lib/reports/*` | **DEMOTE** | Scans GitHub repos or ZIPs for AI architecture, prompts, tools, secrets, and generates health reports. | Secondary onboarding & static discovery tool. Feeds initial workflow topology and tool discovery into AgentPulse. | The scanner was the original product core, but the North Star is the runtime workbench. The scanner is a feeder, not the workbench itself. | Low. Remains fully functional at `/dashboard/scanner`. | No. Scan reports remain intact. |
| **21. Static Proof Reconstruction** | `lib/reconstruction/*` | **DEMOTE** | Infers `WorkflowSpec` and system graph from static scan reports without runtime instrumentation. | Zero-instrumentation onboarding path for bootstrapping initial topology contracts. | Useful bridge from static code to runtime contract, but secondary to actual captured execution traces. | Low. Retains full functionality. | No. |
| **22. Project Integrations & Ingest Keys** | `lib/integrations/*`, `lib/diagnostics/*` | **KEEP_AND_EXTEND** | Manages integration records, ingest API keys, SDK snippets, and diagnostic error logging. | Connection and authentication management for external agent runtimes emitting canonical traces. | Critical operational plumbing for the CAPTURE phase. | Low. Interfaces remain stable. | No. |
| **23. Existing Docs & ADRs** | `docs/*` (`ARCHITECTURE.md`, `PRODUCT_SPEC.md`, `DATA_MODEL.md`, etc.) | **KEEP_AND_EXTEND** | Architectural documentation describing v0 layers, scanner, and proof layer. | Retain historical context while archiving outdated roadmaps and linking to the new canonical north star. | Documentation integrity is mandatory. | Zero. Additive documents. | No. |

---

## 4. Subsystem Disposition Summary

| Disposition | Count | Subsystems |
|---|:---:|---|
| **KEEP** | 2 | Raw Traces Surface, Test Suite |
| **KEEP_AND_EXTEND** | 16 | Run Ingestion, Trace Storage, Workflow Specs, Visual Canvas, Run Inspector, Artifacts, Evals, Models, Tool Calls, Retrieval, Memory, Persistence, Postgres Schema, APIs, CLI/Scripts, Integrations & Keys |
| **REFACTOR** | 2 | Workflow & Run Graphs, Replay Concepts |
| **DEMOTE** | 2 | Static Scanner & Auditors, Static Proof Reconstruction |
| **REMOVE** | 0 | None. All existing functional capabilities remain useful and backward-compatible. |
| **UNKNOWN** | 0 | None. Full system audited and mapped. |

---

## 5. Backward Compatibility & Migration Strategy

1. **No Destructive Database Changes:** Existing tables (`ap_runs`, `ap_trace_events`, `ap_tool_calls`, `ap_eval_results`, `ap_workflow_specs`, `ap_integrations`, `ap_reports`, `ap_ingest_diagnostics`) are untouched. New capabilities are enabled via additive columns or new dedicated tables.
2. **Canonical Adapter Layer:** A bidirectional mapping layer (`adaptLegacyRunToRunArtifact`) guarantees that any existing run stored in file or Postgres formats can be viewed as a canonical `RunArtifact`.
3. **Explicit Non-Fabrication Policy:** Where legacy runs lack information (e.g. detailed context snapshots, memory operations, boundary replayability ratings), the adapter uses explicit sentinel values (`"not_captured"`, `"unknown"`, `"unavailable"`) rather than hallucinating runtime truth.
4. **Preserved UI Routes:** All existing dashboard routes (`/dashboard`, `/dashboard/runs`, `/dashboard/workflows`, `/dashboard/scanner`, `/dashboard/integrations`, `/dashboard/reports`) remain fully functional.

---

## 6. Milestone: Replay-Grade Boundary Capture Delivery

In Sprint 2, the transition from passive trace evidence to replay-grade execution boundaries was achieved:
- **Boundary Taxonomy:** First-class models for `model_call`, `tool_call`, `retrieval_call`, `memory_read`, `memory_write`, `external_http`, `code_execution`, `filesystem_read`, and `filesystem_write`.
- **Content-Addressed Deduplication:** Payloads >4KB are hashed with SHA-256 and deduplicated into `.agentpulse/blobs/` or `ap_content_blobs`, eliminating redundant storage in multi-turn runs.
- **Server-Side Secret Sanitization:** Mandatory scrubbing of 8 secret pattern classes, environment variables, and sensitive headers/keys across all capture modes (`STRUCTURE_ONLY`, `SAFE_CONTENT`, `FULL_CONTENT`).
- **Context Snapshot Materialization:** Precise token-attributed `ContextSnapshot` records for model calls linking prompts to source provenance without LLM-based compression.
- **Deterministic Offline Replay Proof:** Implemented [`BoundaryReplayHarness`](file:///Users/raulm/Desktop/GitHub/AgentPulse/lib/core/capture/replayHarness.ts) and proved 100% offline deterministic substitution of a multi-turn support agent workflow ([`fixture-h-vertical-slice.json`](file:///Users/raulm/Desktop/GitHub/AgentPulse/tests/fixtures/canonical/fixture-h-vertical-slice.json)).

