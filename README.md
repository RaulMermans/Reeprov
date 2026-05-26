# AgentPulse

AgentPulse is a private observability and proof layer for agentic AI workflows.

It accepts trace events from external AI projects, validates them, stores them as inspectable run timelines, and answers: **what happened, why, how much did it cost, and did it pass?**

AgentPulse also includes a repository scanner for auditing AI-agent and AI-workflow repositories: detecting agents, workflows, prompts, tools, evals, secrets, and scoring the codebase.

AgentPulse is not a public SaaS, not multi-user, not a workflow runtime, and does not execute AI project code.

## Quick Start

```bash
npm install
cp .env.example .env.local
# Edit .env.local with your values (see Environment Variables below)
npm run dev
```

Open `http://localhost:3000/dashboard` to see the dashboard.

To emit a sample trace run into the store without a live AI project:

```bash
npm run seed:traces
# Then visit: http://localhost:3000/dashboard/runs
```

## Environment Variables

| Variable                  | Required          | Description                                                                         |
|---------------------------|-------------------|-------------------------------------------------------------------------------------|
| `AGENTPULSE_ACCESS_KEY`   | **Yes**           | Dashboard and scanner access key. Stored in sessionStorage client-side. Must be a long random value. |
| `AGENTPULSE_INGEST_KEY`   | **Recommended**   | External trace ingestion key for connected AI projects. Should differ from `AGENTPULSE_ACCESS_KEY` in deployed environments. If unset, AgentPulse falls back to `AGENTPULSE_ACCESS_KEY` for local/dev convenience only. |
| `GITHUB_TOKEN`            | For scanner       | Server-side read-only GitHub token for repository scanning. Use a fine-grained token with `contents: read` on selected repos. |
| `AGENTPULSE_STORE_DIR`    | No                | Override the run/report storage directory (default: `.agentpulse/` in cwd). **On Vercel, set to `/tmp/agentpulse`** — but note `/tmp` is ephemeral and not durable across deployments or instances. For persistent storage, replace the file store adapter with Postgres, Vercel Blob, Supabase, or Neon. |
| `ENABLE_LLM_AUDITORS`     | No                | Set to `true` to enable LLM-based scanner auditors (disabled by default). Keep `false` in CI. |
| `LLM_PROVIDER`            | No                | `openai` or `anthropic`. Only used when `ENABLE_LLM_AUDITORS=true`.                |
| `OPENAI_API_KEY`          | Conditional       | Required only when `ENABLE_LLM_AUDITORS=true` and `LLM_PROVIDER=openai`.           |
| `ANTHROPIC_API_KEY`       | Conditional       | Required only when `ENABLE_LLM_AUDITORS=true` and `LLM_PROVIDER=anthropic`.        |
| `GOOGLE_API_KEY`          | Conditional       | Reserved for future Google LLM auditor support.                                     |

**Rules:**
- Never prefix secrets with `NEXT_PUBLIC_`. All secrets are server-side only.
- `AGENTPULSE_INGEST_KEY` and `AGENTPULSE_ACCESS_KEY` must be **different** in any deployed environment so that external projects cannot reach dashboard-only routes.
- File-backed storage (`.agentpulse/` or `/tmp/agentpulse`) is local/dev/demo-grade only. Vercel `/tmp` is not shared across serverless function instances and is erased on redeployment.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full deployment checklist.

## Trace Ingestion

External AI projects emit trace events to AgentPulse using the ingestion API.

### Quick integration

```typescript
import { AgentPulseClient } from "@/lib/proof-layer/client";

const pulse = new AgentPulseClient({
  endpoint: process.env.AGENTPULSE_URL!,
  apiKey:   process.env.AGENTPULSE_INGEST_KEY!,
  projectId: "my-project",
  projectName: "My Project",
  workflowId: "my-workflow-v1",
});

const run = await pulse.startRun({ summary: "Run description" });

await pulse.emitTraceEvent({
  event_id:   crypto.randomUUID(),
  run_id:     run.run_id,
  workflow_id: "my-workflow-v1",
  node_id:    "node-name",
  timestamp:  new Date().toISOString(),
  event_type: "model_call_completed",
  status:     "completed",
  cost_usd:   0.0042,
  metadata: { model_provider: "anthropic", model_name: "claude-sonnet-4-6" },
});

await pulse.completeRun({ run_id: run.run_id, summary: "Done." });
```

### API endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/runs/start` | Ingest key | Create a run |
| `POST` | `/api/traces/events` | Ingest key | Append trace events |
| `POST` | `/api/runs/complete` | Ingest key | Complete a run |
| `POST` | `/api/runs/fail` | Ingest key | Fail a run |
| `GET` | `/api/runs` | Access key | List runs |
| `GET` | `/api/runs/[runId]` | Access key | Get full run |
| `DELETE` | `/api/runs/[runId]` | Access key | Delete run |

Auth header: `x-agentpulse-key: <key>`

Trace events are validated before storage. Duplicate `event_id` values are silently skipped (idempotent ingestion). See [docs/trace_schema.md](docs/trace_schema.md) for the full schema.

### Seed script

The seed script creates a realistic Campaign Sandbox run without a live project:

```bash
npm run seed:traces
# View at: http://localhost:3000/dashboard/runs
```

## Repository Scanner

The scanner audits GitHub repos and ZIP uploads for AI system structure.

1. Start the dev server: `npm run dev`
2. Go to `http://localhost:3000/dashboard/scanner`
3. Enter your `AGENTPULSE_ACCESS_KEY`
4. Select a GitHub repo or upload a ZIP

