# Campaign Sandbox — Reeprov Integration Guide

This guide shows how Campaign Sandbox emits trace events to Reeprov so every run is inspectable, proof-validated, and cost-tracked.

Reeprov is a **black-box recorder** — it never executes Campaign Sandbox code, never reads its secrets, and only receives event summaries that you choose to send.

## Overview

Campaign Sandbox emits trace events at each stage of its workflow:

```
Messy Brief Intake
  → Normalize Brief         (LLM call)
  → Extract Strategic Tension (LLM call)
  → Generate Routes          (LLM call)
  → Build Personas           (LLM call)
  → Simulate Reactions       (LLM call)
  → Score Routes             (deterministic)
  → Premortem Review         (LLM call)
  → Compare Routes           (deterministic)
  → Human Selection          (approval gate)
  → Generate Execution Plan  (LLM call)
  → Export Artifact
```

Each node emits `node_started` / `node_completed`, LLM nodes emit `model_call_started` / `model_call_completed`, and the evaluators emit `eval_started` / `eval_completed`. The final step emits `artifact_created`.

## Required Environment Variables in Campaign Sandbox

Add these to Campaign Sandbox's `.env.local` / `.env` (do **not** commit real values):

```env
# Reeprov ingestion endpoint (your running Reeprov instance)
REEPROV_URL=http://localhost:3000

# Ingestion key — matches REEPROV_INGEST_KEY in Reeprov
# Must NOT be the same as REEPROV_ACCESS_KEY in production
REEPROV_INGEST_KEY=your-ingest-key-here

# Project identity (stable identifiers that group runs together)
REEPROV_PROJECT_ID=campaign-sandbox
REEPROV_PROJECT_NAME=Campaign Sandbox
REEPROV_WORKFLOW_ID=campaign-sandbox-v1
```

**Security rules:**
- Never commit real key values. Use placeholders in `.env.example`.
- Never send raw prompt text, full user data, or internal secrets as event summaries.
- Send human-readable `input_summary` / `output_summary` strings only — not full prompt bodies.
- Do not send partial model outputs that contain PII.

## Installation / Import Pattern

**Option A — Copy the minimal client (recommended for now):**

Copy `examples/integrations/campaign-sandbox/reeprov-client.ts` from the Reeprov repo into your Campaign Sandbox project and adapt the import path.

**Option B — Import ReeprovClient directly (if on a shared monorepo or npm package):**

```typescript
import { ReeprovClient } from "@reeprov/client";
// or, if running in a monorepo:
import { ReeprovClient } from "../reeprov/lib/proof-layer/client";
```

**Option C — POST directly to the API (any language/framework):**

```http
POST /api/runs/start
x-reeprov-key: <REEPROV_INGEST_KEY>
Content-Type: application/json

{
  "run_id": "cs-run-<uuid>",
  "workflow_id": "campaign-sandbox-v1",
  "project_id": "campaign-sandbox",
  "project_name": "Campaign Sandbox",
  "summary": "Campaign for EMEA SMB expansion"
}
```

## Where to Emit Events

### 1. Before the workflow begins — `run_started`

```typescript
const run = await pulse.startRun({
  summary: `Campaign run for: ${briefOneLiner}`,
});
const runId = run.run_id;
```

The `startRun` call POSTs to `/api/runs/start` and auto-emits a `run_started` trace event.

### 2. Each stage — `node_started` / `node_completed`

Wrap every stage:

```typescript
await pulse.emitEvent(runId, {
  event_type: "node_started",
  node_id: "normalize-brief",
  input_summary: "Raw brief: 500 characters.",
});

// ... run the stage ...

await pulse.emitEvent(runId, {
  event_type: "node_completed",
  node_id: "normalize-brief",
  duration_ms: elapsed,
  output_summary: "Parsed: region=EMEA, segment=SMB, budget=unconfirmed.",
});
```

Valid `node_id` values for Campaign Sandbox (must match the workflow spec):

| node_id | Stage |
|---------|-------|
| `messy-brief-intake` | Brief received |
| `normalize-brief` | Brief parsing |
| `extract-strategic-tension` | Strategic tension extraction |
| `generate-routes` | Route generation |
| `build-personas` | Persona construction |
| `simulate-reactions` | Persona simulation |
| `score-routes` | Route scoring |
| `premortem-review` | Premortem |
| `compare-routes` | Route comparison |
| `human-selection` | Human approval gate |
| `generate-execution-plan` | Execution plan |
| `export-artifact` | Final artifact packaging |

### 3. LLM stages — `model_call_started` / `model_call_completed`

```typescript
await pulse.emitEvent(runId, {
  event_type: "model_call_started",
  node_id: "extract-strategic-tension",
  input_summary: "Extract tension from brief with region=EMEA, segment=SMB.",
  metadata: {
    model_provider: "anthropic",
    model_name: "claude-sonnet-4-6",
    input_tokens: 950,
  },
});

// ... await model call ...

await pulse.emitEvent(runId, {
  event_type: "model_call_completed",
  node_id: "extract-strategic-tension",
  duration_ms: modelElapsed,
  cost_usd: usage.cost_usd,
  output_summary: "Tension: growth vs margin — wide audience vs. focused enterprise pilot.",
  metadata: {
    model_provider: "anthropic",
    model_name: "claude-sonnet-4-6",
    input_tokens: 950,
    output_tokens: 320,
  },
});
```

