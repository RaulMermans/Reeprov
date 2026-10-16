# TypeScript Support Agent Dogfood Example

A minimal, standalone AI support agent demonstration instrumented with Reeprov using the standalone client (or `@reeprov/client`).

## What This Demonstrates

- **Zero External SDK Dependencies**: Uses only standard client backed by Node's built-in `fetch`.
- **Run Lifecycle Instrumentation**: Demonstrates `startRun`, `modelCallCompleted`, `toolCallCompleted`, `captureBoundary`, and `completeRun`.
- **Local-First Debugging**: Emits traces directly to a Reeprov instance running locally (loopback) or in private self-hosted mode.

## Files

- `agent.ts` — The runnable standalone support agent workflow.
- `reeprovClient.ts` — Copy of the standard client from `examples/integrations/typescript/reeprovClient.ts`.
- `package.json` — Minimal runner dev dependency (`tsx`).

## Setup & Running

### 1. Ensure Reeprov is running

Make sure Reeprov is running locally:

```bash
npm run dev
# Running on http://127.0.0.1:3000
```

### 2. Configure Environment (Optional)

By default, `agent.ts` connects to `http://127.0.0.1:3000`. You can override this using environment variables:

```bash
export REEPROV_URL="http://127.0.0.1:3000"
export REEPROV_INGEST_KEY="ree_live_your_project_key"
export REEPROV_PROJECT_ID="support-agent"
export REEPROV_ENABLED="true"
```

### 3. Run the Agent

```bash
npx tsx agent.ts
```

The script will emit model call events, tool calls, and boundary captures, then finalize the run. You can then view the run immediately in the Reeprov Studio dashboard at:

`http://127.0.0.1:3000/dashboard/runs`
