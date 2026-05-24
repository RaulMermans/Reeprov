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

| Variable                  | Required | Description                                                        |
|---------------------------|----------|--------------------------------------------------------------------|
| `AGENTPULSE_ACCESS_KEY`   | Yes      | Dashboard and scanner access key. Stored in sessionStorage client-side. |
| `AGENTPULSE_INGEST_KEY`   | Recommended | External trace ingestion key. If unset, falls back to `AGENTPULSE_ACCESS_KEY`. |
| `AGENTPULSE_STORE_DIR`    | No       | Override the run/report store directory (default: `.agentpulse/` in cwd). |
| `GITHUB_TOKEN`            | For scanner | Server-side read-only GitHub token for repository scanning.     |
| `ENABLE_LLM_AUDITORS`     | No       | Set to `true` to enable LLM-based auditors (disabled by default). |
| `LLM_PROVIDER`            | No       | `openai` (default). Provider for LLM auditors when enabled.       |
| `OPENAI_API_KEY`          | Conditional | Required only when `ENABLE_LLM_AUDITORS=true` and `LLM_PROVIDER=openai`. |
| `ANTHROPIC_API_KEY`       | Conditional | Reserved for future Anthropic LLM auditor support.              |

Never prefix secrets with `NEXT_PUBLIC_`. All secrets are server-side only.

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

### Scan modes

- **GitHub repository**: enter `owner/repo`; AgentPulse fetches files with the server-side GitHub token
- **ZIP upload**: upload a `.zip` from GitHub; parsed in memory, never persisted, never executed

ZIP uploads are capped at 4 MB. For larger repos, use GitHub scanning.

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

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system architecture
- [docs/trace_schema.md](docs/trace_schema.md) — trace event schema and ingestion API
- [docs/product_direction.md](docs/product_direction.md) — product positioning and roadmap
- [docs/ROADMAP.md](docs/ROADMAP.md) — task history and upcoming work
- [docs/SECURITY.md](docs/SECURITY.md) — security model and deployment guidance
- [docs/SCORING_RUBRIC.md](docs/SCORING_RUBRIC.md) — scanner scoring rubric
