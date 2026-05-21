# Roadmap

## Phase 1 (current): Foundation

Typed schemas, proof layer, mock examples, and trace contract validation.

- `WorkflowSpec` Zod schema with node types, edges, permission classes, and architecture types
- `TraceEvent` schema for runtime events
- `EvalResult` schema for pass/fail assertions
- `RunRecord` schema for execution summaries
- Proof layer: `validateTraceEvent`, `validateWorkflowSpec`, `assertTraceContract`, `classifyFailure`, `summarizeRun`
- Example workflows and trace files for Website Auditor, Campaign Sandbox, Content Trend Analyzer
- In-memory `emitTraceEvent` buffer for testing

## Phase 2: Trace Ingestion API

HTTP endpoint to receive trace events from connected projects.

- `POST /api/trace` accepts a single `TraceEvent` and stores it in memory per `run_id`
- `POST /api/trace/batch` accepts an array of events
- Authentication using `AGENTPULSE_ACCESS_KEY`
- Return 422 on schema validation failure with structured error
- `GET /api/runs/:runId` returns collected events and a `RunSummary`

## Phase 3: Dashboard v2

Run history, workflow graph view, and trace timeline.

- Run list with status, duration, cost, eval pass rate
- Workflow graph view: nodes and edges from `WorkflowSpec` overlaid with trace status
- Trace timeline: ordered event list with durations and costs per node
- Filter by run status, workflow, date range

## Phase 4: Eval Assertions

Eval result ingestion, score trends, and regression detection.

- `POST /api/evals` accepts `EvalResult[]` linked to a `run_id`
- Score trend chart per workflow and per eval type
- Regression detection: flag evals that were passing and are now failing
- Regression test promotion: mark a failing eval as an expected regression case

## Phase 5: SDK Package

Reusable `emitTraceEvent` and `validateTraceEvent` for connected projects.

- Extracted as a standalone package (e.g. `@agentpulse/sdk`)
- `emitTraceEvent(event)`: validates and sends to the AgentPulse ingestion endpoint
- `validateTraceEvent(event)`: validates locally without sending
- TypeScript types exported for `TraceEvent`, `WorkflowSpec`, `EvalResult`, `RunRecord`
- Minimal dependencies, works in Node.js and edge runtimes

## Phase 6: Workflow Inspector

Visualize workflow spec with trace overlay.

- Load a `WorkflowSpec` JSON file into the dashboard
- Overlay trace events: which nodes ran, which succeeded, which failed, durations
- Highlight approval gates, eval nodes, and artifact nodes
- Side-by-side view: spec intent vs. actual run behavior

## Not in the Roadmap

- Workflow runtime (AgentPulse does not execute workflows)
- No-code agent builder
- Live model calls from AgentPulse
- Generic chatbot dashboard
- Multi-tenant SaaS deployment

---

## Scanner Roadmap (v1 History)

**Commit 7: Scanner calibration + report semantics (complete)**

- `FileContext` type added (`production`, `test`, `documentation`, `ci`, `example`, `config`, `migration`, `unknown`).
- Secret finding severity is now calibrated by file context. README/test/example DB URLs no longer drive security to 0.
- Placeholder values (`ci-stub`, `changeme`, etc.) produce `info` severity findings.
- `detectedEvals` now contains only explicit AI eval files; `detectedTests` is a new field for software tests.
- "No evals" finding is now context-aware: "No dedicated AI eval suite detected" when tests exist, "No tests or evals detected" when neither exists.
- `.github/workflows/*` is now classified as `ci` (not product workflow). CI workflows appear in `detectedCIWorkflows` and do not set project type to `workflow_system`.
- `DetectedAgent` and `DetectedWorkflow` now include `source` (explicit/inferred), `confidence` (low/medium/high), and `evidenceReason`.
- Inferred agents no longer have repo-level prompts/tools/evals auto-attributed. Dashboard shows "Not mapped" for unlinked attributes.
- Prompt classification tightened: test files with "prompt" in the name are `test`, not `prompt`. Files only in `/prompts/` or with explicit prompt language count.
- Agent/workflow cards show Explicit/Inferred/Low-confidence badges.
- Dashboard has separate "AI/product workflows" and "CI workflows" sections.
- Markdown export includes CI workflows, evals vs. tests, and agent/workflow source/confidence.
- 116 tests pass. Lint, tsc, and build all pass.

