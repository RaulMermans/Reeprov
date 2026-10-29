# Roadmap

## V0 — Static Proof UI

Current focus. Reeprov proves the inspection layer using local example data only.

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

Reeprov moves from "scan and display" to "persist, compare, and regression-track."

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

Reeprov moves from "static proof prototype" to "real trace receiver."

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
- Dual auth: `REEPROV_INGEST_KEY` for external ingestion, `REEPROV_ACCESS_KEY` for dashboard; fallback to access key when ingest key unset
- `lib/proof-layer/client.ts` — `ReeprovClient` for external projects to emit traces
- `scripts/seed-trace-run.ts` — realistic Campaign Sandbox seed run (`npm run seed:traces`)
- `/dashboard/runs` — real runs list loaded from the store
- `/dashboard/runs/[runId]` — real run detail (live badge), falls back to example data
- Dashboard overview redesigned: Live Runs section, Quick Navigation cards, example data labeled
- NavBar updated: Runs link added between Overview and Workflows
- `lib/auth/requireIngestKey.ts` — ingest key validation with access-key fallback
- TraceEvent status enum extended: `running`, `degraded`, `blocked` added
- 66 new tests (run store, ingest auth, trace contracts, schemas); all 557 tests pass

## Task 5A + Task 6 — Stabilize Trace Ingestion + Static-to-Proof Reconstruction ✓

Reeprov adds a zero-instrumentation path: scan any repo and immediately get a suggested WorkflowSpec, AI system graph, mapping summary, and optional instrumentation plan — without requiring code changes in the target project.

### Task 5A — Trace Ingestion Stability

- `eval_completed` trace events now create `EvalResult` records automatically during ingestion
- `POST /api/runs/start` returns `503` if persistence fails (was silently swallowing the error)
- `FailRunInput` field corrected: `error_summary` (was `summary`) across client + integration examples
- `/dashboard/runs/[runId]` converted to client component (removes server-only `fs` imports from browser bundle); falls back to `/api/runs/examples/[runId]` for example data
- Duplicate example files cleaned up

### Task 6 — Static Proof Reconstruction

- `lib/reconstruction/types.ts` — full TypeScript types: `StaticProofReconstruction`, `SuggestedWorkflowSpec`, `MappingSummary`, `MissingLink`, `InstrumentationPlan`, `ReconstructedSystemGraph`
- `lib/reconstruction/reconstructWorkflowSpec.ts` — deterministic engine that reads a `ScanReport` and returns a `StaticProofReconstruction`; no external API calls, no code execution
- `lib/reconstruction/suggestedFiles.ts` — generates 3 suggested output files: `reeprov.workflow.suggested.json`, `ai-system.suggested.yaml`, `instrumentation-plan.suggested.md`
- Confidence levels: `high` (explicit manifest), `medium` (workflow files or manifest agents present), `low` (scattered artifacts only)
- Missing links: `agent_missing_prompt`, `agent_missing_model`, `workflow_missing_stages`, `prompt_unmapped`, `eval_unmapped`, `model_unmapped` — all deduplicated with stable IDs
- Instrumentation plan: always `required: false`, `available: true`; never implies instrumentation is mandatory
- `GET /api/reports/[reportId]/reconstruction` — reconstruct from a saved scan report
- `POST /api/reconstruct` — reconstruct from inline report body or saved reportId
- `GET /api/runs/examples/[runId]` — example run data for the client-side run detail page
- `components/dashboard/StaticProofReconstructionPanel.tsx` — "Generate proof spec" UI with confidence badge, workflow spec cards, mapping coverage bars, missing links list, suggested file previewer with copy/download
- Scanner UI: "Static Proof Reconstruction" section added to `DashboardClient.tsx`
- `/dashboard/reports/[reportId]/reconstruction` — dedicated reconstruction page for saved reports
- "Reconstruct" link added to scan history list; "Generate proof spec" link added to saved report detail
- `tests/fixtures/reports/campaign-sandbox-scan.json` — fixture with 12 workflow stages, evals, tools, no model — used for reconstruction tests
- 54 new tests (reconstruction engine, suggested files, instrumentation plan, type well-formedness, campaign sandbox fixture, cleanup regression); all 649 tests pass

## Task 6A — Reconstruction Correctness + Schema Hardening ✓

