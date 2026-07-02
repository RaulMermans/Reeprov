/**
 * scripts/simulate-live-run.ts
 *
 * Dev-only QA aid for Visual Execution Canvas live polling. Creates a run in
 * "running" status directly via the run store factory (same store the dev
 * server uses — Postgres when DATABASE_URL is set, file-backed otherwise),
 * then appends trace events one at a time with real wall-clock delays so a
 * developer watching the run detail page in the browser can see the canvas
 * update live via polling — without needing a real external project
 * integration mid-flight.
 *
 * The dev server (npm run dev) reads from the same store, so start it
 * first, open the run URL printed below, then watch nodes/evidence appear
 * over the next ~25 seconds. The run is left "running" until the final
 * step, so polling should keep going the whole time and then stop once the
 * run completes.
 *
 * Not shipped as product code — run manually with:
 *   node --experimental-strip-types scripts/simulate-live-run.ts
 * (or `npx tsx scripts/simulate-live-run.ts` on Node versions that don't
 * support --experimental-strip-types)
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local, or process.loadEnvFile unavailable — fall back to
  // whatever DATABASE_URL is already present in the environment.
}

import { getRunStore } from "../lib/db/getStores.js";
import { runRecordSchema, traceEventSchema } from "../lib/proof-layer/schemas.js";
import type { TraceEvent } from "../lib/proof-layer/schemas.js";

const runStore = getRunStore();

const RUN_ID = `live-sim-${Date.now()}`;
const WORKFLOW_ID = "live-sim-workflow-v1";
const PROJECT_ID = "live-sim";
const PROJECT_NAME = "Live Polling Simulation";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function evt(partial: Omit<TraceEvent, "run_id" | "workflow_id" | "timestamp">): TraceEvent {
  return traceEventSchema.parse({
    run_id: RUN_ID,
    workflow_id: WORKFLOW_ID,
    timestamp: new Date().toISOString(),
    ...partial,
  });
}

async function appendAndWait(event: TraceEvent, delayMs: number, label: string) {
  const result = await runStore.appendTraceEvent(RUN_ID, event);
  if (!result.appended && result.warning) {
    console.warn(`  ⚠  Event ${event.event_id}: ${result.warning}`);
  } else {
    console.log(`  →  ${label}`);
  }
  await sleep(delayMs);
}

async function simulateLiveRun() {
  console.log("Starting live run simulation…");

  const runRecord = runRecordSchema.parse({
    run_id: RUN_ID,
    workflow_id: WORKFLOW_ID,
    project_id: PROJECT_ID,
    project_name: PROJECT_NAME,
    status: "running",
    started_at: new Date().toISOString(),
    model_calls_count: 0,
    tool_calls_count: 0,
    evals_passed: 0,
    evals_failed: 0,
    artifact_refs: [],
    summary: "Simulated live run for Visual Execution Canvas polling QA.",
  });

  const createResult = await runStore.createRun(runRecord);
  if (!createResult.saved) {
    console.error("Failed to create run:", createResult.warning);
    process.exit(1);
  }

  console.log("");
  console.log(`Run created: ${RUN_ID}`);
  console.log(`Watch it live at: http://localhost:3000/dashboard/runs/${RUN_ID}`);
  console.log("");

  await sleep(2000);

  // Stage 1: research — includes agent metadata so the agent-visibility path is exercised too.
  await appendAndWait(
    evt({
      event_id: `${RUN_ID}-research-start`,
      node_id: "research",
      event_type: "node_started",
      status: "running",
      input_summary: "Research the topic before drafting.",
      metadata: { agent_name: "Researcher Agent", role: "researcher" },
    }),
    1500,
    "research: node_started",
  );

  await appendAndWait(
    evt({
      event_id: `${RUN_ID}-research-tool`,
      node_id: "research",
      event_type: "tool_call_completed",
      status: "completed",
      duration_ms: 1200,
      output_summary: "Found 5 relevant sources.",
      metadata: { tool_name: "web_search", agent_name: "Researcher Agent" },
    }),
    2000,
    "research: tool_call_completed (web_search)",
  );

  await appendAndWait(
    evt({
      event_id: `${RUN_ID}-research-note`,
      node_id: "research",
      event_type: "agent_note_recorded",
      metadata: {
        note_type: "plan",
        agent: "Researcher Agent",
        summary: "Prioritizing primary sources over aggregator sites for factual grounding.",
        confidence: "medium",
        visibility: "user_safe",
      },
    }),
    1500,
    "research: agent_note_recorded",
  );

  await appendAndWait(
    evt({
      event_id: `${RUN_ID}-research-done`,
      node_id: "research",
      event_type: "node_completed",
      status: "completed",
      duration_ms: 6000,
    }),
    2000,
    "research: node_completed",
  );

  // Stage 2: draft — model call.
  await appendAndWait(
    evt({
      event_id: `${RUN_ID}-draft-start`,
      node_id: "draft",
      event_type: "node_started",
      status: "running",
      metadata: { agent_name: "Writer Agent", role: "writer" },
    }),
    1500,
    "draft: node_started",
  );

  await appendAndWait(
    evt({
      event_id: `${RUN_ID}-draft-model-start`,
      node_id: "draft",
      event_type: "model_call_started",
      status: "running",
      metadata: { model_provider: "anthropic", model_name: "claude-sonnet-5", input_tokens: 900 },
    }),
    500,
    "draft: model_call_started",
  );

  await appendAndWait(
    evt({
      event_id: `${RUN_ID}-draft-model-done`,
      node_id: "draft",
      event_type: "model_call_completed",
      status: "completed",
      duration_ms: 3400,
      cost_usd: 0.0038,
      output_summary: "Draft written.",
      metadata: { model_provider: "anthropic", model_name: "claude-sonnet-5", input_tokens: 900, output_tokens: 640 },
    }),
    2500,
    "draft: model_call_completed",
  );

  await appendAndWait(
    evt({
      event_id: `${RUN_ID}-draft-done`,
      node_id: "draft",
      event_type: "node_completed",
      status: "completed",
      duration_ms: 6000,
    }),
    2000,
    "draft: node_completed",
  );

  // Stage 3: review — eval, plus a recovered issue.
  await appendAndWait(
    evt({
      event_id: `${RUN_ID}-review-start`,
      node_id: "review",
      event_type: "node_started",
      status: "running",
    }),
    1500,
    "review: node_started",
  );

  await appendAndWait(
    evt({
      event_id: `${RUN_ID}-review-retry`,
      node_id: "review",
      event_type: "retry_started",
      status: "degraded",
      output_summary: "Schema validation failed on first attempt — retrying.",
    }),
    1500,
    "review: retry_started (issue)",
  );

  await appendAndWait(
    evt({
      event_id: `${RUN_ID}-review-eval`,
      node_id: "review",
      event_type: "eval_completed",
      status: "completed",
      metadata: { eval_id: `${RUN_ID}-eval-contract`, eval_name: "Publish Contract", passed: true, score: 0.91 },
    }),
    2000,
    "review: eval_completed",
  );

  await appendAndWait(
    evt({
      event_id: `${RUN_ID}-review-done`,
      node_id: "review",
      event_type: "node_completed",
      status: "completed",
      duration_ms: 5000,
    }),
    2000,
    "review: node_completed",
  );

  // Stage 4: publish — artifact.
  await appendAndWait(
    evt({
      event_id: `${RUN_ID}-publish-start`,
      node_id: "publish",
      event_type: "node_started",
      status: "running",
    }),
    1500,
    "publish: node_started",
  );

  await appendAndWait(
    evt({
      event_id: `${RUN_ID}-publish-artifact`,
      node_id: "publish",
      event_type: "artifact_created",
      status: "completed",
      output_summary: "Final article published.",
      metadata: { artifact_ref: "final-article.md", artifact_type: "markdown" },
    }),
    2000,
    "publish: artifact_created",
  );

  await appendAndWait(
    evt({
      event_id: `${RUN_ID}-publish-done`,
      node_id: "publish",
      event_type: "node_completed",
      status: "completed",
      duration_ms: 4000,
    }),
    1000,
    "publish: node_completed",
  );

  await runStore.appendTraceEvent(
    RUN_ID,
    evt({
      event_id: `${RUN_ID}-run-done`,
      event_type: "run_completed",
      status: "completed",
      output_summary: "Simulated run finished.",
    }),
  );

  await runStore.completeRun(RUN_ID, {
    status: "completed",
    completed_at: new Date().toISOString(),
    total_duration_ms: 25000,
    total_cost_usd: 0.0038,
    model_calls_count: 1,
    tool_calls_count: 1,
    evals_passed: 1,
    evals_failed: 0,
    artifact_refs: ["final-article.md"],
    summary: "Simulated run completed — polling should stop now.",
  });

  console.log("");
  console.log(`Run completed: ${RUN_ID}`);
  console.log("Polling in the browser should stop shortly after this point.");
}

simulateLiveRun().catch((err: unknown) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