**Metadata fields for model calls:**

| Field | Type | Description |
|-------|------|-------------|
| `model_provider` | string | `"anthropic"`, `"openai"`, `"google"`, etc. |
| `model_name` | string | Full model ID as used in the API call |
| `input_tokens` | number | Token count for the input |
| `output_tokens` | number | Token count for the output |

### 4. Tool calls — `tool_call_started` / `tool_call_completed`

If Campaign Sandbox calls deterministic tools (budget calculator, timeline formatter, persona lookup):

```typescript
await pulse.emitEvent(runId, {
  event_type: "tool_call_started",
  node_id: "generate-execution-plan",
  input_summary: "Calculate budget split for 3-channel 90-day plan.",
  metadata: {
    tool_call_id: `tc-${crypto.randomUUID()}`,
    tool_name: "budget_calculator",
    permission_class: "read_only",
  },
});
```

### 5. Evaluators — `eval_started` / `eval_completed`

```typescript
await pulse.emitEvent(runId, {
  event_type: "eval_started",
  node_id: "score-routes",
  metadata: { eval_id: "route-score-schema-validity" },
});

await pulse.emitEvent(runId, {
  event_type: "eval_completed",
  node_id: "score-routes",
  duration_ms: 200,
  metadata: {
    eval_id: "route-score-schema-validity",
    eval_name: "Route Score Schema Validity",
    passed: true,
    score: 1.0,
  },
});
```

Standard eval IDs for Campaign Sandbox:

| eval_id | Stage | Checks |
|---------|-------|--------|
| `strategic-tension-grounding` | extract-strategic-tension | Tension is grounded in brief content |
| `route-schema-validity` | generate-routes | Routes conform to required schema |
| `route-distinctiveness` | generate-routes | Routes are meaningfully different from each other |
| `persona-reaction-consistency` | simulate-reactions | Reactions reference persona traits |
| `route-score-schema-validity` | score-routes | Scores are numeric and in range |
| `premortem-depth` | premortem-review | Premortem identifies 3+ distinct failure modes |

### 6. Artifact created — `artifact_created`

```typescript
await pulse.emitEvent(runId, {
  event_type: "artifact_created",
  node_id: "export-artifact",
  output_summary: "Campaign recommendation report generated.",
  metadata: {
    artifact_ref: `campaign-recommendation-${runId}.json`,
    artifact_type: "json_report",
  },
});
```

Do not include the artifact's full content in the trace event — use an `artifact_ref` (filename, S3 key, or storage ID) only. The actual artifact stays in Campaign Sandbox's own storage.

### 7. Run completed or failed

**On success:**

```typescript
await pulse.completeRun({
  run_id: runId,
  summary: "Campaign recommendation generated. Route 2 selected.",
  total_cost_usd: totalCost,
  total_duration_ms: totalElapsed,
  model_calls_count: modelCallCount,
  evals_passed: evalsPass,
  evals_failed: evalsFail,
  artifact_refs: [artifactRef],
});
```

**On any unhandled exception:**

```typescript
await pulse.failRun({
  run_id: runId,
  summary: `Run failed: ${error.message}`,
  error_code: error.code,
});
```

## Redaction Rules

- **Do not** send raw user secrets (API keys, auth tokens).
- **Do not** send the full user brief verbatim — use a one-liner summary.
- **Do not** send full model output — use a ≤200-character `output_summary`.
- **Do not** send the full campaign recommendation as artifact content — use `artifact_ref`.
- **Do** include provider name, model name, and token counts. These are not secrets.
- **Do** include `cost_usd` and `duration_ms`. These are observability data.

## Disabling Observability

To disable trace emission without removing instrumentation code:

```env
REEPROV_ENABLED=false
```

Check this flag at the top of each emit helper and no-op when disabled. This lets Campaign Sandbox run offline without a live Reeprov instance.

## Example Integration

See the minimal copy-paste helper at:
[examples/integrations/campaign-sandbox/](../../examples/integrations/campaign-sandbox/)

This includes `reeprov-client.ts` (the minimal HTTP client), `instrumentation.ts` (stage-specific helpers), and `README.md`.

## Verifying the Integration Locally

1. Start Reeprov: `npm run dev` (in the Reeprov repo)
2. Set env vars in Campaign Sandbox (see above)
3. Run one Campaign Sandbox workflow
4. Visit `http://localhost:3000/dashboard/runs`
5. Confirm the run appears with the correct workflow name and project name
6. Open the run detail and verify: trace timeline, model calls, eval results, artifact ref

If no runs appear, check:
- `REEPROV_URL` is correct and Reeprov is running
- `REEPROV_INGEST_KEY` matches `REEPROV_INGEST_KEY` in Reeprov
- Network errors appear in Campaign Sandbox logs (the client should log warnings, not crash)