Task 6A tightens Static Proof Reconstruction to stop overclaiming and adds runtime validation.

- **Evidence gate** — `hasStaticProofEvidence(report)` returns true only when product agents, product workflow manifests, prompts, tools, evals, models, or product-scoped graph nodes are present. CI workflows, generic tests, package files, and assistant tooling (`.claude/`, `.cursor/`, `.vscode/`) do not count.
- **No fake WorkflowSpec** — when no evidence exists, the engine returns `workflowSpecs: []`, an empty `systemGraph`, no missing links, and a single explanation-only `no-reconstruction.md` suggested file. The previous `<projectId>-unknown` / trigger-only fallback is gone.
- **Runtime schema validation** — `lib/reconstruction/schema.ts` defines Zod schemas (`staticProofReconstructionSchema`, `suggestedWorkflowSpecSchema`, `mappingSummarySchema`, `missingLinkSchema`, `suggestedManifestFileSchema`, `instrumentationPlanSchema`, `reconstructedSystemGraphSchema`). The engine and the API routes both validate before returning.
- **Clean API contract** — `GET /api/reports/[reportId]/reconstruction` loads by saved ID. `POST /api/reconstruct` accepts either `{ reportId }` or `{ report }` (validated via `scanReportSchema`). The deprecated POST handler on the reportId route is removed.
- **Shared eval conversion** — `lib/proof-layer/evalFromTrace.ts` exports `tryBuildEvalResultFromTraceEvent`. `POST /api/traces/events` and unit tests both call this single production helper.
- **UI empty states** — `StaticProofReconstructionPanel` renders a "No AI workflow reconstruction generated" callout when `workflowSpecs.length === 0`, hides the Inferred Workflow Specs and Suggested Files sections in that case, and labels low-confidence reconstructions explicitly.
- New tests: no-evidence regression, schema validation, `/api/reconstruct` body validation (401/400/404), `/api/reports/[reportId]/reconstruction` GET behavior, eval helper unit tests using the production helper.

### Static reconstruction principles (clarified in Task 6A)

1. **Static reconstruction requires evidence.** Repos without AI artifacts get no WorkflowSpec.
2. **Unmapped is not broken.** A missing link only means Reeprov cannot confirm a relationship from static evidence.
3. **Static proof is not runtime proof.** A suggested spec describes intent; only trace events prove execution.
4. **Suggested manifests are starting points.** They are not verified truth and should be reviewed before adoption.
5. **Reeprov never invents structure.** Non-AI repos are reported as "no reconstruction generated" — not as a fake AI workflow.

## Task 7 — Global Dashboard Access + Overview IA Polish ✓

- All `/dashboard/*` routes protected by a global `REEPROV_ACCESS_KEY` gate
- `DashboardShell` client component manages auth state at layout level
- `POST /api/auth/validate` — shared key validation endpoint
- Scanner no longer has an isolated access model; uses global gate
- `DashboardAuthContext` provides `lock` and `onUnauthorized` to child components
- NavBar shows "Lock dashboard" button for explicit session termination
- Overview redesigned with product mode cards (Live Proof Runs, Static Repository Intelligence, Workflow Registry, Saved Proof Reports)
- Live runs empty state explains runtime vs static scan distinction
- WorkflowGallery and WorkflowCard overflow/text-collision fixes
- README and docs updated with dual-key access model and operating modes

## Task 7A — Access Completion Patch ✓

Task 7A closes the remaining gaps in the global access model.

- **Stored-key revalidation** — `DashboardShell` now calls `POST /api/auth/validate` on mount before unlocking. Stored keys are never trusted by `sessionStorage` alone. Invalid/expired stored keys are cleared and the user is returned to the access gate with "Access key expired or invalid. Please unlock again."
- **Loading state** — while revalidating a stored key, a neutral skeleton is shown instead of flashing the unlock form.
- **Centralised `onUnauthorized`** — all dashboard pages and components that fetch protected APIs (`/api/reports`, `/api/runs`, `/api/reconstruct`, etc.) now call `useDashboardAuth().onUnauthorized()` on `401` instead of locally calling `clearInternalKey()`. This guarantees the whole shell returns to the locked state, not just a single component.
- **Overview loads live runs client-side** — `app/dashboard/page.tsx` no longer reads `fileRunStore.listRuns()` server-side. Live runs are loaded by a new `OverviewLiveRuns` client component via `GET /api/runs` with `mergeAuthHeaders()`.
- **Stale copy removed** — all "Go to the Scanner and unlock first" and "Unlock the dashboard from Repository Scanner" messages replaced with global dashboard language.
- 38 new tests (DashboardShell revalidation, centralised unauthorized handling, overview structure, stale copy); all pass.

