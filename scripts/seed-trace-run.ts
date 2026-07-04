/**
 * scripts/seed-trace-run.ts
 *
 * Creates a realistic Campaign Sandbox trace run directly in the run store
 * without requiring the dev server to be running.
 *
 * Run with:
 *   npm run seed:traces
 *
 * The seeded run can then be viewed at:
 *   http://localhost:3000/dashboard/runs
 *
 * The run demonstrates:
 *   - run_started / run_completed lifecycle
 *   - messy-brief intake node (node_started / node_completed)
 *   - model_call_started / model_call_completed for brief parser
 *   - model_call_started / model_call_completed for campaign route generator
 *   - tool_call_started / tool_call_completed for a persona lookup
 *   - eval_started / eval_completed (pass + one degraded warning)
 *   - artifact_created
 *   - model provider / name / token / cost metadata
 */

import { getRunStore } from "../lib/db/getStores.js";
import { runRecordSchema, traceEventSchema, evalResultSchema } from "../lib/proof-layer/schemas.js";
import type { TraceEvent, EvalResult } from "../lib/proof-layer/schemas.js";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No local env file, or process.loadEnvFile unavailable. Existing
  // environment variables still select the correct run store.
}

const runStore = getRunStore();

const RUN_ID = "seed-cs-run-001";
const WORKFLOW_ID = "campaign-sandbox-v1";
const PROJECT_ID = "campaign-sandbox";
const PROJECT_NAME = "Campaign Sandbox";

function evt(partial: Omit<TraceEvent, "run_id" | "workflow_id">): TraceEvent {
  return traceEventSchema.parse({
    run_id: RUN_ID,
    workflow_id: WORKFLOW_ID,
    ...partial,
  });
}

