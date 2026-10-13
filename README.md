# AgentPulse

> **Observe, prove, replay, and compare agent execution.**
>
> AgentPulse is the local-first debugging and reproducibility layer for AI agents.

AgentPulse accepts execution evidence, causal trajectories, and boundary snapshots from external AI agents, validates them against canonical schemas, stores them locally, and provides offline reproducibility, diagnostic comparison, automated evaluations, and regression gates.

AgentPulse is **not a public SaaS**. There are no subscriptions, billing tiers, cloud accounts, multi-tenant organizations, invitations, or telemetry uploads to external servers. Your execution evidence stays under your direct control.

---

## Operating Modes

AgentPulse operates across three distinct operating postures using the exact same core engine:

| Mode | Trigger | Auth Posture | Network Binding | Primary Use Case |
|------|---------|--------------|-----------------|------------------|
| **`PERSONAL_LOCAL`** (Default) | `AGENTPULSE_MODE=personal_local` (or unset) | None (zero login screen, no user accounts) | Loopback only (`127.0.0.1` / `::1`) | Local development, single developer operator, instant startup |
| **`PRIVATE_SELF_HOSTED`** | `AGENTPULSE_MODE=self_hosted` | Mandatory (`AGENTPULSE_ACCESS_KEY` → HttpOnly session cookie) | Configurable network interface | Private VM, Docker host, home server, internal company server |
| **`HEADLESS_CI`** | `AGENTPULSE_MODE=headless_ci` | CLI/API credential or project ingest key | Headless (no Studio required) | Automated CI regression gates, pre-merge evaluations, artifact generation |

### Loopback Privacy Guarantee (`PERSONAL_LOCAL`)
In `PERSONAL_LOCAL` mode, AgentPulse enforces a strict loopback binding policy (`127.0.0.1` / `::1`). It cannot be bound to public interfaces (`0.0.0.0`) without explicit mode transition to `PRIVATE_SELF_HOSTED`. Security in local mode is governed by OS user boundaries, filesystem permissions, and network isolation—not a synthetic login screen.

### Hardened Session Security (`PRIVATE_SELF_HOSTED`)
When running in `PRIVATE_SELF_HOSTED` mode, instance authentication is mandatory:
- Unlocks via `POST /api/auth/unlock` using `AGENTPULSE_ACCESS_KEY`.
- Issues a bounded, cryptographically signed, `HttpOnly`, `SameSite=Lax`, secure cookie (`agentpulse_session`).
- The browser never repeatedly exposes the raw access key to client-side JavaScript or local storage.
- Active sessions can be locked or invalidated instantly via `POST /api/auth/lock`.

---

## Top-Level Architecture: Projects

**Project is the top-level product object** in AgentPulse:

```
AgentPulse Instance
  └── Projects (Identity, Framework, Ingest Keys, Settings)
        ├── Runs (Causal Trajectories, Model Calls, Tool Boundaries)
        ├── Comparisons (Side-by-side run diffs & state divergence)
        ├── Eval Suites & Datasets
        ├── Experiments & Lineage Forks
        └── Regression Baselines & Gate Reports
```

Each project is issued its own project-scoped ingest key (`ap_live_...`). Ingest keys grant authority **only** to start runs, append events, and complete runs for that specific project. Ingest keys cannot browse Studio, inspect other projects, read private traces, or alter regression baselines.

---

## Quick Start

### 1. Install & Launch
```bash
git clone https://github.com/raulm/AgentPulse.git
cd AgentPulse
npm install
npm run dev
```

Open `http://localhost:3000/dashboard` in your browser.
In `PERSONAL_LOCAL` mode, Studio opens immediately without an account prompt.

### 2. First-Launch Onboarding & Demo Project
If no projects exist yet, the Studio welcomes you with:
- **Connect your first agent**: 3-step project creation and framework instrumentation wizard (TypeScript, Python, LangGraph, PydanticAI, REST).
- **Explore demo run**: Pre-populates a deterministic demo project (`demo-support-agent`) with a golden baseline, a drifted failure run, visual comparison, and a regression gate report.

You can also initialize or reset the demo project from the CLI:
```bash
# Setup demo project
pulse demo setup

# Reset demo project
pulse demo reset
```

---

## Studio Information Architecture

The AgentPulse Studio provides a focused, product-oriented navigation:

- **Projects** (`/dashboard/projects`) — Project fleet, ingest keys, capture readiness scores, and project exports.
- **Runs** (`/dashboard/runs`) — Chronological execution timelines, causal step graphs, token breakdowns, and tool invocations.
- **Compare** (`/dashboard/runs/compare`) — Side-by-side diffing of runs, identifying the first causal divergence point.
- **Evaluate** (`/dashboard/evals`) — Automated eval suites, test case datasets, and model benchmark runs.
- **Regressions** (`/dashboard/regressions`) — Release baselines, drift detection, and gate progression reports.
- **Settings & Privacy** (`/dashboard/settings`) — Active operating mode, local storage directory path, privacy posture, and project data management.

*Legacy repository auditing and workflow registry tools remain accessible under Developer Tools in the top navigation.*

---

## Local CLI Reference (`pulse`)

AgentPulse includes the `pulse` CLI for terminal productivity and headless CI automation:

```bash
# General help
pulse --help

# Inspect local data root and operating mode
pulse data-path
pulse data-path --json

# List configured projects
pulse projects list
pulse projects list --json

# Export project bundle (sanitized of raw secret keys)
pulse export project <project-id> --out ./backup.json

# Setup / reset the deterministic demo project
pulse demo setup
pulse demo reset

# Run offline deterministic replay
pulse replay --run-id <run-id>

# Run pre-merge regression release gate (CI)
pulse regression-check --baseline <baseline-id> --candidate <candidate-run-id>
```

---

## Environment Variables

| Variable | Operating Mode | Description |
|---|---|---|
| `AGENTPULSE_MODE` | All | `personal_local` (default), `self_hosted`, or `headless_ci`. |
| `AGENTPULSE_HOME` | All | Custom local data root (defaults to `~/.agentpulse` in user home directory). |
| `AGENTPULSE_ACCESS_KEY` | `self_hosted` | Instance owner credential for unlocking Studio in self-hosted deployments. |
| `AGENTPULSE_INGEST_KEY` | Dev fallback | Global fallback ingest key. Prefer project-scoped ingest keys (`ap_live_...`). |
| `DATABASE_URL` | Self-hosted / Prod | Optional Postgres connection string. When unset, AgentPulse uses the zero-dependency local filesystem store (`~/.agentpulse/`). |
| `GITHUB_TOKEN` | Dev tools | Server-side read-only GitHub token for repository auditing tools. Never exposed to browser. |

> [!IMPORTANT]
> In deployed environments, `AGENTPULSE_INGEST_KEY` and `AGENTPULSE_ACCESS_KEY` must be **different** to prevent instrumented agents from accessing Studio administration.
> Postgres via `DATABASE_URL` is supported for persistent multi-container deployments.

---

## Agent Instrumentation Example

Instrumenting an agent with the AgentPulse SDK takes less than 10 lines of code:

```typescript
import { AgentPulseClient } from "@/lib/proof-layer/client";

const pulse = new AgentPulseClient({
  endpoint: "http://127.0.0.1:3000",
  apiKey: "ap_live_my_project_secret_key", // Project-scoped ingest key
  projectId: "customer-support",
  workflowId: "refund-flow-v1",
});

// 1. Start execution
const run = await pulse.startRun({ summary: "Process refund request #9821" });

// 2. Emit causal steps & boundaries
await pulse.emitTraceEvent({
  event_id: crypto.randomUUID(),
  run_id: run.run_id,
  workflow_id: "refund-flow-v1",
  node_id: "triage-policy",
  timestamp: new Date().toISOString(),
  event_type: "model_call_completed",
  status: "completed",
  cost_usd: 0.0018,
  metadata: {
    model_provider: "anthropic",
    model_name: "claude-sonnet-4-6",
    input_tokens: 420,
    output_tokens: 180,
  },
});

// 3. Complete run
await pulse.completeRun({ run_id: run.run_id, summary: "Refund evaluated successfully." });
```

---

## Quality & Continuous Integration

AgentPulse maintains rigorous deterministic test coverage:

```bash
# Run complete CI validation pipeline:
# 1. Lint (ESLint)
# 2. Typecheck (tsc --noEmit)
# 3. Unit & Integration Tests (Vitest across 104 test suites)
# 4. Next.js Production Build
npm run ci
```

All 1,700+ tests run fully offline without live external API dependencies.