## Task 8 — Create Demo Run + Runtime Run Detail UX ✓

Task 8 makes the runtime proof layer testable from the deployed UI without requiring any external project integration.

- **`POST /api/runs/demo`** — new dashboard-protected route that creates a complete Website Auditor demo run using the existing run store and trace schemas. Returns `{ ok: true, runId, redirectTo }`. No ingest key required (dashboard key only).
- **Demo run content**: 8 workflow nodes (URL intake, web crawler, brand audit, UX audit, SEO audit, evidence evaluator, report synthesizer, final artifact), 4 model calls, 3 tool calls, 4 eval results (3 pass / 1 warning), 1 artifact (`audit-report`), realistic cost ($0.0264) and latency (20.7s). Run is marked **degraded** (source grounding eval warning). Trace contract passes.
- **Runs page empty state** — "No live proof runs yet" with a primary **"Create demo run"** button and secondary "Open Repository Scanner" link. Technical ingestion instructions collapsed in a `<details>` element. Clicking the button POSTs `/api/runs/demo`, then redirects to the run detail.
- **Runs list** — run cards show a "Demo" badge for `demo-` IDs, "Seeded" for `seed-` IDs, and "Live" for real ingestion runs.
- **Run detail page** — added "Demo" badge; updated to use `useDashboardAuth().onUnauthorized()` on `401`.
- **Overview** — `OverviewLiveRuns` client component shows "Create demo run" when no live runs exist. Live runs, if present, are fetched via `GET /api/runs` with the dashboard key.
- 34 new tests (demo run API auth, run quality, trace contract, runs page UI, run detail structure, overview integration); all pass.
- Total new tests in Task 7A + 8: 72. All 781 tests pass.

## Task 9 — Workflow Registry Unification ✓

Task 9 bridges the two previously disconnected product worlds: static scan/reconstruction and workflow inspection. The Workflows tab is now a live registry, not just a demo gallery.

- **Workflow Registry data model** — `lib/workflows/workflowTypes.ts`, `workflowId.ts`, `workflowStore.ts`: file-backed `fileWorkflowStore` implementing `WorkflowStore` interface. Registry IDs (`wfr_<ts>_<hex>`). Sources: `example`, `scan_reconstruction`, `manual`, `runtime_observed`. Status lifecycle: `draft` → `needs_review` → `active` (or `archived`). Deduplication by `workflowId + sourceReportId`.
- **Promotion API** — `POST /api/workflows/promote`: three input paths (reportId + workflowId, inline spec + metadata). Status assigned deterministically: `active` if high confidence + no missing fields, `needs_review` otherwise.
- **Registry CRUD API** — `GET /api/workflows` (list + filters), `GET/PATCH/DELETE /api/workflows/[registryId]`. All protected by dashboard access key.
- **Promote button in Static Proof Reconstruction** — each `SuggestedWorkflowSpec` card shows "Promote to Workflow Registry" with a status preview. On success, redirects to the registry detail.
- **Upgraded Workflows tab** — `app/dashboard/workflows/page.tsx` is now a client component showing two sections: **Workflow Registry** (live, from API) and **Example Workflows** (clearly labeled as static demo data). Registry uses `mergeAuthHeaders()` and calls `onUnauthorized()` on 401.
- **Registry detail page** — `app/dashboard/workflows/registry/[registryId]/page.tsx`: header with source/status/confidence badges, spec summary, node list, edge list, proof readiness panel, related runs (from `/api/runs?workflowId=...`), status update and delete actions.
- **Run detail linked to registry** — `app/dashboard/runs/[runId]/page.tsx` queries `/api/workflows?workflowId=...` and shows a "Linked spec" chip with status badge when a matching registry entry exists. Shows "Promote a spec →" link when no registry entry found.
- **Demo workflow registration** — `POST /api/runs/demo` now also upserts the Website Auditor demo WorkflowSpec into the registry (`source: "example"`, `status: "active"`, `confidence: "high"`) so demo run detail can immediately link to a registered spec.
- **`RegistryWorkflowCard` component** — reusable card for registry workflow summaries with source/status/confidence badges, node/edge counts, and link to detail page.
- 60 new tests (workflow store, promotion API, registry CRUD, demo link, UI smoke); all 841 tests pass.

