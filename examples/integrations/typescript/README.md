# Reeprov TypeScript Integration

Install `@reeprov/client` (or copy `reeprovClient.ts` into your project) and wrap your AI workflow.

## Setup

1. Install `@reeprov/client` or copy `reeprovClient.ts` into your project.
2. Set environment variables:

```env
REEPROV_URL=http://127.0.0.1:3000
REEPROV_INGEST_KEY=<your-ingest-key>
REEPROV_PROJECT_ID=my-project
REEPROV_PROJECT_NAME="My Project"
REEPROV_WORKFLOW_ID=my-workflow-v1
REEPROV_ENABLED=true
```

3. Wrap your workflow:

```typescript
import { ReeprovClient } from "@reeprov/client";

const reeprov = new ReeprovClient();

async function runMyWorkflow() {
  const runId = await reeprov.startRun({ summary: "Starting my workflow" });

  // ... do work ...

  await reeprov.modelCallCompleted(runId, {
    nodeId: "my-agent",
    modelProvider: "anthropic",
    modelName: "claude-sonnet-4-6",
    inputTokens: 1000,
    outputTokens: 250,
    costUsd: 0.002,
    outputSummary: "Agent completed analysis",
  });

  await reeprov.completeRun(runId, { summary: "Workflow complete" });
}
```

## Notes

- Setting `REEPROV_ENABLED=false` (or omitting it) makes all methods no-ops — safe for local dev.
- `REEPROV_INGEST_KEY` is the ingest key, not the dashboard access key.
- `@reeprov/client` has zero external runtime dependencies.
- Legacy `REEPROV_*` environment variables remain supported with deprecation warnings.
