# @agentpulse/client

> Official TypeScript client SDK for [AgentPulse](https://github.com/raulm/AgentPulse) — the local-first debugging and reproducibility layer for AI agents.

[![npm version](https://img.shields.io/npm/v/@agentpulse/client.svg)](https://www.npmjs.com/package/@agentpulse/client)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

---

## Installation

```bash
npm install @agentpulse/client
```

Requires Node.js `>=22`.

---

## Quick Start

```typescript
import { AgentPulseClient } from "@agentpulse/client";

// Initialize client with project credentials
const pulse = new AgentPulseClient({
  endpoint: process.env.AGENTPULSE_URL ?? "http://127.0.0.1:3000",
  apiKey: process.env.AGENTPULSE_INGEST_KEY!, // Project-scoped ingest key
  projectId: "customer-support",
  workflowId: "refund-flow-v1",
});

// 1. Start execution run
const run = await pulse.startRun({
  summary: "Evaluate refund request for user #1042",
});

// 2. Record model calls & token usage
await pulse.modelCallCompleted({
  run_id: run.run_id,
  model: "claude-sonnet-4-6",
  provider: "anthropic",
  prompt: "Analyze the user refund request...",
  response: { decision: "approved", confidence: 0.98 },
  input_tokens: 340,
  output_tokens: 95,
  cost_usd: 0.0024,
});

// 3. Record tool invocations
await pulse.toolCallCompleted({
  run_id: run.run_id,
  tool_name: "stripe.refund",
  arguments: { charge_id: "ch_12345", amount: 2500 },
  output: { status: "succeeded", refund_id: "re_9876" },
  permission_class: "external_side_effect",
});

// 4. Complete the run
await pulse.completeRun({
  run_id: run.run_id,
  summary: "Refund processed successfully.",
});
```

---

## Environment Variables

The client can automatically configure itself from standard environment variables:

| Variable | Description |
|---|---|
| `AGENTPULSE_URL` | Base URL of the AgentPulse instance (e.g. `http://127.0.0.1:3000`) |
| `AGENTPULSE_INGEST_KEY` | Project-scoped ingest key (`ap_live_...`) |
| `AGENTPULSE_PROJECT_ID` | Default project identifier |
| `AGENTPULSE_WORKFLOW_ID` | Default workflow identifier |
| `AGENTPULSE_FAIL_OPEN` | Set to `"false"` to throw on telemetry errors (default: `"true"`) |
| `AGENTPULSE_ENABLED` | Set to `"false"` to disable telemetry entirely |

---

## Reliability & Failure Isolation

- **Zero Runtime Dependencies:** Built strictly on standard platform APIs (`fetch`, `AbortController`).
- **Fail-Open Posture:** By default, telemetry delivery failures log warnings and do not crash your primary agent loop.
- **Fast-Fail on Auth:** 401/403 responses fail immediately without wasteful retries.
- **Bounded Exponential Backoff:** Transient 5xx server errors retry up to 2 times with jitter.

---

## License

Apache-2.0