## V1 — Trace SDK

Projects emit Reeprov-compatible traces without Reeprov executing the project.

- Local/file-based ingestion ✓ (Task 5)
- Standard event schema ✓ (Task 5)
- `emitTraceEvent` and `validateTraceEvent` helpers ✓ (earlier tasks)
- Run summaries derived from traces and evals ✓ (Task 5)
- Zero-instrumentation static reconstruction path ✓ (Task 6)
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

---

## Task 10 — Product Stabilization + UX Polish Sprint ✓

Task 10 makes Reeprov feel like a coherent, polished internal V0 product before external project integrations are added.

- **Run detail contradiction fixed** — Run detail no longer shows a linked WorkflowSpec and "no linked spec" state simultaneously. Uses `registryWorkflow.spec.nodes` as fallback when no example workflow exists.
- **Run detail hierarchy** — Critical/failed evals are surfaced near the top. Health summary shows duration, cost, model/tool/eval counts, and artifact count at a glance.
- **Timeline filters** — TraceTimeline has filter tabs: All, Nodes, Models, Tools, Evals, Artifacts, Errors. Each shows event counts. Default is All.
- **Registry detail clarity** — Missing links are labeled "Project-level gaps from source report" with a note that they are informational, not failures. Copy clarifies: "Registered does not mean runtime-verified."
- **Registry list filters** — Workflow Registry list has status (all/active/needs_review/draft/archived) and source (all/scan_reconstruction/example/manual/runtime_observed) filter rows.
- **Promotion UX** — StaticProofReconstructionPanel tracks promoted workflow IDs in session. After promotion, the button changes to "View in Registry →" instead of allowing duplicate promotions. "Promote all" note included.
- **Scanner insight banner** — "What this means" + "Next best actions" summary appears above the health overview after every scan. Shows project type, high-severity count, overall score, and contextual next actions.
- **Navbar "Live" indicator** — Replaced the ambiguous green "Live" dot with "Unlocked" text and a teal indicator.
- **Badge consistency** — Demo, Live ingestion, Seeded, Example data, and registered/example labels are consistently applied across the product.

---

## Good-to-go V0 Test Path

Before connecting real external projects, verify Reeprov end-to-end using the following path:

1. **Unlock dashboard** — Enter REEPROV_ACCESS_KEY at the access gate.
2. **Create demo run** — Go to Runs → click "Create demo run". Confirm redirect to the run detail page.
3. **Inspect run health** — Verify the health summary card shows status, duration, cost, model/tool calls, evals, and artifacts.
4. **Check failed evals** — Confirm the degraded run shows the eval warning near the top of the page.
5. **Inspect timeline** — Use filter tabs (Nodes, Models, Tools, Evals, Artifacts, Errors) to isolate events.
6. **Check linked spec** — Confirm the run detail shows "Registered spec: Website Auditor" with a link to the registry. Confirm no "No workflow spec linked" contradiction appears.
7. **Scan a GitHub repo or ZIP** — Go to Repository Scanner → scan a repo. Confirm the "What this means" insight banner appears above the health overview.
8. **Confirm saved report** — Go to Scan History. Confirm the report appears. Click it to open the saved report detail.
9. **Generate Static Proof Reconstruction** — From the scanner or report detail, click "Generate proof spec". Confirm confidence, workflow specs, mapping coverage, and missing links appear.
10. **Promote a WorkflowSpec** — Click "Promote to Workflow Registry" for an inferred workflow. Confirm the button changes to "View in Registry →".
11. **Open Workflows tab** — Go to Workflows → confirm the promoted workflow appears in Workflow Registry. Use status/source filters to verify filtering works.
12. **Inspect registry workflow** — Open the registry detail. Confirm "Project-level gaps from source report" is labeled correctly. Confirm "Registered does not mean runtime-verified." copy is visible.
13. **Return to run detail** — Navigate to the demo run. Confirm "Registered spec: Website Auditor" is linked. Confirm no contradiction.
14. **Lock and re-unlock** — Click "Lock dashboard". Confirm the access gate re-appears. Re-enter the key. Confirm stored key is revalidated.

