# Reeprov

**Reproduce the failure. Prove the fix.**

Reeprov is local-first debugging and reproducibility infrastructure for AI agents.

Capture execution evidence, reproduce failures, fork from checkpoints, compare behavior, evaluate candidate fixes, and turn production failures into regression tests.

```
CAPTURE
→ INSPECT
→ REPLAY
→ FORK
→ COMPARE
→ EVALUATE
→ REGRESSION
```

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@reeprov/client.svg)](https://www.npmjs.com/package/@reeprov/client)
[![Status](https://img.shields.io/badge/status-public--beta-orange.svg)](CHANGELOG.md)

Reeprov accepts execution evidence, causal trajectories, and boundary snapshots from external AI agents, validates them against canonical schemas, stores them locally, and provides offline reproducibility, diagnostic comparison, automated evaluations, and regression gates.

Reeprov is **not a public SaaS**. There are no subscriptions, cloud accounts, multi-tenant organizations, invitations, or telemetry uploads to external servers. Your execution evidence stays under your direct control.

```
External Agent (TypeScript / Python / REST)
       │  (standard HTTP contracts)
       ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Reeprov Engine (Local Loopback or Private Server)           │
 │                                                             │
 │   CAPTURE  ──►  INSPECT  ──►  REPLAY  ──►  FORK  ──► COMPARE│
 │                                                   │         │
 │   REGRESSION GATES  ◄──  EVALUATE  ◄──────────────┘         │
 └─────────────────────────────────────────────────────────────┘
       │
       ▼
 Reeprov Studio (Web UI)  /  `reeprov` CLI (Automated CI)
```

---

## About the Name

"Reeprov" (pronounced *ree-proove*) combines the ideas of **reproducing** an execution and **proving** whether a change actually fixed it.

---

## Why Reeprov?

When complex autonomous agents fail, traditional logging leaves developers stranded:
- **Nondeterminism:** The same prompt may succeed today and hallucinate tomorrow.
- **Side Effects:** Re-running an agent against live APIs risks sending duplicate emails, charging cards twice, or mutating production databases.
- **Opaque Context:** Prompts grow silently, vector lookups drift, and memory state evolves invisibly across turns.

Reeprov treats agent execution as **cryptographically verifiable evidence**:
1. **Replay-Grade Capture:** Intercepts nondeterministic boundaries (LLM calls, tool executions, vector searches) and stores content-addressed input/output pairs.
2. **Server-Side Secret Redaction:** Scrub API keys, bearer tokens, and credentials before persistence or export.
3. **Deterministic Offline Replay:** Verify logic by substituting recorded boundary responses with live network access disabled.
4. **Causal Diffing:** Pinpoint the exact step where candidate execution diverged from a golden baseline.
5. **Pre-Merge Regression Gates:** Block CI merges when agent behavior, cost, or output accuracy drifts beyond policy thresholds.

---

## Operating Modes & Privacy

Reeprov operates across three distinct postures using the exact same core engine:

| Mode | Trigger | Auth Posture | Network Binding | Primary Use Case |
|---|---|---|---|---|
| **`PERSONAL_LOCAL`** (Default) | `REEPROV_MODE=personal_local` | None (zero login screen, instant startup) | Loopback only (`127.0.0.1` / `::1`) | Single developer local workstation |
| **`PRIVATE_SELF_HOSTED`** | `REEPROV_MODE=self_hosted` | Mandatory password (`REEPROV_ACCESS_KEY` → HttpOnly session cookie) | Configurable network interface | Private VM, Docker host, internal company server |
| **`HEADLESS_CI`** | `REEPROV_MODE=headless_ci` | Ingest key (`ree_live_...`) | Headless (no Studio required) | Automated CI regression gates and evaluations |

### Loopback Privacy Guarantee
In `PERSONAL_LOCAL` mode, Reeprov enforces a strict loopback binding policy (`127.0.0.1` / `::1`). It cannot be bound to public interfaces (`0.0.0.0`) without explicit mode transition to `PRIVATE_SELF_HOSTED`. Zero bytes of telemetry are transmitted to third-party clouds.

### Environment Variables & Security Posture

| Variable | Operating Mode | Description | Legacy Fallback |
|---|---|---|---|
| `REEPROV_MODE` | All | `personal_local` (default), `self_hosted`, or `headless_ci` | `AGENTPULSE_MODE` |
| `REEPROV_HOME` | All | Custom local data root (defaults to `~/.reeprov`) | `AGENTPULSE_HOME` |
| `REEPROV_ACCESS_KEY` | `self_hosted` | Instance owner password for unlocking Studio | `AGENTPULSE_ACCESS_KEY` |
| `REEPROV_INGEST_KEY` | Dev / CI | Global fallback ingest key. Prefer project-scoped keys (`ree_live_...`) | `AGENTPULSE_INGEST_KEY` |
| `DATABASE_URL` | Self-Hosted / Prod | Optional Postgres connection string (uses local filesystem store when unset) | — |

> [!IMPORTANT]
> In deployed self-hosted environments, `REEPROV_INGEST_KEY` and `REEPROV_ACCESS_KEY` must be **different** to prevent external agents from accessing Studio administration.
> For multi-container deployments, configure `DATABASE_URL` with a persistent Postgres database.

---

## Quick Start

### Option A: Local Development (Git + Node.js)

**Prerequisites:** Node.js `>=20` and npm.

```bash
# 1. Clone repository
git clone https://github.com/RaulMermans/Reeprov.git
cd Reeprov

# 2. Install dependencies reproducibly
npm ci

# 3. Start Studio in local mode
npm run dev
```

Open `http://localhost:3000/dashboard` in your browser. Studio opens immediately with zero account prompts.

### Option B: Docker Compose (Self-Hosted)

```bash
# Set your private instance password
export REEPROV_ACCESS_KEY="replace_with_long_random_private_key"
export REEPROV_INGEST_KEY="replace_with_different_long_random_key"

docker compose up -d
```

Studio will be bound to `http://127.0.0.1:3000` with session authentication enforced.

---

## Connect Your First Agent

Instrumenting an agent requires only standard HTTP calls using our official client SDKs:

### TypeScript / Node.js (`@reeprov/client`)

```bash
npm install @reeprov/client
```

```typescript
import { ReeprovClient } from "@reeprov/client";

const reeprov = new ReeprovClient({
  endpoint: process.env.REEPROV_URL ?? "http://127.0.0.1:3000",
  apiKey: process.env.REEPROV_INGEST_KEY!, // Project-scoped ingest key (ree_live_...)
  projectId: "support-agent",
  workflowId: "refund-flow-v1",
});

// 1. Start execution run
const run = await reeprov.startRun({ summary: "Process refund request #9821" });

// 2. Capture model boundary
await reeprov.modelCallCompleted({
  run_id: run.run_id,
  model: "claude-sonnet-4-6",
  provider: "anthropic",
  prompt: "Classify refund request for order #9821...",
  response: { eligible: true, refund_amount_usd: 49.00 },
  input_tokens: 380,
  output_tokens: 45,
  cost_usd: 0.0018,
});

// 3. Capture tool execution
await reeprov.toolCallCompleted({
  run_id: run.run_id,
  tool_name: "stripe.refund",
  arguments: { order_id: "9821", amount_cents: 4900 },
  output: { status: "succeeded", refund_id: "re_12345" },
  permission_class: "external_side_effect",
});

// 4. Complete run
await reeprov.completeRun({
  run_id: run.run_id,
  summary: "Refund processed successfully.",
});
```

### Python (`reeprov-client`)

The Python SDK source is included in this repository. The package is not yet
available on PyPI; install it from a local checkout:

```bash
pip install ./packages/client-python
```

```python
import os
from reeprov_client import ReeprovClient

reeprov = ReeprovClient(
    url=os.environ.get("REEPROV_URL", "http://127.0.0.1:3000"),
    ingest_key=os.environ.get("REEPROV_INGEST_KEY", "ree_live_..."),
    project_id="support-agent",
    workflow_id="refund-flow-v1",
)

# 1. Start execution
run_id = reeprov.start_run(summary="Process refund request #9821")

# 2. Capture model boundary
reeprov.model_call_completed(
    run_id=run_id,
    model="claude-sonnet-4-6",
    provider="anthropic",
    prompt="Classify refund request for order #9821...",
    response={"eligible": True, "refund_amount_usd": 49.00},
    input_tokens=380,
    output_tokens=45,
    cost_usd=0.0018,
)

# 3. Capture tool execution
reeprov.tool_call_completed(
    run_id=run_id,
    tool_name="stripe.refund",
    arguments={"order_id": "9821", "amount_cents": 4900},
    output={"status": "succeeded", "refund_id": "re_12345"},
    permission_class="external_side_effect",
)

# 4. Complete run
reeprov.complete_run(run_id=run_id, summary="Refund processed successfully.")
```

---

## Exploring Studio & Deterministic Demo

If you don't have an external agent running yet, explore Reeprov using our pre-seeded deterministic demo:

```bash
# Setup demo project with golden baseline & drifted failure run
npm run reeprov -- demo setup
```

Navigate to:
- **Projects** (`/dashboard/projects`) — Inspect project fleet, capture readiness scores, and ingest keys.
- **Runs** (`/dashboard/runs`) — Visual causal step graph, token breakdowns, and boundary payloads.
- **Compare** (`/dashboard/runs/compare`) — Side-by-side run diff highlighting the first divergence point.
- **Evaluate** (`/dashboard/evals`) — Automated eval suites and test case assertions.
- **Regressions** (`/dashboard/regressions`) — Release baselines, drift detection, and pre-merge gate reports.
- **Settings & Privacy** (`/dashboard/settings`) — Local storage directory path and privacy posture.

To clean up:
```bash
npm run reeprov -- demo reset
```

---

## Local CLI Reference (`reeprov`)

Reeprov includes the `reeprov` CLI for terminal productivity and headless CI automation.

> [!NOTE]
> The root `reeprov` repository maintains `"private": true` and is not published to the npm registry. The `reeprov` CLI is classified as **REPO-LOCAL PUBLIC/BETA**. Within the cloned repository, run commands using `npm run reeprov -- <command>` (or directly via `node bin/reeprov.mjs <command>` / `./bin/reeprov.mjs <command>`). Legacy command `npm run pulse -- <command>` remains supported as an alias.

```bash
# Version & help
npm run reeprov -- --version
npm run reeprov -- --help

# Inspect local data root and privacy posture
npm run reeprov -- data-path
npm run reeprov -- data-path --json

# List configured projects
npm run reeprov -- projects list

# Export project bundle (sanitized of raw secret keys)
npm run reeprov -- export project <project-id> --out ./backup.json

# Run offline deterministic replay
npm run reeprov -- replay <run-id-or-path> --strict

# Side-by-side run comparison
npm run reeprov -- diff <run-a> <run-b> --first-divergence

# Pre-merge CI regression check
npm run reeprov -- regression check <candidate-run-id> --baseline <baseline-id>

# Migrate data from legacy AgentPulse directory (~/.agentpulse -> ~/.reeprov)
npm run reeprov -- migrate-brand
```

---

## Migrating from AgentPulse

If you used previous development builds under the AgentPulse name:
- Run `npm run reeprov -- migrate-brand` to safely copy existing traces from `~/.agentpulse` to `~/.reeprov`.
- Detailed migration instructions, environment variable compatibility, and rollback guidance are available in the [Migration Guide](docs/migration/agentpulse-to-reeprov.md).

---

## Replay Semantics & Honesty

Reeprov provides **deterministic offline boundary substitution**, not full-system virtualization:

- **What Replay Does:** When an agent invokes a recorded model call or tool, the replay harness verifies that the input matches the recorded cryptographic hash and substitutes the recorded response. Its in-process guard blocks known Node network and subprocess APIs; arbitrary host code needs separate process or container isolation for a zero-egress guarantee.
- **What Replay Does NOT Do:** It does not snapshot arbitrary operating system kernels, process memory heaps, or uncaptured external environments.
- **Side-Effect Safety:** Tools classified as `external_side_effect` or `destructive` are gated during replay to prevent accidental mutations.

---

## Quality & Continuous Integration

Reeprov maintains rigorous deterministic test coverage:

```bash
# Run complete CI validation pipeline:
# 1. Lint (ESLint with strict boundary rules)
# 2. Typecheck (tsc --noEmit)
# 3. Unit, Integration, & Replay Proof Tests (Vitest)
# 4. Next.js Production Build
npm run ci
```

All default CI tests execute 100% offline with zero live external API dependencies.

---

## Architecture Specifications

For in-depth architectural contracts, refer to the documentation index:
- [Complete Documentation Index](docs/README.md)
- [System Architecture](docs/ARCHITECTURE.md)
- [Data Model & Entities](docs/DATA_MODEL.md)
- [Public API Stability Classification](docs/architecture/api-stability.md)
- [Execution Boundary Model](docs/architecture/boundary-model.md)
- [Framework Integration Strategy](docs/integrations/frameworks.md)
- [Maintainer Release Process](docs/maintainers/release-process.md)
- [Migration Guide](docs/migration/agentpulse-to-reeprov.md)

---

## Security & Vulnerability Reporting

Please review our [SECURITY.md](SECURITY.md) for vulnerability disclosure procedures and privacy guidelines. Do not report security vulnerabilities via public GitHub issues.

---

## Contributing

We welcome contributions! Please review [CONTRIBUTING.md](CONTRIBUTING.md) and our [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before submitting pull requests.

---

## License

Reeprov is open-source software licensed under the [Apache License, Version 2.0](LICENSE).