**Commit 8: Dashboard semantics + report readability (complete)**

- `ai_application` project type added. Repos with AI SDK imports, AI API env names, or AI function patterns but no explicit manifest are now correctly typed as `ai_application` instead of `unknown_ai_project`.
- `projectTypeDescription()` added to format utils. Dashboard Project card shows a short description below the project type label.
- `lib/reports/recommendations.ts` created. `buildRecommendations()` is now project-type-aware: inventory recommendations adapt to `agent_system`, `workflow_system`, `ai_application`, etc. Duplicate inventory recommendations collapse into one.
- `lib/reports/findingSummary.ts` created. Provides severity counts, category counts, and secret-context breakdown for the finding table header.
- `lib/reports/scoreExplanations.ts` created. Each score category produces positives, penalties, and related finding count for the expandable score row.
- `FindingTable.tsx` updated: severity summary bar above filters, category badge and context label per finding, evidence paths as monospace list, "No findings match filters" empty state.
- `ScanSummary.tsx` updated: score rows now expand with summary, positives, penalties, and finding count. Project card shows type description.
- `DashboardClient.tsx` updated: agent/workflow empty messages adapt to `ai_application`. Prompt section message adapts to project type. Footer shows `AgentPulse <version>`.
- Markdown export updated: project type description inline, Score Explanations section, Findings Summary section (by severity, category, secret context), CI provider labels.
- `NEXT_PUBLIC_AGENTPULSE_VERSION` env var supported. Defaults to "local".
- CLAUDE.md invariants updated: ai_application, recommendation de-dup, score explanations, report semantics.
- Tests added: ai_application detection, recommendation de-dup by project type, finding summary counts, score explanation behavior, markdown export.

**Commit 10: AI System Graph + Model/Provider Mapping Foundation (complete)**

- `SystemGraph` data model added (nodes, edges, warnings, summary) with manifest/file_path/code_pattern/inferred/eval_result edge sources.
- `lib/reports/systemGraph.ts` reconstructs a typed AI system graph from detected agents, workflows, prompts, tools, evals, and detected models.
- Manifest parsing extended to richer agent and workflow fields: nested `files.prompt`, `tools.allowed`, `evals.paths`, agent `model`, `provider`, `owner`, `permissions`; workflow stages with `agent`, `prompt`, `tools`, `evals`, `model`, `approval_gate`, `artifacts`.
- `lib/scanner/modelDetection.ts` adds deterministic provider/model detection from manifests (high), code strings (medium), env var names (low), and provider SDK imports (low). Secret values are never exposed.
- Optional repo-provided eval/run metrics are parsed from `eval-results.json`, `runs.json`, `metrics.json`, `traces.json`, `model-comparison.json`, `reports/evals/*.json`, `evals/results/*.json`.
- Dashboard adds `SystemGraphView`, `ModelMatrix`, `MappingGaps`, and a richer `AgentCard` (mapped prompts/tools/evals/model, owner, permissions).
- Markdown export adds AI System Graph Summary, Model / Provider Matrix, and Workflow Visualization Data sections.
- Scoring uses graph gaps: small penalties for manifest agents missing prompts, evals, or model; small penalty when workflow manifests have no stages.
- Recommendations are graph-aware: prompt/tool/eval/model mapping recs, eval-to-agent attachment, performance-data prompt.
- AgentPulse does not compare model performance unless repo-provided eval/run metrics are present.

**Commit 11: Scan history**

- Persist redacted reports in a simple store.
- Score trend chart per repository.
- Finding diff between scans.

**Commit 12: Model performance comparison polish**

- Better visualization of repo-provided eval scores, token usage, latency, and cost.
- Per-model and per-agent leaderboards driven by metrics in the repo.

**Future: GitHub OAuth or GitHub App**

- Replace shared access key with GitHub OAuth restricted to the repo owner.
- Or: GitHub App installation for personal repos.

## Phase 5: Scan History

Persist redacted reports, track score trends, and compare findings over time.

## Phase 6: Optional GitHub App / CI Integration

Consider a GitHub App, CI checks, or PR annotations after the private dashboard is stable.