### Current Limitations

- **File-backed storage** is local/demo-grade. Data is stored under `.reeprov/` (local) or `/tmp/reeprov` (Vercel). On Vercel, data is wiped on redeployment.
- **Runtime proof from external projects** requires a trace-emitting bridge. The Integration Kit is not yet built.
- **Static reconstruction is deterministic and may be incomplete.** It reads file names and manifest fields — it does not execute the project. Unmapped links are gaps in static evidence, not proof of bugs.
- **Registered specs are contracts/drafts.** A registered WorkflowSpec describes intent. Only linked runtime runs (with trace events) constitute runtime proof.
- **No authentication or user accounts.** Reeprov uses a single shared REEPROV_ACCESS_KEY. Not suitable for multi-user deployments yet.
- **No durable production storage.** Replace `fileRunStore` / `fileReportStore` / `fileWorkflowStore` with a Postgres, Vercel Blob, or Supabase adapter for persistence across deployments.

---

## Task 11 — Repeatable Project Integration Kit ✓

Task 11 makes live-pulse integration repeatable. The goal: connect Blog Agent, Website Auditor, Campaign Sandbox, and future projects using the same standard path — without bespoke work per project.

- **Integration Registry** — `lib/integrations/integrationTypes.ts` + `integrationStore.ts`: file-backed `fileIntegrationStore` implementing `IntegrationStore`. Registry IDs (`integ_<ts>_<hex>`). Status: `waiting_for_first_event` → `receiving_events` → `stale` / `error`. Modes: `trace_sdk` | `static_only` | `manual_trace_import` | `gateway_future`.
- **Integration CRUD API** — `GET/POST /api/integrations`, `GET/PATCH/DELETE /api/integrations/[integrationId]`. All protected by dashboard access key.
- **Test-event API** — `POST /api/integrations/[integrationId]/test-event`: creates a complete server-side test run (1 model call, 1 eval) for the integration. Uses dashboard key — does not expose the ingest key to the browser.
- **Ingestion auto-update** — `POST /api/runs/start`, `POST /api/traces/events`, and `POST /api/runs/complete` all call `touchIntegrationForProject(projectId)` non-fatally. If no integration exists for a `project_id`, one is auto-created.
- **Integrations dashboard page** — `/dashboard/integrations`: list view with status, mode, language, last event, run count. Add integration form (project ID, name, workflow, language, repo URL).
- **Integration detail / setup page** — `/dashboard/integrations/[integrationId]`: connection status, env block, language snippets (TypeScript / Python / REST tabs), Send test event button, recent runs, troubleshooting.
- **SDK templates** — `examples/integrations/typescript/reeprovClient.ts`: zero-dependency TypeScript client. `examples/integrations/python/reeprov_client.py`: zero-dependency Python client. `examples/integrations/rest/README.md`: curl examples.
- **NavBar updated** — "Integrations" added between Workflows and Repository Scanner.
- **Runs + Overview updated** — Empty states now link to Integrations as the primary CTA for connecting real projects.
- **"Env vars alone do not send events"** — Troubleshooting copy is explicit: the adapter must be imported and called.

### Standard Integration Path

```
1. Add integration in Reeprov.
2. Copy env block into external project.
3. Copy reeprovClient.ts (or reeprov_client.py) into project.
4. Wrap the project's main workflow with startRun / completeRun.
5. Run the external project.
6. Confirm run appears in Reeprov → Runs.
7. Check integration status in /dashboard/integrations.
```

### Updated Current Limitations

- **File-backed storage** is local/demo-grade.
- **Shared ingest key** — V0 uses one global `REEPROV_INGEST_KEY` for all projects. Project-specific keys are not yet implemented.
- **No automatic WorkflowSpec linking on ingest** — runs are visible immediately; linking to a registered spec requires the `workflow_id` to match an existing registry entry.

---

## Task 12 — Visual Execution Canvas ✓

Task 12 replaces the card-row workflow view with a real, read-only, n8n-style run graph.

