# TypeScript Support Agent Dogfood Example

A minimal, standalone AI support agent demonstration instrumented with AgentPulse using the standalone `agentpulseClient.ts` integration client.

## What This Demonstrates

- **Zero External SDK Dependencies**: Uses only the copy-in `agentpulseClient.ts` client backed by Node's built-in `fetch`.
- **Run Lifecycle Instrumentation**: Demonstrates `startRun`, `modelCallCompleted`, `toolCallCompleted`, `captureBoundary`, and `completeRun`.
- **Local-First Debugging**: Emits traces directly to an AgentPulse instance running locally (loopback) or in private self-hosted mode.

## Files

- `agent.ts` — The runnable standalone support agent workflow.
- `agentpulseClient.ts` — Direct copy of the standard TypeScript client from `examples/integrations/typescript/agentpulseClient.ts`.
- `package.json` — Minimal runner dev dependency (`tsx`).

## Setup & Running

### 1. Ensure AgentPulse is running

Make sure AgentPulse is running locally:

```bash
npm run dev
# Running on http://127.0.0.1:3000
```

### 2. Configure Environment (Optional)

By default, `agent.ts` connects to `http://127.0.0.1:3000`. You can override this using environment variables:

```bash
export AGENTPULSE_URL="http://127.0.0.1:3000"
export AGENTPULSE_INGEST_KEY="ap_live_your_project_key"
export AGENTPULSE_PROJECT_ID="support-agent"
export AGENTPULSE_ENABLED="true"
```

### 3. Run the Agent

```bash
npx tsx agent.ts
```

The script will emit model call events, tool calls, and boundary captures, then finalize the run. You can then view the run immediately in the AgentPulse Studio dashboard at:

`http://127.0.0.1:3000/dashboard/runs`
