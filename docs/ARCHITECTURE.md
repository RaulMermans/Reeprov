# Architecture

AgentPulse is structured in six layers. Each layer has a single responsibility.

## Layer 1: Workflow Spec

A declarative description of what a workflow is supposed to do. Defined in JSON using the `WorkflowSpec` schema. Specifies nodes (trigger, llm, tool, evaluator, approval, artifact, etc.), edges between nodes, architecture type, permission classes, and eval references. The spec is the source of truth for what the workflow intends — it is not a runtime configuration.

## Layer 2: Trace Events

Runtime events emitted by connected projects as the workflow executes. Each `TraceEvent` has an `event_type` (e.g. `run_started`, `model_call_completed`, `tool_call_failed`), a `run_id`, a `workflow_id`, an optional `node_id`, a timestamp, and optional cost and duration fields. Trace events are the raw evidence of what actually happened.

## Layer 3: Proof Layer

Validation and assertion functions that run against collected trace events. The proof layer checks that a run conforms to the declared workflow spec and to structural trace contracts. It produces a `ContractResult` with a list of violations. The proof layer is deterministic — it does not call any model.

## Layer 4: Eval Results

Pass/fail assertions on trace output, ingested as `EvalResult` records. Each eval is linked to a `run_id` and optionally a `node_id`. Evals have a type (output_quality, safety, schema_validity, etc.) and a severity (info, warning, fail, critical). Critical safety evals that fail block a run from being marked as completed. Failing evals at "fail" severity mark a run as degraded.

## Layer 5: Run Record

A summary of the full execution. `RunRecord` aggregates total duration, total cost, model call count, tool call count, eval pass/fail counts, approval status, and artifact references. It is derived from trace events and eval results. Status is one of: running, completed, failed, degraded, pending.

## Layer 6: Dashboard

An inspection UI that presents run records, trace timelines, eval results, and workflow spec overlays. The dashboard is read-only in v1. It does not initiate runs, does not modify workflows, and does not call models.

Task 2 implements this as a static proof UI backed by local example JSON files only:

- `examples/workflows/*.json` provide workflow specs.
- `examples/traces/*.json` provide chronological trace events.
- `examples/evals/*.json` provide eval results linked by `run_id`.
- `examples/runs/*.json` provide run records and dashboard summaries.
- `lib/proof-layer/examples.ts` validates and exposes static loader helpers for the dashboard.

The UI routes are:

- `/dashboard` — overview metrics, recent workflows, recent failures, and workflow gallery preview.
- `/dashboard/workflows` — Workflow Registry (registered contracts) + Example Workflows (static demo data).
- `/dashboard/workflows/[workflowId]` — example workflow inspector (from static examples).
- `/dashboard/workflows/registry/[registryId]` — registered workflow detail (from Workflow Registry).
- `/dashboard/runs/[runId]` — run detail with trace timeline, model calls, tool calls, evals, errors/retries, artifacts, cost, and latency. Links to matching registered WorkflowSpec if found.

The scanner surface adds a fifth route:

- `/dashboard/scanner` — repository scanner (access-key gated, separate from the proof layer).

The integrations surface adds a sixth route group:

- `/dashboard/integrations` — Project Integrations list (status, mode, last event, run count).
- `/dashboard/integrations/[integrationId]` — Integration detail: connection status, env block, language snippets, test-event button, recent runs, troubleshooting.

This layer does not add a database, authentication changes, external API calls, workflow execution, or scanned-repository execution.

## Global Dashboard Access Gate

All `/dashboard/*` routes are protected by a single client-side access gate backed by
`AGENTPULSE_ACCESS_KEY`. The gate is implemented in `components/dashboard/DashboardShell.tsx`
and runs at the dashboard layout level.

**Flow (Task 7A corrected):**
1. On mount, `DashboardShell` reads any stored key from `sessionStorage`.
2. If no key: the global access form is shown immediately — no navbar, no page content.
3. **If a key is found**: `DashboardShell` calls `POST /api/auth/validate` before unlocking. A neutral skeleton is shown while validating.
   - If `200`: key is valid → full dashboard renders.
   - If `401` (or network error): key is cleared → user sees "Access key expired or invalid. Please unlock again."
4. User enters key → validated against `POST /api/auth/validate`.
5. On success: key stored in `sessionStorage`; full dashboard renders.
6. Any protected API call returning `401` calls `onUnauthorized()` via `DashboardAuthContext`, which clears the key and re-shows the access gate.
7. User can explicitly lock via the "Lock dashboard" button in the navbar.

**Do not trust `sessionStorage` alone.** The stored key is always revalidated server-side on mount.

**Centralised `onUnauthorized`**: All dashboard pages and components that call protected endpoints use `useDashboardAuth().onUnauthorized("Access key expired or invalid. Please unlock again.")` on `401`. This ensures the whole shell returns to locked state, not just one component.