async function seedRun() {
  console.log("🌱  Seeding Campaign Sandbox trace run…");

  // ── 1. Create run record ──────────────────────────────────────────────────

  const started_at = "2026-05-24T09:00:00.000Z";

  const runRecord = runRecordSchema.parse({
    run_id: RUN_ID,
    workflow_id: WORKFLOW_ID,
    project_id: PROJECT_ID,
    project_name: PROJECT_NAME,
    status: "running",
    started_at,
    model_calls_count: 0,
    tool_calls_count: 0,
    evals_passed: 0,
    evals_failed: 0,
    artifact_refs: [],
    summary: "Generate campaign recommendation from messy product brief.",
  });

  const createResult = await runStore.createRun(runRecord);
  if (!createResult.saved) {
    console.error("❌  Failed to create run:", createResult.warning);
    process.exit(1);
  }

  console.log(`  ✔  Run created: ${RUN_ID}`);

  // ── 2. Trace events ───────────────────────────────────────────────────────

  const events: TraceEvent[] = [

    // run_started (auto-created by createRun — but we skip it here to avoid duplicate)

    // Brief intake node
    evt({
      event_id: "seed-cs-001-brief-start",
      node_id: "brief-intake",
      timestamp: "2026-05-24T09:00:01.000Z",
      event_type: "node_started",
      status: "running",
      input_summary: "Messy brief: 'We want to grow users in EMEA but budget is unclear. Focus on SMBs and maybe some enterprise. Timeline is Q3 or maybe Q4.'",
    }),

    // Model call: brief parser
    evt({
      event_id: "seed-cs-002-model-parser-start",
      node_id: "brief-parser",
      timestamp: "2026-05-24T09:00:02.000Z",
      event_type: "model_call_started",
      status: "running",
      input_summary: "Parse messy brief into structured campaign parameters.",
      metadata: {
        model_provider: "anthropic",
        model_name: "claude-sonnet-4-6",
        input_tokens: 840,
      },
    }),

    evt({
      event_id: "seed-cs-003-model-parser-done",
      node_id: "brief-parser",
      timestamp: "2026-05-24T09:00:05.200Z",
      event_type: "model_call_completed",
      status: "completed",
      duration_ms: 3200,
      cost_usd: 0.0042,
      output_summary: "Parsed: target_region=EMEA, segment=SMB+Enterprise, budget=unconfirmed, timeline=Q3-Q4.",
      metadata: {
        model_provider: "anthropic",
        model_name: "claude-sonnet-4-6",
        input_tokens: 840,
        output_tokens: 310,
      },
    }),

    evt({
      event_id: "seed-cs-004-brief-done",
      node_id: "brief-intake",
      timestamp: "2026-05-24T09:00:05.300Z",
      event_type: "node_completed",
      status: "completed",
      duration_ms: 4300,
    }),

    // Campaign route generator
    evt({
      event_id: "seed-cs-005-route-start",
      node_id: "campaign-route-generator",
      timestamp: "2026-05-24T09:00:06.000Z",
      event_type: "node_started",
      status: "running",
    }),

    evt({
      event_id: "seed-cs-006-model-route-start",
      node_id: "campaign-route-generator",
      timestamp: "2026-05-24T09:00:06.100Z",
      event_type: "model_call_started",
      status: "running",
      input_summary: "Generate top 3 campaign routes for EMEA SMB+Enterprise expansion.",
      metadata: {
        model_provider: "anthropic",
        model_name: "claude-sonnet-4-6",
        input_tokens: 1100,
      },
    }),

    evt({
      event_id: "seed-cs-007-model-route-done",
      node_id: "campaign-route-generator",
      timestamp: "2026-05-24T09:00:12.500Z",
      event_type: "model_call_completed",
      status: "completed",
      duration_ms: 6400,
      cost_usd: 0.0091,
      output_summary: "Routes: (1) EMEA direct outreach for SMB fintech, (2) Partner-led enterprise pilot, (3) Content-led self-serve for SMB SaaS.",
      metadata: {
        model_provider: "anthropic",
        model_name: "claude-sonnet-4-6",
        input_tokens: 1100,
        output_tokens: 720,
      },
    }),

    evt({
      event_id: "seed-cs-008-route-done",
      node_id: "campaign-route-generator",
      timestamp: "2026-05-24T09:00:12.600Z",
      event_type: "node_completed",
      status: "completed",
      duration_ms: 6600,
    }),

    // Tool call: persona lookup
    evt({
      event_id: "seed-cs-009-persona-tool-start",
      node_id: "persona-simulator",
      timestamp: "2026-05-24T09:00:13.000Z",
      event_type: "tool_call_started",
      status: "running",
      input_summary: "Lookup persona traits for EMEA SMB fintech buyer.",
      metadata: {
        tool_call_id: "tc-persona-001",
        tool_name: "persona_lookup",
        permission_class: "read_only",
      },
    }),

    evt({
      event_id: "seed-cs-010-persona-tool-done",
      node_id: "persona-simulator",
      timestamp: "2026-05-24T09:00:14.100Z",
      event_type: "tool_call_completed",
      status: "completed",
      duration_ms: 1100,
      output_summary: "Persona: Budget-conscious, values ROI transparency, prefers async demos, 45-day decision cycle.",
      metadata: {
        tool_call_id: "tc-persona-001",
        tool_name: "persona_lookup",
        permission_class: "read_only",
      },
    }),

    // Persona simulator model call
    evt({
      event_id: "seed-cs-011-persona-model-start",
      node_id: "persona-simulator",
      timestamp: "2026-05-24T09:00:14.200Z",
      event_type: "model_call_started",
      status: "running",
      input_summary: "Simulate buyer journey for EMEA SMB fintech campaign route 1.",
      metadata: {
        model_provider: "anthropic",
        model_name: "claude-sonnet-4-6",
        input_tokens: 950,
      },
    }),

    evt({
      event_id: "seed-cs-012-persona-model-done",
      node_id: "persona-simulator",
      timestamp: "2026-05-24T09:00:20.300Z",
      event_type: "model_call_completed",
      status: "completed",
      duration_ms: 6100,
      cost_usd: 0.0079,
      output_summary: "Simulated journey: cold email → case study → async demo → 30-day trial → contract. Predicted conversion: 12%.",
      metadata: {
        model_provider: "anthropic",
        model_name: "claude-sonnet-4-6",
        input_tokens: 950,
        output_tokens: 580,
      },
    }),

    // Eval: output quality
    evt({
      event_id: "seed-cs-013-eval-start",
      node_id: "output-quality-evaluator",
      timestamp: "2026-05-24T09:00:20.500Z",
      event_type: "eval_started",
      status: "running",
    }),

    evt({
      event_id: "seed-cs-014-eval-done",
      node_id: "output-quality-evaluator",
      timestamp: "2026-05-24T09:00:21.000Z",
      event_type: "eval_completed",
      status: "completed",
      duration_ms: 500,
      metadata: {
        eval_id: "seed-eval-output-quality",
        eval_name: "Output Quality Check",
        passed: true,
        score: 0.82,
      },
    }),

    // Artifact created
    evt({
      event_id: "seed-cs-015-artifact",
      node_id: "output-packager",
      timestamp: "2026-05-24T09:00:22.000Z",
      event_type: "artifact_created",
      status: "completed",
      output_summary: "Campaign recommendation report generated.",
      metadata: {
        artifact_ref: "campaign-recommendation-seed-cs-001.json",
        artifact_type: "json_report",
      },
    }),

    // run_completed
    evt({
      event_id: "seed-cs-016-run-done",
      timestamp: "2026-05-24T09:00:22.500Z",
      event_type: "run_completed",
      status: "completed",
      duration_ms: 22500,
      cost_usd: 0.0212,
      output_summary: "Campaign recommendation generated. 3 routes proposed, persona journey simulated for route 1.",
    }),
  ];

  for (const event of events) {
    const result = await runStore.appendTraceEvent(RUN_ID, event);
    if (!result.appended && result.warning) {
      console.warn(`  ⚠  Event ${event.event_id}: ${result.warning}`);
    }
  }

  console.log(`  ✔  ${events.length} trace events appended`);

  // ── 3. Eval results ───────────────────────────────────────────────────────

  const evalResults: EvalResult[] = [
    evalResultSchema.parse({
      eval_id: "seed-eval-output-quality",
      run_id: RUN_ID,
      node_id: "output-quality-evaluator",
      name: "Output Quality Check",
      type: "output_quality",
      score: 0.82,
      passed: true,
      severity: "info",
      findings: ["Campaign routes are specific and actionable.", "Persona simulation references buyer traits."],
      recommendation: "Consider adding budget-range scenarios for unconfirmed budget briefs.",
    }),
    evalResultSchema.parse({
      eval_id: "seed-eval-brief-coverage",
      run_id: RUN_ID,
      node_id: "brief-parser",
      name: "Brief Coverage Check",
      type: "schema_validity",
      score: 0.65,
      passed: false,
      severity: "warning",
      findings: [
        "Budget field is 'unconfirmed' — could not validate campaign sizing.",
        "Timeline is ambiguous (Q3 or Q4) — routes do not distinguish between timelines.",
      ],
      recommendation: "Prompt the caller to clarify budget range and exact timeline before generating routes.",
    }),
  ];

  for (const er of evalResults) {
    await runStore.appendEvalResult(RUN_ID, er);
  }

  console.log(`  ✔  ${evalResults.length} eval results appended`);

  // ── 4. Complete run ───────────────────────────────────────────────────────

  await runStore.completeRun(RUN_ID, {
    status: "degraded",
    completed_at: "2026-05-24T09:00:22.500Z",
    total_duration_ms: 22500,
    total_cost_usd: 0.0212,
    model_calls_count: 3,
    tool_calls_count: 1,
    evals_passed: 1,
    evals_failed: 1,
    artifact_refs: ["campaign-recommendation-seed-cs-001.json"],
    summary: "Campaign recommendation generated. Run degraded: brief coverage eval failed due to unconfirmed budget and ambiguous timeline. Output quality passed at 0.82.",
  });

  console.log("  ✔  Run completed with status: degraded");

  console.log("");
  console.log(`✅  Seeded run: ${RUN_ID}`);
  console.log(`   View at: http://localhost:3000/dashboard/runs/${RUN_ID}`);
  console.log(`   All runs: http://localhost:3000/dashboard/runs`);
}

seedRun().catch((err: unknown) => {
  console.error("❌  Seed failed:", err);
  process.exit(1);
});