Scanner results are saved to `.agentpulse/reports/` and viewable at `/dashboard/reports`.

## Static Proof Reconstruction

After scanning a repo, click **"Generate proof spec"** (or "Reconstruct" from the scan history) to produce a suggested WorkflowSpec, AI system graph, and optional instrumentation plan — without modifying the scanned project.

The reconstruction:

- Infers workflow stages from manifest files, detected agents, and file structure
- Identifies missing links (agents without prompts/models/evals, unmapped eval files)
- Generates 3 suggested files you can download or copy:
  - `agentpulse.workflow.suggested.json` — WorkflowSpec ready for the proof dashboard
  - `ai-system.suggested.yaml` — YAML agent/workflow/model inventory
  - `instrumentation-plan.suggested.md` — optional trace event guide with code snippet
- Assigns a confidence level: `high` (manifest-backed), `medium` (workflow files / manifest agents), `low` (scattered artifacts)

**No fake reconstructions.** If the scanner finds no agent, workflow, prompt, tool, eval, or model evidence — for example a CI/dashboard repo with no AI artifacts — the reconstruction returns `workflowSpecs: []` and a single explanation file (`no-reconstruction.md`). AgentPulse does not invent a placeholder WorkflowSpec for non-AI repos. Assistant tooling (`.claude/`, `.cursor/`) and CI workflows alone do not count as AI evidence.

**Suggested ≠ verified.** Suggested manifest files are starting points generated from static evidence. Review them before adopting them.

**Static proof ≠ runtime proof.** Static reconstruction describes intent inferred from files. Real run timelines, eval pass/fail, cost, and latency require trace events from the scanned project — which is always optional.

**Schema-validated output.** Every reconstruction returned by `/api/reconstruct` or `GET /api/reports/[reportId]/reconstruction` is validated against `staticProofReconstructionSchema` (Zod) before being serialized. Malformed objects never leave the engine.

**Instrumentation is always optional.** The reconstruction works without any changes to the scanned project. If you want real run timelines and eval results, the instrumentation plan explains how to add trace events using `AgentPulseClient`.

### Scan modes

- **GitHub repository**: enter `owner/repo`; AgentPulse fetches files with the server-side GitHub token
- **ZIP upload**: upload a `.zip` from GitHub; parsed in memory, never persisted, never executed

ZIP uploads are capped at 4 MB. For larger repos, use GitHub scanning.

## Access Model

AgentPulse uses a dual-key access model:

| Key | Purpose |
|-----|---------|
| `AGENTPULSE_ACCESS_KEY` | Protects all dashboard routes and scanner APIs |
| `AGENTPULSE_INGEST_KEY` | Used by external AI projects to POST trace events |

The dashboard prompts for the access key on first visit. The key is validated server-side
and stored only in `sessionStorage` for the current browser session. No cookies, no OAuth.

## Operating Modes

- **Live Proof Runs** — ingest and inspect trace events from connected AI projects (`/dashboard/runs`)
- **Static Repository Intelligence** — scan repos and ZIP files without code execution (`/dashboard/scanner`)
- **Workflow Registry** — inspect workflow specs and example proof data (`/dashboard/workflows`)
- **Saved Proof Reports** — review scan history, diffs, and reconstruction outputs (`/dashboard/reports`)

## Security Posture

- Repository code is never executed.
- Repository dependencies are never installed.
- GitHub token stays server-side.
- All protected routes require `x-agentpulse-key`.
- Secrets in scanned repos are redacted before reports.
- ZIP entries are checked for path traversal before scanning.
- Trace ingestion validates every event with Zod schemas before storage.
- External trace summaries are human-readable text only — no raw code or secret values stored.

## Store Layout

```
.agentpulse/
  runs/
    index.json          — run summaries, newest first
    {runId}.json        — full saved run
  reports/
    index.json          — report summaries, newest first
    {reportId}.json     — full saved scan report
```

Override the root directory with `AGENTPULSE_STORE_DIR`.

## Local CI

```bash
npm run ci
# runs: lint + typecheck + test + build
```

No `GITHUB_TOKEN`, `AGENTPULSE_ACCESS_KEY`, or provider API key required for CI. All tests use mock or static inputs.

## Dashboard Routes

| Route | Description |
|-------|-------------|
| `/dashboard` | Overview: live runs, quick nav, example metrics |
| `/dashboard/runs` | Real proof runs from trace ingestion |
| `/dashboard/runs/[runId]` | Run detail: trace timeline, evals, tool calls, model calls, artifacts |
| `/dashboard/workflows` | Workflow gallery (example proof data) |
| `/dashboard/scanner` | Repository scanner (access-key gated) |
| `/dashboard/reports` | Scan history with diff and regression candidates |
| `/dashboard/reports/[reportId]/reconstruction` | Static proof reconstruction for a saved scan report |

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system architecture (incl. Static Proof Reconstruction)
- [docs/trace_schema.md](docs/trace_schema.md) — trace event schema and ingestion API
- [docs/workflow_spec.md](docs/workflow_spec.md) — WorkflowSpec schema, SuggestedWorkflowSpec, static vs runtime proof
- [docs/product_direction.md](docs/product_direction.md) — product positioning and roadmap
- [docs/ROADMAP.md](docs/ROADMAP.md) — task history and upcoming work
- [docs/SECURITY.md](docs/SECURITY.md) — security model and deployment guidance
- [docs/SCORING_RUBRIC.md](docs/SCORING_RUBRIC.md) — scanner scoring rubric
