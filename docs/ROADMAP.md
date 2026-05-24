# Roadmap

## V0 — Static Proof UI

Current focus. AgentPulse proves the inspection layer using local example data only.

- Example workflows for Website Auditor, Campaign Sandbox, and Content Trend Analyzer
- Example runs, traces, and eval results
- Dashboard overview metrics
- Workflow gallery
- Workflow inspector
- Run detail pages
- Trace timeline
- Eval display
- Tool-call inspection
- Model/provider visibility

V0 intentionally does not add a workflow runtime, no-code builder, marketplace, database, external APIs, autonomous execution engine, deployment automation, or real LLM calls.

## Task 4 — Durable Reports, Diff, and Regression Candidates ✓

AgentPulse moves from "scan and display" to "persist, compare, and regression-track."

- Report schema versioning: `reportVersion`, `reportId`, `projectId`, `scanId`, `scannerVersion`, `generatedAt`
- File-backed report store (`lib/reports/reportStore.ts`) with swappable `ReportStore` interface
- Reports saved after every successful GitHub/ZIP scan; mock scans not persisted
- `GET /api/reports` — list saved report summaries
- `GET /api/reports/[reportId]` — get full saved report
- `DELETE /api/reports/[reportId]` — delete report
- Scan history UI at `/dashboard/reports`
- Saved report detail at `/dashboard/reports/[reportId]` (reuses scanner UI)
- Report diff view at `/dashboard/reports/compare` (score deltas, finding changes, regression candidates)
- `lib/reports/reportDiff.ts` — deterministic diff logic (added/resolved/unchanged/worsened/improved)
- `lib/reports/regressionCandidates.ts` — deterministic test suggestions from report deltas
- Golden report fixtures in `tests/fixtures/reports/`
- 81 new tests; all 491 tests pass

## Task 5 — Real Trace Ingestion + Proof-Layer Client ✓

AgentPulse moves from "static proof prototype" to "real trace receiver."

- File-backed run store (`lib/runs/runStore.ts`) with swappable `RunStore` interface
- Run storage: runRecord + traceEvents + toolCalls + evalResults + artifactRefs + timestamps
- Deduplication: duplicate `event_id` values are silently skipped (idempotent ingestion)
- `POST /api/runs/start` — create a run, auto-emit run_started
- `POST /api/traces/events` — append trace events (validates each, rejects malformed)
- `POST /api/runs/complete` — complete a run, run trace contract validation
- `POST /api/runs/fail` — fail a run, store error events
- `GET /api/runs` — list run summaries with filters (projectId, workflowId, status, limit)
- `GET /api/runs/[runId]` — get full saved run with derived summary
- `DELETE /api/runs/[runId]` — delete a saved run
- Dual auth: `AGENTPULSE_INGEST_KEY` for external ingestion, `AGENTPULSE_ACCESS_KEY` for dashboard; fallback to access key when ingest key unset
- `lib/proof-layer/client.ts` — `AgentPulseClient` for external projects to emit traces
- `scripts/seed-trace-run.ts` — realistic Campaign Sandbox seed run (`npm run seed:traces`)
- `/dashboard/runs` — real runs list loaded from the store
- `/dashboard/runs/[runId]` — real run detail (live badge), falls back to example data
- Dashboard overview redesigned: Live Runs section, Quick Navigation cards, example data labeled
- NavBar updated: Runs link added between Overview and Workflows
- `lib/auth/requireIngestKey.ts` — ingest key validation with access-key fallback
- TraceEvent status enum extended: `running`, `degraded`, `blocked` added
- 66 new tests (run store, ingest auth, trace contracts, schemas); all 557 tests pass

## V1 — Trace SDK

Projects emit AgentPulse-compatible traces without AgentPulse executing the project.

- Local/file-based ingestion ✓ (Task 5)
- Standard event schema ✓ (Task 5)
- `emitTraceEvent` and `validateTraceEvent` helpers ✓ (earlier tasks)
- Run summaries derived from traces and evals ✓ (Task 5)
- No network-dependent default CI tests ✓

## V2 — Eval and Assertion Layer

The proof layer becomes stricter and more useful for regression discovery.

- Trace contract checks
- Tool-call assertions
- Output quality records
- Safety records
- Approval gate records
- Regression candidate generation

## V3 — Project Integrations

Connect real projects to the proof layer after local ingestion is stable.

- Website Auditor
- Campaign Sandbox
- Content Trend Analyzer
- Blog Agent

## V4 — Workflow Spec + Validator

Workflow specs become a durable contract for expected behavior.

- YAML/JSON workflow definitions
- Graph validation
- Node registry
- Permission checks
- Approval gate validation
- Spec-vs-trace comparison

## V5 — Thin Runtime Only If Justified Later

Runtime behavior remains out of scope unless the proof layer demonstrates a clear need.

- No autonomous execution engine by default
- No generic no-code agent builder
- No marketplace
- Any runtime must preserve read-only inspection as the core product value

---

## Scanner Roadmap History

The static repository scanner remains useful and should not be removed. It inspects repository files without executing them, redacts secrets, classifies AI system artifacts, builds scanner reports, and feeds the existing scanner dashboard components.

Future scanner work can continue after the proof UI is stable:

- Scan history for redacted reports
- Score trend chart per repository
- Finding diffs between scans
- Optional GitHub OAuth or GitHub App for private repo access