**Overview live runs**: `app/dashboard/page.tsx` is a server component with no direct store access. Live runs are loaded by `components/dashboard/OverviewLiveRuns.tsx` — a client component that fetches `GET /api/runs?limit=5` with `mergeAuthHeaders()` after the shell unlocks.
5. If any API call later returns 401: `onUnauthorized()` clears the key and returns to the gate.
6. User can explicitly lock via the "Lock dashboard" button in the navbar.

**Important:** The Repository Scanner no longer owns its own access model.
The global gate replaces the isolated scanner gate.

`POST /api/auth/validate` accepts `x-agentpulse-key` and returns `{ ok: true, scope: "dashboard" }` on success or `{ ok: false, error: "Invalid access key." }` on failure (401). The expected key is never returned in the response.

## Access Model

The scanner and all protected API routes require an `AGENTPULSE_ACCESS_KEY` environment variable set server-side. The HTTP header name is `x-agentpulse-key`. All three protected routes — `/api/repos`, `/api/scan`, and `/api/scan-zip` — call `requireAccessKey(request)` before any other logic.

Client-side:
- `DashboardShell` validates the candidate key against `POST /api/auth/validate` before storing it.
- A `200` response stores the key in `sessionStorage` and unlocks the full dashboard.
- A `401` response shows "Invalid access key." and does not unlock.
- Any subsequent `401` from any dashboard API call clears the stored key and returns the user to the global access gate.
- The key is never stored in `localStorage`, never sent to the browser via `NEXT_PUBLIC_` env vars, and never written to the page source.

## Workflow Registry (Task 9)

The Workflow Registry is the central store of known WorkflowSpecs. It links static scan/reconstruction output to the runtime proof layer through a shared `workflow_id`.

### Sources

| Source | Description |
|--------|-------------|
| `example` | Built-in demo specs (Website Auditor, etc.) |
| `scan_reconstruction` | Promoted from a static proof reconstruction |
| `manual` | Manually authored and saved via API |
| `runtime_observed` | Inferred from runtime trace events (future) |

### Status lifecycle

`draft` → `needs_review` → `active` (or `archived`)

- `active`: high confidence, no critical missing fields.
- `needs_review`: medium/low confidence or missing fields present.
- `draft`: manually provided or incomplete spec.
- `archived`: explicitly removed from active use.

### Storage

`lib/workflows/workflowStore.ts` is file-backed, following the same pattern as `fileReportStore` and `fileRunStore`. Persists under `${AGENTPULSE_STORE_DIR}/workflows/`.

Deduplication: if a workflow with the same `workflowId + sourceReportId` already exists, `saveWorkflow()` updates/replaces the existing entry.