- **`lib/visualGraph/`** — generic `VisualRunGraph` model derived from the existing `RunGraph`: `buildVisualRunGraph.ts` (nodes/edges), `nodeRegistry.tsx` (icons/labels per node type), `iconResolvers.ts`, `filters.ts` (canvas filters), `replay.ts` (deterministic replay state machine over trace events), `metadataDisplay.ts` (safe metadata formatting for the inspector), `viewport.ts`.
- **`components/proof-layer/VisualExecutionCanvas.tsx`** — the canvas itself, built on `@xyflow/react`: real pan/zoom/fit-view, minimap, legend, branching workflow connectors, evidence nodes (models/tools/skills/CLI/evals/artifacts/issues/recoveries) attached with typed edges, click-to-inspect on stage and evidence nodes. CLI nodes are labeled "CLI", never "$".
- **`components/proof-layer/ReplayControls.tsx`** and **`CanvasFilters.tsx`** — replay (play/pause/reset/step/scrub) and evidence-type filters, both read-only.
- **Agent visibility + reasoning notes** — agent identity surfaced from generic trace metadata; `lib/runs/agentNotes.ts` renders `agent_note_recorded` events only when `visibility: "user_safe"` (never raw chain-of-thought).
- **Live polling** — `lib/runs/useLiveRunPolling.ts` refreshes active runs in the canvas without manual reload; paused follow does not stop data refresh.
- **Legacy fallback preserved** — the previous `RunWorkflowGraph` card-row view remains available behind a debug toggle; Raw Trace tab remains accessible independent of canvas state.
- **Genericity guarded** — `lib/visualGraph/__tests__/genericity.test.ts` and related suites fail if graph/canvas logic branches on `project_id`, `workflow_id`, or BlogAgent-specific stage/node names. BlogAgent is used only as a fixture.
- **Docs** — `docs/production-qa-checklist.md` added for manual production QA of the canvas against the primary fixture run.
- Read-only boundary preserved: no edit, run, execute, or drag-to-connect controls.

## What Comes Next — Real External Project Connections

Now that the integration path and Visual Execution Canvas are in place, the next steps are:

- Instrument Blog Agent with `reeprov_client.py`
- Instrument Website Auditor with `reeprovClient.ts`
- Instrument Campaign Sandbox
- Verify live runs appear under their Integration entries, and render correctly in the Visual Execution Canvas
- Consider project-specific ingest keys for multi-project isolation
- Multi-project pulse on the Overview
- Artifact preview proof and portfolio packaging (tracked as future work, not started)

## Sprint 13 — External Replay, Checkpoint Integrity & SDK Contract ✓

Verdict `EXTERNAL_REPLAY_AND_FORK_VERIFIED` (see `docs/sprints/S13-external-replay.md`):
- Checkpoint observation separated from restorable registration; restorability requires valid state and a verified host.
- Canonical ingestion with per-record accounting, client-keyed boundaries, run-level locking and atomic writes.
- Run capture policy propagated over HTTP.
- Developer-side host replay and fork runner (`reeprov host-replay | host-fork`), with upload validation that never executes code server-side.
- Reference incident-triage agent, domain eval suite, fork-aware comparison and an improvement-claim gate.
- TypeScript/Python SDK parity for acknowledgements, keyed boundaries, checkpoints and canonical hashing.
- Studio execution-state labels and Replays tab; `personal_local` + access-key unlock fix.

Still open: Python host replay, OS-level isolation for untrusted host code, a live Postgres concurrency test, an SDK release (version decision pending owner approval), and a live LLM leg.

## Sprint P1 — Runtime & Evidence Readiness

Establishes experimental readiness for later multi-agent research without implementing SwarmGuard.

- Agent identity is first-class on ingest (`agent_id`, `participating_agent_ids`) and is never invented from generic labels.
- Cross-agent handoffs are canonical `handoffs[]` records with `resolved` / `partial` / `unknown` attribution.
- Verification events distinguish `agent_asserted` claims from `system_recorded` / `externally_observed` evidence.
- `validateEvidenceIntegrity` refuses to treat missing, malformed, duplicate, or cross-run refs as verified evidence.
- `exportRunEvidenceBundle` wraps the existing RunArtifact for independent analysis.
- Two-agent harness: `examples/external-agents/two-agent-handoff/` (in addition to the Sprint 13 single-agent incident-triage example).
- Proof: `docs/testing/p1-runtime-evidence-readiness.md`.
