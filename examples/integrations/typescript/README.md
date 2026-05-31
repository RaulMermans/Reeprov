# AgentPulse TypeScript Integration

Copy `agentpulseClient.ts` into your project and wrap your AI workflow.

## Setup

1. Copy `agentpulseClient.ts` into your project.
2. Set environment variables:

```env
AGENTPULSE_URL=https://<your-agentpulse-url>
AGENTPULSE_INGEST_KEY=<your-ingest-key>
AGENTPULSE_PROJECT_ID=my-project
AGENTPULSE_PROJECT_NAME="My Project"
AGENTPULSE_WORKFLOW_ID=my-workflow-v1
AGENTPULSE_ENABLED=true
```

3. Wrap your workflow:

```typescript
import { AgentPulseClient } from "./agentpulseClient";

const pulse = new AgentPulseClient();

async function runMyWorkflow() {
  const runId = await pulse.startRun({ summary: "Starting my workflow" });

  // ... do work ...

  await pulse.modelCallCompleted(runId, {
    nodeId: "my-agent",
    modelProvider: "anthropic",
    modelName: "claude-sonnet-4-6",
    inputTokens: 1000,
    outputTokens: 250,
    costUsd: 0.002,
    outputSummary: "Agent completed analysis",
  });

  await pulse.completeRun(runId, { summary: "Workflow complete" });
}
```

## Notes

- Setting `AGENTPULSE_ENABLED=false` (or omitting it) makes all methods no-ops — safe for local dev.
- `AGENTPULSE_INGEST_KEY` is the ingest key, not the dashboard access key.
- No external npm packages required.