### API Routes

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/workflows/promote` | Promote a spec into the registry |
| `GET`  | `/api/workflows` | List registry summaries (with filters) |
| `GET`  | `/api/workflows/[registryId]` | Get full saved WorkflowSpec |
| `PATCH` | `/api/workflows/[registryId]` | Update status |
| `DELETE` | `/api/workflows/[registryId]` | Delete registry entry |

All routes require `x-agentpulse-key` (AGENTPULSE_ACCESS_KEY).

### Promotion flow

1. Scan a repository → scan report saved.
2. Generate proof spec from Static Proof Reconstruction.
3. Click "Promote to Workflow Registry" → `POST /api/workflows/promote`.
4. Status is assigned: `active` (high confidence, no missing fields) or `needs_review`.
5. Registered spec appears in `/dashboard/workflows` under "Workflow Registry".
6. Runtime runs that emit matching `workflow_id` link to the registered spec automatically.

### Run → Spec linking

`/dashboard/runs/[runId]` queries `GET /api/workflows?workflowId=<run.workflow_id>`. If a matching registry entry is found, it is shown as a "Linked spec" chip in the Workflow Execution card. If not found, the UI shows a "Promote a spec →" link.

### Demo WorkflowSpec

`POST /api/runs/demo` upserts the Website Auditor demo WorkflowSpec into the registry alongside the run, so the demo run detail page immediately shows a linked spec.

## Demo Run

`POST /api/runs/demo` creates a complete, self-contained Website Auditor demo run using the existing run store and trace schemas. It is designed so the runtime proof layer is explorable from the dashboard UI without any external project integration.

- Requires `AGENTPULSE_ACCESS_KEY` (dashboard key, not ingest key).
- Creates 8 workflow nodes, 4 model calls, 3 tool calls, 4 eval results, 1 artifact.
- Marks the run as `degraded` (a source grounding eval warning is included by design to show the degraded state).
- All events are validated with Zod schemas before storage.
- All trace events satisfy `assertTraceContract`.
- Also upserts the Website Auditor WorkflowSpec into the Workflow Registry (`source: "example"`, `status: "active"`).
- Returns `{ ok: true, runId: "demo-...", redirectTo: "/dashboard/runs/{runId}" }`.

The demo run is for product testing only. Real external integrations use the ingest endpoints below.

## How Connected Projects Send Trace Events

Connected projects (Campaign Sandbox, Website Auditor, etc.) emit `TraceEvent` objects to AgentPulse during or after a run. Task 5 introduced a real file-backed ingestion layer. Projects POST events to the AgentPulse ingestion API using the `AGENTPULSE_INGEST_KEY`.

Each event includes a `run_id` and `workflow_id` that bind it to a specific run and workflow spec. Events for the same run are collected and then passed to `assertTraceContract` for validation.

See [docs/integrations/campaign_sandbox.md](integrations/campaign_sandbox.md) for the Campaign Sandbox integration guide.

### Authentication: Two Keys

| Key | Purpose |
|-----|---------|
| `AGENTPULSE_INGEST_KEY` | External AI projects use this to POST trace events. Should only be shared with connected projects. |
| `AGENTPULSE_ACCESS_KEY` | Dashboard and scanner access. Not shared externally. |

In local/dev environments, if `AGENTPULSE_INGEST_KEY` is unset, AgentPulse falls back to `AGENTPULSE_ACCESS_KEY` for convenience. In production they must differ.

### File-Backed Storage Limitations

The default store (`lib/runs/runStore.ts`, `lib/reports/reportStore.ts`) is file-backed:

- **Local/dev**: writes to `.agentpulse/runs/` and `.agentpulse/reports/` in the project root.
- **Vercel**: set `AGENTPULSE_STORE_DIR=/tmp/agentpulse`. The `/tmp` directory is ephemeral — it is wiped on redeployment and is not shared across serverless function instances. Data loss is expected.
- **Durable storage**: replace `fileRunStore` / `fileReportStore` with a Postgres, Vercel Blob, Supabase, or Neon adapter behind the same `RunStore` / `ReportStore` interface.

File-backed storage is appropriate for local development, demos, and single-instance private use.

## How the Proof Layer Validates Traces

1. Collect all `TraceEvent` objects for a `run_id`.
2. Call `assertTraceContract(traceEvents)` to check structural rules.
3. Call `classifyFailure(traceEvents, evalResults)` to determine failure type and severity.
4. Call `summarizeRun(traceEvents, evalResults)` to produce a `RunSummary`.

The proof layer never executes workflow code. It only inspects event records. `emitTraceEvent(event: unknown)` validates with `validateTraceEvent` before storing and returns the validated event, so malformed events cannot enter the in-memory buffer.

## What Is NOT in Scope for v1

- AgentPulse does not run workflows.
- AgentPulse does not make live model calls.
- AgentPulse does not install or execute code from connected projects.
- AgentPulse does not persist run data to a database (in-memory only in v1).
- AgentPulse does not send trace events to external services.
- AgentPulse does not execute scanned repositories.
- AgentPulse does not build or publish workflows from the dashboard.

---

## Scanner Architecture (v1 — Static Repo Auditor)

The following sections describe the static scanner that remains active from v1. It inspects repository files without executing them.

`ai_application` is set when the scanner finds AI SDK imports (`openai`, `@anthropic-ai`, `langchain`, etc.), AI API env variable names, or AI function call patterns without an explicit manifest. This covers repos with model-powered features that haven't been structured as agent or workflow systems.

### Eval vs Test Detection

- **detectedEvals**: files in `/evals/`, `/evaluations/`, `/evaluators/`, promptfoo configs, and YAML/JSON eval manifests. These are dedicated AI evaluation assets.
- **detectedTests**: files in `/tests/`, `/__tests__/`, `*.test.*`, `*.spec.*`. These are standard software tests.

Generic test files are never counted as AI evals. If tests exist but no explicit evals, the finding reads "No dedicated AI eval suite detected" at medium severity. If neither exists, it reads "No tests or evals detected" at high severity.

### Prompt Detection

Only genuine prompt assets are classified as `prompt`:
- Files in `/prompts/` directory
- Files named `system-prompt*` or `system-persona.md`
- Files matching `*.prompt.{md,ts,txt,js}`
- Python prompt modules: `prompts.py` or `*_prompts.py` that contain uppercase `_PROMPT` constants (e.g., `RESEARCH_PLAN_PROMPT = "..."`)
- Files with explicit prompt language in content that are not in source/test/assistant-tooling directories

Not classified as prompt assets:
- Test files with "prompt" in the filename (e.g., `prompt-input.test.ts`) → classified as `test`
- LLM client/provider files (`llm/client.py`, `providers/openai.ts`) → classified as `source_code` and detected as LLM infrastructure
- Files under assistant tooling paths (`.claude/**`, `.cursor/**`) → classified by their own rules and reported as assistant tooling

### Assistant Tooling vs Product Scope

AgentPulse distinguishes **product AI system artifacts** from **developer-assistant tooling**:

**Assistant tooling paths** (excluded from product counts):
- `.claude/**` — Claude Code skills, hooks, settings
- `.cursor/**` — Cursor AI rules and configurations
- `.vscode/**` — VS Code editor settings
- `.windsurf/**` — Windsurf AI configurations
- `.github/copilot/**` — GitHub Copilot customizations

Files under these paths are reported in `detectedAssistantTooling` with a kind label (`claude_skill`, `cursor_rule`, `vscode_config`, `assistant_agent`, `assistant_prompt`, `other`). They do **not** contribute to `detectedAgents`, `detectedPrompts`, or project type determination.

**Product AI agent detection** (Python module patterns):
- `**/agents/*_agent.py` → e.g., `editor_agent.py` → `Editor Agent`
- `**/agents/*_evaluator.py` → e.g., `fact_check_evaluator.py` → `Fact Check Evaluator`
- `**/agents/*_judge.py`, `*_critic.py`, `*_planner.py`, `*_router.py`, `*_researcher.py`, `*_writer.py`, `*_editor.py`

These are detected as `agent_file` with `medium` confidence and title-case formatted names. Prompt/tool/eval links remain "Not mapped" unless a manifest explicitly links them.

**LLM infrastructure** (separate from prompt assets):
- Files in `/llm/` directories (e.g., `llm/client.py`)
- Provider files (e.g., `providers/openai.ts`) containing AI provider names
- Files named `modelProvider.ts`, `aiClient.py`, etc.

Reported in `detectedLLMInfrastructure`, not counted as prompts.

## Redaction and Secret Calibration

Secret redaction runs before report output and before any future LLM auditor input. Matches are classified into high, medium, or low confidence. Only high- and medium-confidence matches are redacted and reported as findings.

### Severity Calibration by File Context

Secret finding severity is calibrated by file context at report generation time:

| Confidence | Production/Config | Test/Docs/Example | CI | Placeholder |
|---|---|---|---|---|
| High | high / 0.95 | medium / 0.6 | medium / 0.65 | info / 0.25 |
| Medium | medium / 0.75 | low / 0.45 | low / 0.65 | info / 0.25 |

Placeholder values (stub, changeme, ci-stub, your-key-here, etc.) are always `info` severity regardless of context.

Credential-free or localhost database URLs (e.g., `postgres://localhost/db`) are always `info` severity.

Recommendations reflect the context:
- Production: "Remove this value from the repository and rotate it if it was real."
- Test/docs: "Review this test/example value. If it is real, move it to environment variables and rotate it."
- Placeholder: "Placeholder/stub value detected; no rotation required unless this represents a real credential."

## Auditor Layer

Auditors are typed interfaces that accept a `ScanReport` and return structured findings. Current auditors are placeholders; future versions can call LLMs with redacted evidence only.

The architecture auditor does not flag missing agent boundaries for workflow-only projects.

### Maintainability Auditor

`lib/auditors/maintainabilityAuditor.ts` is a fully deterministic auditor (no LLM calls) that measures how easy and safe the AI system is to evolve. It runs as part of the `runAuditors` pipeline.

Checks performed:
- **A. Large files** — source files (not tests/docs/lockfiles) flagged at 500+ (medium) and 800+ (high) lines
- **B. Scanner/router concentration** — large files in scanner/, reports/, routing/ paths with many exports
- **C. TODO/FIXME markers** — deferred-work markers across source files
- **D. Schema version** — checks for `reportVersion` field in type/schema files
- **E. Dashboard complexity** — UI components over 300 lines in components/, dashboard/ directories
- **F. Duplicate recommendation wording** — repeated recommendation phrases across auditor/report files
- **G. Golden fixtures** — tests present but no golden report fixtures detected
- **H. Documentation drift** — docs missing references to major project-type concepts

The maintainability auditor returns a `maintainabilityScore` (0–100, floor 20) and `MaintainabilityMetrics` that are attached to the `ScanReport`. The score is factored into the overall score at 10% weight.

## Scoring

Scores cover architecture, prompt quality, tool governance, eval coverage, security, and documentation. Overall score is weighted from those categories.

Security scoring uses confidence-aware penalties. Because secret severity is calibrated at finding creation time by file context, docs/test/example secrets no longer drive the security score to 0. Only production secrets with high confidence produce large penalties.

## AI System Graph

AgentPulse reconstructs a typed AI system graph after detection.

Nodes: `agent`, `workflow`, `workflow_step`, `prompt`, `tool`, `model`, `provider`, `eval`, `data_source`, `approval_gate`, `artifact`, `external_side_effect`, `assistant_tooling`, `unknown`.

Edges: `uses_prompt`, `calls_tool`, `uses_model`, `provided_by`, `evaluated_by`, `contains_step`, `depends_on`, `produces`, `reads_from`, `writes_to`, `requires_approval`, `has_permission`, `related_to`, `inferred_from`.

Confidence rules:
- Manifest entries: high confidence.
- File-path matches: medium confidence.
- Prompt-only inference: low confidence.

Detected ≠ mapped. A detected prompt becomes a prompt node, but only an explicit `agents.yaml` entry or workflow stage produces a `uses_prompt` edge to an agent or step. The same applies to tools, evals, and models.

Graph warnings cover: `agent_missing_prompt`, `agent_missing_tools`, `agent_missing_evals`, `agent_missing_model`, `workflow_missing_steps`, `tool_missing_permission`, `eval_not_mapped`, `prompt_not_mapped`, `model_not_mapped`, `performance_data_missing`, `assistant_tooling_not_product`.

## Model / Provider Detection

Deterministic model detection runs after agent/workflow detection.

Sources:
- **Manifest** (high confidence): `model: { provider, name }` in agents.yaml or workflow stages.
- **Code** (medium): explicit model strings like `gpt-4o`, `claude-3-5-sonnet`, `gemini-2.5-flash`, `mixtral-8x7b`, etc.
- **Env** (low): provider env var names in `.env.example` (e.g. `OPENAI_API_KEY`). No model name is inferred.
- **Import** (low): provider SDK imports (`openai`, `@anthropic-ai/sdk`, `@google/genai`, `groq-sdk`, etc.) with no model name.

Secret values are never exposed in `detectedModels` — only provider names and env-var names.

## Performance Data (optional)

If the repository ships eval/run metrics in well-known files (`eval-results.json`, `runs.json`, `metrics.json`, `traces.json`, `model-comparison.json`, `reports/evals/*.json`, `evals/results/*.json`), AgentPulse parses them into `modelPerformance` entries with `provider`, `model`, `eval_id`, `score`, `latency_ms`, `input_tokens`, `output_tokens`, and `cost_usd`.

AgentPulse does not claim one model is better than another unless these metrics exist in the scanned repository.

## Dashboard

The dashboard shows:
- Scan source, overall score, status, project type label
- Detected counts: agents, prompts, tools, AI evals, software tests, CI workflows, assistant tooling
- Score cards with explanations
- AI System Graph view (columns: workflows/steps, agents, prompts/tools/models, evals/artifacts/gates) with mapping summary
- Model / Provider Matrix: provider, model, source, confidence, eval coverage, performance availability
- Mapping Gaps panel with agent_missing_prompt/tool/eval/model warnings
- Agent cards with explicit/inferred/low-confidence badges, mapped prompts/tools/evals, model/provider, owner, and permissions
- AI/product workflow cards with explicit/inferred badges
- CI workflows section (separate from AI workflows)
- Assistant tooling section (separate from product agents)
- Findings with filters, confidence, and expandable evidence snippets
- Export controls (JSON and Markdown)
- De-duplicated recommended next actions

## Recommended Manifest Fields

For best results, agents.yaml should map each agent's `prompts`, `tools`, `evals`, and `model: { provider, name }`. For example:

```yaml
agents:
  - id: editor_agent
    name: Editor Agent
    source: blogagent/agents/editor_agent.py
    prompts:
      - blogagent/agents/prompts.py#DRAFT_PROMPT
    tools:
      - web_search
      - citation_lookup
    evals:
      - blogagent/evals/editor_quality.yaml
    model:
      provider: google
      name: gemini-2.5-flash
      temperature: 0.3
```

For workflows, stages should declare `agent`, `prompt`, `tools`, `model`, `evals`, and any `approval_gate`:

```yaml
workflow:
  id: blog_generation
  stages:
    - id: draft
      agent: editor_agent
      prompt: blogagent/agents/prompts.py#DRAFT_PROMPT
      model:
        provider: google
        name: gemini-2.5-flash
      evals:
        - blogagent/evals/editor_quality.yaml
```

---

## Durable Report Storage (Task 4)

### Report Schema Versioning

Every scanner report now includes identity and version fields:

- `reportVersion` — schema version (`"2.0"`). Tests fail if missing.
- `reportId` — unique ID per scan (`rpt_<base36-timestamp>_<hex>`).
- `projectId` — stable per repository (`proj_<reponame>`). Groups history.
- `scanId` — equals `reportId` for v1.
- `scannerVersion` — static scanner build version (`agentpulse-static-scanner-v2`).
- `generatedAt` — ISO timestamp when the report was generated.

### Report Persistence Adapter

`lib/reports/reportStore.ts` provides a `ReportStore` interface:

```typescript
interface ReportStore {
  saveReport(report: ScanReport): Promise<SaveResult>;
  listReports(filters?): Promise<SavedReportSummary[]>;
  getReport(reportId): Promise<SavedReport | null>;
  deleteReport(reportId): Promise<boolean>;
}
```

The default implementation (`fileReportStore`) is file-backed:

```
.agentpulse/reports/
  index.json           — list of SavedReportSummary[], newest first
  {reportId}.json      — full SavedReport with savedAt timestamp
```

Override `AGENTPULSE_STORE_DIR` to change the storage directory.
Failures are non-fatal: persistence errors are returned as `{ saved: false, warning }` without crashing the scan.

### Report Diff

`lib/reports/reportDiff.ts` provides `diffReports(base, target)`:
- Score deltas (overall + per category)
- Finding diff: added / resolved / unchanged / worsened / improved
- Finding identity: `category::title` (normalized, case-insensitive)
- New high risks / resolved high risks
- Status change string (`"healthy → needs-attention"`)
- Detected count deltas (agents, workflows, prompts, tools, evals, tests)
- Regression candidates (see below)

### Regression Candidates

`lib/reports/regressionCandidates.ts` generates deterministic test suggestions:
- New high/critical findings → `"high"` severity candidate
- New security findings → security regression candidate
- Score drop ≥5 pts → score regression candidate per dimension
- Missing `reportVersion` → schema contract candidate
- Missing golden fixtures → golden fixture candidate
- Workflow count decrease → workflow mapping candidate

All candidates have stable IDs (`rc_<projectId>::<category>::<title>`) so the same diff always produces the same candidate IDs.

### UI Routes

| Route | Description |
|---|---|
| `/dashboard/reports` | Scan history list (client, loads from API) |
| `/dashboard/reports/[reportId]` | Saved report detail (reuses scanner UI) |
| `/dashboard/reports/compare` | Report diff view with regression candidates |

### API Routes

| Route | Auth | Description |
|---|---|---|
| `GET /api/reports` | `x-agentpulse-key` | List saved report summaries |
| `GET /api/reports/[reportId]` | `x-agentpulse-key` | Get full saved report |
| `DELETE /api/reports/[reportId]` | `x-agentpulse-key` | Delete a saved report |

### Golden Fixtures

`tests/fixtures/reports/` contains minimal but valid `ScanReport` JSON fixtures for:
- `minimal-unknown.json` — no agents, no workflows
- `agent-missing-config.json` — AI application with prompt but no manifest
- `report-with-version.json` — workflow system with `reportVersion: "2.0"`

Tests in `lib/reports/__tests__/reportSchema.test.ts` verify that all fixtures include `reportVersion`, `reportId`, `projectId`, and `scannerVersion`.

### Why File-Backed (Not DB)

The file store is appropriate for a single-user local dashboard:
- No external dependency (no Postgres, no Redis)
- Reports are plain JSON — readable without tooling
- Zero setup for new contributors
- Interface is swappable: replace `fileReportStore` with a DB adapter later

Future path: replace `fileReportStore` with a Vercel Blob or Postgres adapter behind the same `ReportStore` interface.

---

## Static Proof Reconstruction (Task 6)

Task 6 adds a **zero-instrumentation path**: AgentPulse can scan any repository and immediately produce a suggested WorkflowSpec, AI system graph, mapping summary, missing-link report, and optional instrumentation plan — without requiring any code changes in the target project.

### Two Levels of Proof

| Mode | What it needs | What it produces |
|---|---|---|
| **Static inspection** | Only a scan report (static repo analysis) | Suggested WorkflowSpec, AI system graph, missing-link report, optional instrumentation guide |
| **Instrumented proof** | Trace events emitted by the connected project | Real run timelines, eval results, trace contract validation, cost/latency data |

Static inspection is the entry point. Instrumented proof is the upgrade path — and it is always optional.

### Reconstruction Engine

`lib/reconstruction/reconstructWorkflowSpec.ts` exports `reconstructFromScanReport(report: ScanReport): StaticProofReconstruction`.

The function is **deterministic** — it reads only `ScanReport` fields and applies pure functions. It makes no external API calls, executes no code, and never installs dependencies.

**Confidence levels:**

| Level | Condition |
|---|---|
| `high` | Explicit workflow manifest with stagesDetailed or agents.yaml with mapped agents |
| `medium` | Workflow files present, or manifest agents exist without full mapping |
| `low` | No manifest; only scattered artifacts (prompts, tools, evals detected but not linked) |

### Output Types

`lib/reconstruction/types.ts` defines:

| Type | Description |
|---|---|
| `StaticProofReconstruction` | Top-level result: reconstructionId, confidence, workflowSpecs, systemGraph, mappingSummary, missingLinks, suggestedFiles, instrumentationPlan |
| `SuggestedWorkflowSpec` | WorkflowSpec extended with source, confidence, evidencePaths, missingFields, recommendations |
| `MappingSummary` | Counts of mapped/unmapped agent→prompt/tool/eval/model; workflow stage coverage |
| `MissingLink` | Gap record with type (`agent_missing_prompt`, `agent_missing_model`, `eval_unmapped`, etc.), agentId/workflowId, severity, and suggestion |
| `InstrumentationPlan` | Always `required: false`, `available: true`; per-stage event suggestions and code hints |
| `ReconstructedSystemGraph` | Lightweight nodes/edges for UI rendering |

### Suggested Files

`lib/reconstruction/suggestedFiles.ts` generates three output files from the reconstruction:

| File | Description |
|---|---|
| `agentpulse.workflow.suggested.json` | WorkflowSpec JSON with `_generated_by`, `_confidence`, and `_note` metadata. Paste into `examples/workflows/` to use with the proof dashboard. |
| `ai-system.suggested.yaml` | YAML summary of agents, workflows, models, tools, and evals detected in the repo. |
| `instrumentation-plan.suggested.md` | Markdown guide with env vars, per-stage event suggestions, and a code snippet — clearly marked as optional. |

These files are never written to disk by AgentPulse. They are returned in the API response and rendered in the UI with copy/download controls. The scanned project can choose to adopt them, ignore them, or modify them.

### Missing Links

The reconstruction identifies structural gaps between detected artifacts and the declared spec:

| Type | Description |
|---|---|
| `agent_missing_prompt` | Agent has no mapped prompt file |
| `agent_missing_model` | Agent has no model/provider declared |
| `agent_missing_tools` | Agent has no tool declarations |
| `agent_missing_evals` | Agent has no eval file mapped |
| `workflow_missing_stages` | Workflow detected but no stages found |
| `prompt_unmapped` | Prompt file detected but not linked to any agent or stage |
| `eval_unmapped` | Eval file detected but not linked to any agent or stage |
| `model_unmapped` | Model detected but not mapped to any agent or stage |

Missing links have stable IDs (`ml_<type>_<projectId>_<entityId>`) and are deduplicated across all specs. They do not imply the project is broken — only that the static representation is incomplete.

### API Routes

| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/api/reports/[reportId]/reconstruction` | Access key | Reconstruct from a saved scan report |
| `POST` | `/api/reconstruct` | Access key | Reconstruct from inline report body or saved reportId |

### UI Integration

- **Scanner result page** (`/dashboard/scanner`) — "Static Proof Reconstruction" section with "Generate proof spec" button
- **Scan history** (`/dashboard/reports`) — "Reconstruct" link per report card
- **Saved report detail** (`/dashboard/reports/[reportId]`) — "Generate proof spec" link
- **Reconstruction page** (`/dashboard/reports/[reportId]/reconstruction`) — dedicated page with confidence badge, workflow spec cards, mapping coverage bars, missing-links list, suggested-file tabs with preview/copy/download

### Limitations

1. **Static inference can be wrong.** The reconstruction is a best-effort reading of file names, directory structure, and manifest fields. It does not execute the project.
2. **Unmapped does not mean broken.** A missing link only means AgentPulse cannot confirm a relationship from static evidence — the relationship may exist at runtime.
3. **Model/provider is inferred, not verified.** If no manifest declares `model: { provider, name }`, the reconstruction can suggest where to add it but cannot guarantee the suggestion matches runtime behavior.
4. **Runtime proof requires trace events.** Static reconstruction produces a suggested spec. Runtime proof (real run timelines, eval pass/fail, cost/latency) requires the connected project to emit trace events — which is always optional.
5. **AgentPulse does not execute scanned repositories.** This is non-negotiable. All reconstruction is based on file evidence only.

---

## Task 6A — Reconstruction Correctness + Schema Hardening

Task 6A makes static proof reconstruction stricter, runtime-validated, and impossible to misread.

### Evidence Gate

Static reconstruction is now gated by `hasStaticProofEvidence(report)`. Reports that contain only CI workflows, generic tests, package files, README mentions of AI, or assistant tooling (`.claude/`, `.cursor/`, etc.) produce **no** WorkflowSpec.

Evidence requires at least one of:
- Detected agent (`detectedAgents.length > 0`)
- Detected workflow manifest (`detectedWorkflowsDetailed.length > 0`)
- Detected prompts / tools / evals / models
- System graph nodes scoped to `product` (not `assistant_tooling`, `ci`, `docs`)
- `projectType` in `agent_system`, `workflow_system`, `hybrid_workflow_agent`

An `ai_application` classification by itself, with no AI artifacts, is **not** evidence.

### No Fake WorkflowSpec

When no evidence is present, the engine returns:

- `workflowSpecs: []`
- `confidence: "low"`
- `missingLinks: []`
- `systemGraph: { nodes: [], edges: [] }`
- `suggestedFiles: [no-reconstruction.md]` — a single explanation-only file
- `instrumentationPlan.required: false`, `summary` explicitly states no reconstruction was generated

The previous fallback that produced `<projectId>-unknown` with a trigger-only `single_llm_call` node has been removed.

### Runtime Schema Validation

`lib/reconstruction/schema.ts` defines Zod schemas for every reconstruction output type:

- `staticProofReconstructionSchema`
- `suggestedWorkflowSpecSchema`
- `reconstructedSystemGraphSchema`
- `mappingSummarySchema`
- `missingLinkSchema`
- `suggestedManifestFileSchema`
- `instrumentationPlanSchema`

`reconstructFromScanReport` validates its output against `staticProofReconstructionSchema` before returning. The API routes re-validate before serializing. Tests fail if any reconstruction output is missing required fields.

### Clean API Contract

| Method | Route | Body |
|---|---|---|
| `GET` | `/api/reports/[reportId]/reconstruction` | (none) — loads saved report by ID |
| `POST` | `/api/reconstruct` | `{ reportId: string }` *or* `{ report: ScanReport }` (validated against `scanReportSchema`) |

Behaviors:
- Missing `x-agentpulse-key` → `401`
- Missing `reportId` → `404`
- Missing body / missing both `reportId` and `report` → `400`
- Both `reportId` and `report` provided → `400`
- Malformed `report` (fails `scanReportSchema`) → `400` with structured `issues`
- The deprecated `POST /api/reports/[reportId]/reconstruction` handler has been removed; the `GET` form is canonical.

### Shared Eval Conversion

`lib/proof-layer/evalFromTrace.ts` exports `tryBuildEvalResultFromTraceEvent(event)`:

- Returns `null` for any event whose `event_type !== "eval_completed"`
- Returns `null` when `metadata` is missing or required fields (`eval_id`, `eval_name`) are absent
- Never throws — malformed metadata produces `null`
- `POST /api/traces/events` calls this helper to derive `EvalResult` records during ingestion

Tests now import the production helper directly instead of duplicating the conversion logic.

---

## Project Integrations (Task 11)

Task 11 adds a **repeatable live-pulse integration path**: a standard way for any external AI project to connect to AgentPulse and emit runtime trace events.

### Three Levels of Integration

| Level | What is needed | What it produces |
|---|---|---|
| **Static scan** | No code changes | Scan reports, Static Proof Reconstruction, WorkflowSpec suggestions |
| **Integration template** | Env vars + small adapter file | Real runtime runs, model call data, evals, cost, latency |
| **Gateway (future)** | Collector or OTLP bridge | Multi-source fan-in, batch ingestion |

### Integration Registry

`lib/integrations/` is a file-backed store following the same pattern as `fileRunStore`, `fileReportStore`, and `fileWorkflowStore`.

Each `ProjectIntegration` record tracks:

- `integrationId` — stable ID (`integ_<ts>_<hex>`)
- `projectId` / `projectName` — project identity
- `defaultWorkflowId` — optional workflow to link runs to
- `status` — `waiting_for_first_event` → `receiving_events` (or `stale` / `error`)
- `mode` — `trace_sdk` | `static_only` | `manual_trace_import` | `gateway_future`
- `language` — `typescript` | `python` | `other`
- `lastEventAt` / `lastRunId` / `lastRunStatus` / `runCount` — live connection health

### Status Lifecycle

```
configured / waiting_for_first_event
  → receiving_events (first trace event arrives for this projectId)
  → stale (lastEventAt older than 7 days, computed at read-time)
  → error (explicit error recorded)
```

When a new run starts (`POST /api/runs/start`) or trace events arrive (`POST /api/traces/events`), `touchIntegrationForProject(projectId)` is called server-side. This is non-fatal: persistence errors are logged but never propagate to callers.

If no integration exists for an incoming `project_id`, a lightweight integration is auto-created with `mode: "trace_sdk"` and `status: "receiving_events"`.

### API Routes

| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/api/integrations` | `x-agentpulse-key` | List integrations (filters: status, mode, language, projectId) |
| `POST` | `/api/integrations` | `x-agentpulse-key` | Create a new integration |
| `GET` | `/api/integrations/[integrationId]` | `x-agentpulse-key` | Get integration + recent runs |
| `PATCH` | `/api/integrations/[integrationId]` | `x-agentpulse-key` | Update fields |
| `DELETE` | `/api/integrations/[integrationId]` | `x-agentpulse-key` | Delete integration (not runs) |
| `POST` | `/api/integrations/[integrationId]/test-event` | `x-agentpulse-key` | Create a server-side test run for this integration |

The test-event route uses the **dashboard key** (not the ingest key) and creates a small run with 1 model call and 1 eval entirely server-side. Purpose: verify the AgentPulse pipeline works for the project identity before the external project is instrumented.

### Integration Templates

`examples/integrations/` provides copy-pasteable client files:

- `typescript/agentpulseClient.ts` — zero-dependency TypeScript client using built-in `fetch`
- `python/agentpulse_client.py` — zero-dependency Python client using stdlib `urllib`
- `rest/README.md` — curl-based REST examples

Both clients:
- Read env vars: `AGENTPULSE_URL`, `AGENTPULSE_INGEST_KEY`, `AGENTPULSE_PROJECT_ID`, `AGENTPULSE_PROJECT_NAME`, `AGENTPULSE_WORKFLOW_ID`, `AGENTPULSE_ENABLED`
- Are complete no-ops when `AGENTPULSE_ENABLED` is not `"true"` — safe for local dev without AgentPulse
- Never log or expose the ingest key

### How to Connect a Project

1. Add an integration in AgentPulse (`/dashboard/integrations` → Add integration).
2. Copy the env block from the integration detail page into the external project.
3. Copy `agentpulseClient.ts` or `agentpulse_client.py` into the project.
4. Wrap the project's main workflow with `startRun()` / `modelCallCompleted()` / `completeRun()`.
5. Run the external project.
6. Confirm the run appears in AgentPulse → Runs.
7. Check integration status in `/dashboard/integrations`.

**Environment variables alone do not send events.** The adapter must be imported and called.

### Security

- Dashboard integration routes require `AGENTPULSE_ACCESS_KEY`.
- External ingestion routes (`/api/runs/start`, `/api/traces/events`, `/api/runs/complete`, `/api/runs/fail`) require `AGENTPULSE_INGEST_KEY` (falls back to `AGENTPULSE_ACCESS_KEY` in dev).
- The ingest key is never returned in any API response or rendered in the browser.
- Project-specific ingest keys are not implemented in V0. All projects share the global ingest key.
