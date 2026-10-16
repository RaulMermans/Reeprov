# Campaign Sandbox — Reeprov Integration

This directory contains the copy-paste integration layer for connecting Campaign Sandbox to Reeprov.

## Files

| File | Purpose |
|------|---------|
| `reeprov-client.ts` | Minimal HTTP client. Copy into Campaign Sandbox. No Reeprov dependency at runtime. |
| `instrumentation.ts` | Stage-specific helpers — one function per Campaign Sandbox stage. Import from `reeprov-client.ts`. |
| `README.md` | This file. |

## Quick Start

### 1. Copy both files into Campaign Sandbox

```bash
cp examples/integrations/campaign-sandbox/reeprov-client.ts  <campaign-sandbox>/lib/observability/
cp examples/integrations/campaign-sandbox/instrumentation.ts     <campaign-sandbox>/lib/observability/
```

### 2. Set environment variables in Campaign Sandbox

```env
REEPROV_URL=http://localhost:3000
REEPROV_INGEST_KEY=your-ingest-key-here
REEPROV_PROJECT_ID=campaign-sandbox
REEPROV_PROJECT_NAME="Campaign Sandbox"
REEPROV_WORKFLOW_ID=campaign-sandbox-v1
# Optional: set to "false" to disable without removing code
REEPROV_ENABLED=true
```

### 3. Instrument the workflow

```typescript
import { createCampaignSandboxPulseClient } from "./reeprov-client";
import {
  startCampaignRun,
  emitNormalizeBrief,
  emitExtractStrategicTension,
  emitGenerateRoutes,
  emitBuildPersonas,
  emitSimulateReactions,
  emitScoreRoutes,
  emitPremortumReview,
  emitCompareRoutes,
  emitHumanSelectionRequested,
  emitHumanSelectionCompleted,
  emitGenerateExecutionPlan,
  emitCampaignArtifactCreated,
  emitCampaignNodeEval,
  completeCampaignRun,
  failCampaignRun,
} from "./instrumentation";

const pulse = createCampaignSandboxPulseClient();

async function runCampaignWorkflow(rawBrief: string) {
  const { runId } = await startCampaignRun(pulse, {
    briefSummary: rawBrief.slice(0, 200),
  });

  try {
    // Normalize
    const normalizeResult = await normalizeBrief(rawBrief);
    await emitNormalizeBrief(pulse, runId, {
      inputSummary: "Raw brief received.",
      outputSummary: `Parsed: ${summarize(normalizeResult)}`,
      durationMs: normalizeResult.duration_ms,
      costUsd: normalizeResult.cost_usd,
      modelProvider: "anthropic",
      modelName: "claude-haiku-4-5",
      inputTokens: normalizeResult.input_tokens,
      outputTokens: normalizeResult.output_tokens,
    });

    // Extract tension
    const tensionResult = await extractStrategicTension(normalizeResult.output);
    await emitExtractStrategicTension(pulse, runId, {
      inputSummary: "Normalized brief.",
      outputSummary: tensionResult.tension_summary,
      durationMs: tensionResult.duration_ms,
      costUsd: tensionResult.cost_usd,
      modelProvider: "anthropic",
      modelName: "claude-sonnet-4-6",
      inputTokens: tensionResult.input_tokens,
      outputTokens: tensionResult.output_tokens,
    });

    // ... (similar pattern for each subsequent stage) ...

    // Artifact
    await emitCampaignArtifactCreated(pulse, runId, {
      artifactRef: `campaign-recommendation-${runId}.json`,
      summary: "Campaign recommendation report generated.",
    });

    await completeCampaignRun(pulse, runId, {
      summary: "Campaign recommendation generated successfully.",
      totalCostUsd: totalCost,
      totalDurationMs: Date.now() - startTime,
      modelCallsCount: 6,
      evalsPassedCount: 5,
      evalsFailedCount: 1,
      artifactRefs: [`campaign-recommendation-${runId}.json`],
    });

  } catch (err) {
    await failCampaignRun(pulse, runId, {
      message: String(err),
    });
    throw err;
  }
}
```

## Disabling Observability

Set `REEPROV_ENABLED=false` in Campaign Sandbox's env to disable all emissions. The client no-ops all calls when disabled — no network requests are made, runs return fake IDs.

## Verifying

1. Start Reeprov: `npm run dev`
2. Run a Campaign Sandbox workflow (or run the seed script: `npm run seed:traces`)
3. Visit `http://localhost:3000/dashboard/runs`
4. Open the run detail — trace timeline, model calls, evals, and artifact should all be visible

## Security Notes

- Never send raw prompt text or full model outputs as event summaries.
- Use `input_summary` / `output_summary` as concise ≤200 character strings.
- Do not send user secrets, API keys, or PII in event payloads.
- Use `artifact_ref` (a filename or storage key) — not artifact content — in `artifact_created` events.
