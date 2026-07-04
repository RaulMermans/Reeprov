/**
 * scripts/seed-campaign-sandbox-run.ts
 *
 * Creates a full Campaign Sandbox trace run directly in the run store
 * without requiring the dev server to be running.
 *
 * This seed covers the complete campaign-sandbox-v1 workflow:
 *   messy-brief-intake → normalize-brief → extract-strategic-tension
 *   → generate-routes → build-personas → simulate-reactions
 *   → score-routes → premortem-review → compare-routes
 *   → human-selection → generate-execution-plan → export-artifact
 *
 * The run is intentionally DEGRADED: one eval fails (route-distinctiveness)
 * to demonstrate the proof layer catching a real quality signal.
 *
 * Run with:
 *   npm run seed:cs
 *
 * View at:
 *   http://localhost:3000/dashboard/runs
 */

import { getRunStore } from "../lib/db/getStores.js";
import {
  runRecordSchema,
  traceEventSchema,
  evalResultSchema,
} from "../lib/proof-layer/schemas.js";
import type { TraceEvent, EvalResult } from "../lib/proof-layer/schemas.js";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No local env file, or process.loadEnvFile unavailable. Existing
  // environment variables still select the correct run store.
}

const runStore = getRunStore();

const RUN_ID = "seed-cs-full-001";
const WORKFLOW_ID = "campaign-sandbox-v1";
const PROJECT_ID = "campaign-sandbox";
const PROJECT_NAME = "Campaign Sandbox";

// Base timestamp: 2026-05-24 09:00:00 UTC
const T0 = new Date("2026-05-24T09:00:00.000Z").getTime();
function ts(offsetMs: number): string {
  return new Date(T0 + offsetMs).toISOString();
}

let seqId = 0;
function id(label: string): string {
  return `seed-cs-full-${String(++seqId).padStart(3, "0")}-${label}`;
}

function evt(partial: Omit<TraceEvent, "run_id" | "workflow_id">): TraceEvent {
  return traceEventSchema.parse({
    run_id: RUN_ID,
    workflow_id: WORKFLOW_ID,
    ...partial,
  });
}

async function seedRun(): Promise<void> {
  console.log("🌱  Seeding full Campaign Sandbox trace run…");
  console.log(`    Run ID:     ${RUN_ID}`);
  console.log(`    Workflow:   ${WORKFLOW_ID}`);
  console.log("");

  // ── 1. Create run record ─────────────────────────────────────────────────

  const runRecord = runRecordSchema.parse({
    run_id: RUN_ID,
    workflow_id: WORKFLOW_ID,
    project_id: PROJECT_ID,
    project_name: PROJECT_NAME,
    status: "running",
    started_at: ts(0),
    model_calls_count: 0,
    tool_calls_count: 0,
    evals_passed: 0,
    evals_failed: 0,
    artifact_refs: [],
    summary: "Generate campaign recommendation for EMEA SMB expansion with unclear budget.",
  });

  const createResult = await runStore.createRun(runRecord);
  if (!createResult.saved) {
    console.error("❌  Failed to create run:", createResult.warning);
    process.exit(1);
  }
  console.log(`  ✔  Run record created`);

  // ── 2. Trace events ──────────────────────────────────────────────────────

  const events: TraceEvent[] = [

    // ─── messy-brief-intake (trigger) ──────────────────────────────────────
    evt({
      event_id: id("brief-intake-start"),
      node_id: "messy-brief-intake",
      timestamp: ts(500),
      event_type: "node_started",
      status: "running",
      input_summary: "Brief received (450 chars). Raw unstructured text: goals unclear, audience ambiguous, budget TBD.",
    }),
    evt({
      event_id: id("brief-intake-done"),
      node_id: "messy-brief-intake",
      timestamp: ts(600),
      event_type: "node_completed",
      status: "completed",
      duration_ms: 100,
      output_summary: "Brief accepted. Passing to normalize-brief.",
    }),

    // ─── normalize-brief (LLM: claude-haiku-4-5) ───────────────────────────
    evt({
      event_id: id("normalize-start"),
      node_id: "normalize-brief",
      timestamp: ts(700),
      event_type: "node_started",
      status: "running",
      input_summary: "Raw brief: 'We want to grow users in EMEA but budget is unclear…'",
    }),
    evt({
      event_id: id("normalize-model-start"),
      node_id: "normalize-brief",
      timestamp: ts(800),
      event_type: "model_call_started",
      status: "running",
      input_summary: "Parse and normalize brief into structured fields.",
      metadata: { model_provider: "anthropic", model_name: "claude-haiku-4-5", input_tokens: 620 },
    }),
    evt({
      event_id: id("normalize-model-done"),
      node_id: "normalize-brief",
      timestamp: ts(2900),
      event_type: "model_call_completed",
      status: "completed",
      duration_ms: 2100,
      cost_usd: 0.0018,
      output_summary: "Parsed: target_region=EMEA, segment=SMB+Enterprise, budget=unconfirmed, timeline=Q3-Q4, constraints=[budget-ambiguity, short-timeline].",
      metadata: {
        model_provider: "anthropic", model_name: "claude-haiku-4-5",
        input_tokens: 620, output_tokens: 280,
      },
    }),
    evt({
      event_id: id("normalize-done"),
      node_id: "normalize-brief",
      timestamp: ts(3000),
      event_type: "node_completed",
      status: "completed",
      duration_ms: 2300,
      output_summary: "Brief normalized. Budget flagged as ambiguous.",
    }),

    // ─── extract-strategic-tension (LLM: claude-sonnet-4-6) ───────────────
    evt({
      event_id: id("tension-start"),
      node_id: "extract-strategic-tension",
      timestamp: ts(3100),
      event_type: "node_started",
      status: "running",
      input_summary: "Normalized brief ready for tension extraction.",
    }),
    evt({
      event_id: id("tension-model-start"),
      node_id: "extract-strategic-tension",
      timestamp: ts(3200),
      event_type: "model_call_started",
      status: "running",
      input_summary: "Identify core strategic tension from EMEA SMB+Enterprise expansion brief.",
      metadata: { model_provider: "anthropic", model_name: "claude-sonnet-4-6", input_tokens: 950 },
    }),
    evt({
      event_id: id("tension-model-done"),
      node_id: "extract-strategic-tension",
      timestamp: ts(6800),
      event_type: "model_call_completed",
      status: "completed",
      duration_ms: 3600,
      cost_usd: 0.0047,
      output_summary: "Core tension: growth-vs-focus — broad EMEA push vs. concentrated market entry. Secondary: budget-uncertainty vs. ambition.",
      metadata: {
        model_provider: "anthropic", model_name: "claude-sonnet-4-6",
        input_tokens: 950, output_tokens: 340,
      },
    }),
    evt({
      event_id: id("tension-eval-start"),
      node_id: "extract-strategic-tension",
      timestamp: ts(6900),
      event_type: "eval_started",
      status: "running",
      metadata: { eval_id: "strategic-tension-grounding", eval_name: "Strategic Tension Grounding" },
    }),
    evt({
      event_id: id("tension-eval-done"),
      node_id: "extract-strategic-tension",
      timestamp: ts(7200),
      event_type: "eval_completed",
      status: "completed",
      duration_ms: 300,
      metadata: {
        eval_id: "strategic-tension-grounding", eval_name: "Strategic Tension Grounding",
        passed: true, score: 0.91,
      },
    }),
    evt({
      event_id: id("tension-done"),
      node_id: "extract-strategic-tension",
      timestamp: ts(7300),
      event_type: "node_completed",
      status: "completed",
      duration_ms: 4200,
      output_summary: "Strategic tension: growth-vs-focus. Grounding eval passed (0.91).",
    }),

    // ─── generate-routes (LLM: claude-sonnet-4-6) ──────────────────────────
    evt({
      event_id: id("routes-start"),
      node_id: "generate-routes",
      timestamp: ts(7400),
      event_type: "node_started",
      status: "running",
    }),
    evt({
      event_id: id("routes-model-start"),
      node_id: "generate-routes",
      timestamp: ts(7500),
      event_type: "model_call_started",
      status: "running",
      input_summary: "Generate 3 distinct campaign routes for EMEA SMB+Enterprise, tension=growth-vs-focus.",
      metadata: { model_provider: "anthropic", model_name: "claude-sonnet-4-6", input_tokens: 1100 },
    }),
    evt({
      event_id: id("routes-model-done"),
      node_id: "generate-routes",
      timestamp: ts(14500),
      event_type: "model_call_completed",
      status: "completed",
      duration_ms: 7000,
      cost_usd: 0.0094,
      output_summary: "Routes: (1) EMEA fintech-first direct outreach, (2) Partner-led enterprise pilot with 3 strategic partners, (3) Self-serve content-led SMB SaaS expansion.",
      metadata: {
        model_provider: "anthropic", model_name: "claude-sonnet-4-6",
        input_tokens: 1100, output_tokens: 720,
      },
    }),
    evt({
      event_id: id("routes-schema-eval-start"),
      node_id: "generate-routes",
      timestamp: ts(14600),
      event_type: "eval_started",
      status: "running",
      metadata: { eval_id: "route-schema-validity", eval_name: "Route Schema Validity" },
    }),
    evt({
      event_id: id("routes-schema-eval-done"),
      node_id: "generate-routes",
      timestamp: ts(14800),
      event_type: "eval_completed",
      status: "completed",
      duration_ms: 200,
      metadata: {
        eval_id: "route-schema-validity", eval_name: "Route Schema Validity",
        passed: true, score: 1.0,
      },
    }),
    evt({
      event_id: id("routes-distinct-eval-start"),
      node_id: "generate-routes",
      timestamp: ts(14900),
      event_type: "eval_started",
      status: "running",
      metadata: { eval_id: "route-distinctiveness", eval_name: "Route Distinctiveness" },
    }),
    evt({
      event_id: id("routes-distinct-eval-done"),
      node_id: "generate-routes",
      timestamp: ts(15100),
      event_type: "eval_completed",
      status: "degraded",
      duration_ms: 200,
      metadata: {
        eval_id: "route-distinctiveness", eval_name: "Route Distinctiveness",
        passed: false, score: 0.61,
      },
    }),
    evt({
      event_id: id("routes-done"),
      node_id: "generate-routes",
      timestamp: ts(15200),
      event_type: "node_completed",
      status: "degraded",
      duration_ms: 7800,
      output_summary: "3 routes generated. Schema valid. Distinctiveness degraded (0.61) — routes 1 and 3 share SMB focus.",
    }),

    // ─── build-personas (LLM: claude-haiku-4-5) ────────────────────────────
    evt({
      event_id: id("personas-start"),
      node_id: "build-personas",
      timestamp: ts(15300),
      event_type: "node_started",
      status: "running",
    }),
    evt({
      event_id: id("personas-model-start"),
      node_id: "build-personas",
      timestamp: ts(15400),
      event_type: "model_call_started",
      status: "running",
      input_summary: "Build 2-3 buyer personas for EMEA SMB+Enterprise.",
      metadata: { model_provider: "anthropic", model_name: "claude-haiku-4-5", input_tokens: 580 },
    }),
    evt({
      event_id: id("personas-model-done"),
      node_id: "build-personas",
      timestamp: ts(17900),
      event_type: "model_call_completed",
      status: "completed",
      duration_ms: 2500,
      cost_usd: 0.0022,
      output_summary: "Personas: (1) Maria — CMO at DACH SaaS, 45-day cycle, ROI-driven; (2) Luca — VP Sales at fintech, prefers async demo; (3) Björn — IT Director enterprise, procurement-heavy.",
      metadata: {
        model_provider: "anthropic", model_name: "claude-haiku-4-5",
        input_tokens: 580, output_tokens: 390,
      },
    }),
    evt({
      event_id: id("personas-done"),
      node_id: "build-personas",
      timestamp: ts(18000),
      event_type: "node_completed",
      status: "completed",
      duration_ms: 2700,
      output_summary: "3 personas built: Maria (DACH CMO), Luca (fintech VP Sales), Björn (enterprise IT Director).",
    }),

    // ─── simulate-reactions (LLM: claude-sonnet-4-6) ───────────────────────
    evt({
      event_id: id("sim-start"),
      node_id: "simulate-reactions",
      timestamp: ts(18100),
      event_type: "node_started",
      status: "running",
    }),
    evt({
      event_id: id("sim-model-start"),
      node_id: "simulate-reactions",
      timestamp: ts(18200),
      event_type: "model_call_started",
      status: "running",
      input_summary: "Simulate persona reactions across 3 routes × 3 personas.",
      metadata: { model_provider: "anthropic", model_name: "claude-sonnet-4-6", input_tokens: 1800 },
    }),
    evt({
      event_id: id("sim-model-done"),
      node_id: "simulate-reactions",
      timestamp: ts(29000),
      event_type: "model_call_completed",
      status: "completed",
      duration_ms: 10800,
      cost_usd: 0.0162,
      output_summary: "Simulation complete. Route 1 resonates most with Luca (fintech). Route 2 resonates with Björn (enterprise). Route 3 resonates with Maria (CMO). Avg conversion: 11%, 9%, 14%.",
      metadata: {
        model_provider: "anthropic", model_name: "claude-sonnet-4-6",
        input_tokens: 1800, output_tokens: 1050,
      },
    }),
    evt({
      event_id: id("sim-eval-start"),
      node_id: "simulate-reactions",
      timestamp: ts(29100),
      event_type: "eval_started",
      status: "running",
      metadata: { eval_id: "persona-reaction-consistency", eval_name: "Persona Reaction Consistency" },
    }),
    evt({
      event_id: id("sim-eval-done"),
      node_id: "simulate-reactions",
      timestamp: ts(29400),
      event_type: "eval_completed",
      status: "completed",
      duration_ms: 300,
      metadata: {
        eval_id: "persona-reaction-consistency", eval_name: "Persona Reaction Consistency",
        passed: true, score: 0.87,
      },
    }),
    evt({
      event_id: id("sim-done"),
      node_id: "simulate-reactions",
      timestamp: ts(29500),
      event_type: "node_completed",
      status: "completed",
      duration_ms: 11400,
      output_summary: "Simulation done. Route 3 wins on conversion. Reaction consistency passed (0.87).",
    }),

    // ─── score-routes (deterministic) ──────────────────────────────────────
    evt({
      event_id: id("score-start"),
      node_id: "score-routes",
      timestamp: ts(29600),
      event_type: "node_started",
      status: "running",
    }),
    evt({
      event_id: id("score-eval-start"),
      node_id: "score-routes",
      timestamp: ts(29700),
      event_type: "eval_started",
      status: "running",
      metadata: { eval_id: "route-score-schema-validity", eval_name: "Route Score Schema Validity" },
    }),
    evt({
      event_id: id("score-eval-done"),
      node_id: "score-routes",
      timestamp: ts(29900),
      event_type: "eval_completed",
      status: "completed",
      duration_ms: 200,
      metadata: {
        eval_id: "route-score-schema-validity", eval_name: "Route Score Schema Validity",
        passed: true, score: 1.0,
      },
    }),
    evt({
      event_id: id("score-done"),
      node_id: "score-routes",
      timestamp: ts(30100),
      event_type: "node_completed",
      status: "completed",
      duration_ms: 500,
      output_summary: "Leaderboard: Route 3 (82), Route 1 (74), Route 2 (68). Route 3 top on persona resonance + strategic tension alignment.",
    }),

    // ─── premortem-review (LLM: claude-sonnet-4-6) ─────────────────────────
    evt({
      event_id: id("premortem-start"),
      node_id: "premortem-review",
      timestamp: ts(30200),
      event_type: "node_started",
      status: "running",
    }),
    evt({
      event_id: id("premortem-model-start"),
      node_id: "premortem-review",
      timestamp: ts(30300),
      event_type: "model_call_started",
      status: "running",
      input_summary: "Premortem stress-test of Route 3 (content-led self-serve SMB SaaS).",
      metadata: { model_provider: "anthropic", model_name: "claude-sonnet-4-6", input_tokens: 1400 },
    }),
    evt({
      event_id: id("premortem-model-done"),
      node_id: "premortem-review",
      timestamp: ts(36500),
      event_type: "model_call_completed",
      status: "completed",
      duration_ms: 6200,
      cost_usd: 0.0088,
      output_summary: "Failure modes: (1) Content production velocity too slow for Q3 timeline. (2) SEO payoff 6-9 months — misses Q3 target. (3) Without budget clarity, content scaling risks underfunding. Mitigation: launch paid amplification as hedge.",
      metadata: {
        model_provider: "anthropic", model_name: "claude-sonnet-4-6",
        input_tokens: 1400, output_tokens: 610,
      },
    }),
    evt({
      event_id: id("premortem-eval-start"),
      node_id: "premortem-review",
      timestamp: ts(36600),
      event_type: "eval_started",
      status: "running",
      metadata: { eval_id: "premortem-depth", eval_name: "Premortem Depth" },
    }),
    evt({
      event_id: id("premortem-eval-done"),
      node_id: "premortem-review",
      timestamp: ts(36800),
      event_type: "eval_completed",
      status: "completed",
      duration_ms: 200,
      metadata: {
        eval_id: "premortem-depth", eval_name: "Premortem Depth",
        passed: true, score: 0.93,
      },
    }),
    evt({
      event_id: id("premortem-done"),
      node_id: "premortem-review",
      timestamp: ts(36900),
      event_type: "node_completed",
      status: "completed",
      duration_ms: 6700,
      output_summary: "Premortem identified 3 failure modes. Depth eval passed (0.93). Mitigation suggested.",
    }),

    // ─── compare-routes (deterministic) ────────────────────────────────────
    evt({
      event_id: id("compare-start"),
      node_id: "compare-routes",
      timestamp: ts(37000),
      event_type: "node_started",
      status: "running",
    }),
    evt({
      event_id: id("compare-done"),
      node_id: "compare-routes",
      timestamp: ts(37400),
      event_type: "node_completed",
      status: "completed",
      duration_ms: 400,
      output_summary: "Route comparison assembled. Route 3 leads (82). Premortem risks flagged inline.",
    }),

    // ─── human-selection (approval) ────────────────────────────────────────
    evt({
      event_id: id("approval-request"),
      node_id: "human-selection",
      timestamp: ts(37500),
      event_type: "approval_requested",
      status: "pending",
      input_summary: "3 routes compared. Awaiting human selection. Route 3 recommended by scoring.",
    }),
    evt({
      event_id: id("approval-granted"),
      node_id: "human-selection",
      timestamp: ts(97500),
      event_type: "approval_granted",
      status: "completed",
      duration_ms: 60000,
      output_summary: "Human selected Route 3: content-led self-serve SMB SaaS. Approved with note: add paid amplification hedge per premortem.",
    }),

    // ─── generate-execution-plan (LLM: claude-sonnet-4-6) ──────────────────
    evt({
      event_id: id("plan-start"),
      node_id: "generate-execution-plan",
      timestamp: ts(97600),
      event_type: "node_started",
      status: "running",
    }),
    evt({
      event_id: id("plan-tool-start"),
      node_id: "generate-execution-plan",
      timestamp: ts(97700),
      event_type: "tool_call_started",
      status: "running",
      input_summary: "Calculate budget split for 3-channel 90-day content + paid amplification plan.",
      metadata: {
        tool_call_id: "tc-budget-calc-001",
        tool_name: "budget_calculator",
        permission_class: "read_only",
      },
    }),
    evt({
      event_id: id("plan-tool-done"),
      node_id: "generate-execution-plan",
      timestamp: ts(98200),
      event_type: "tool_call_completed",
      status: "completed",
      duration_ms: 500,
      output_summary: "Budget split: 60% content production, 25% paid amplification, 15% distribution partnerships.",
      metadata: {
        tool_call_id: "tc-budget-calc-001",
        tool_name: "budget_calculator",
        permission_class: "read_only",
      },
    }),
    evt({
      event_id: id("plan-model-start"),
      node_id: "generate-execution-plan",
      timestamp: ts(98300),
      event_type: "model_call_started",
      status: "running",
      input_summary: "Generate 90-day execution plan for Route 3 with paid amplification hedge.",
      metadata: { model_provider: "anthropic", model_name: "claude-sonnet-4-6", input_tokens: 1650 },
    }),
    evt({
      event_id: id("plan-model-done"),
      node_id: "generate-execution-plan",
      timestamp: ts(108100),
      event_type: "model_call_completed",
      status: "completed",
      duration_ms: 9800,
      cost_usd: 0.0139,
      output_summary: "90-day plan: Week 1-4 (content foundation, 3 pillar pieces), Week 5-10 (distribution push + paid amplification in DE/NL), Week 11-13 (measure, optimize, Q3 milestone review). KPIs: 500 MQL, 12 pilots.",
      metadata: {
        model_provider: "anthropic", model_name: "claude-sonnet-4-6",
        input_tokens: 1650, output_tokens: 1100,
      },
    }),
    evt({
      event_id: id("plan-done"),
      node_id: "generate-execution-plan",
      timestamp: ts(108200),
      event_type: "node_completed",
      status: "completed",
      duration_ms: 10600,
      output_summary: "Execution plan complete. 90-day roadmap with KPIs generated.",
    }),

    // ─── export-artifact ───────────────────────────────────────────────────
    evt({
      event_id: id("artifact-start"),
      node_id: "export-artifact",
      timestamp: ts(108300),
      event_type: "node_started",
      status: "running",
    }),
    evt({
      event_id: id("artifact-created"),
      node_id: "export-artifact",
      timestamp: ts(108900),
      event_type: "artifact_created",
      status: "completed",
      output_summary: "Campaign recommendation report packaged.",
      metadata: {
        artifact_ref: `campaign-recommendation-${RUN_ID}.json`,
        artifact_type: "json_report",
      },
    }),
    evt({
      event_id: id("export-done"),
      node_id: "export-artifact",
      timestamp: ts(109000),
      event_type: "node_completed",
      status: "completed",
      duration_ms: 700,
      output_summary: "Artifact exported.",
    }),

    // ─── run completed ─────────────────────────────────────────────────────
    evt({
      event_id: id("run-done"),
      timestamp: ts(109100),
      event_type: "run_completed",
      status: "degraded",
      duration_ms: 109100,
      cost_usd: 0.0570,
      output_summary: "Campaign recommendation generated. Route 3 selected. Run degraded: route-distinctiveness eval failed (0.61) — routes 1 and 3 had overlapping SMB focus.",
    }),
  ];

  for (const event of events) {
    const result = await runStore.appendTraceEvent(RUN_ID, event);
    if (!result.appended && result.warning) {
      console.warn(`  ⚠  Event ${event.event_id}: ${result.warning}`);
    }
  }
  console.log(`  ✔  ${events.length} trace events appended`);

  // ── 3. Eval results ──────────────────────────────────────────────────────

  const evalResults: EvalResult[] = [
    evalResultSchema.parse({
      eval_id: "strategic-tension-grounding",
      run_id: RUN_ID,
      node_id: "extract-strategic-tension",
      name: "Strategic Tension Grounding",
      type: "output_quality",
      score: 0.91,
      passed: true,
      severity: "info",
      findings: [
        "Tension (growth-vs-focus) is directly grounded in brief ambiguity.",
        "Secondary tension (budget-uncertainty) also captured.",
      ],
      recommendation: "No action required.",
    }),
    evalResultSchema.parse({
      eval_id: "route-schema-validity",
      run_id: RUN_ID,
      node_id: "generate-routes",
      name: "Route Schema Validity",
      type: "schema_validity",
      score: 1.0,
      passed: true,
      severity: "info",
      findings: ["All 3 routes have name, hypothesis, target_segment, channel_mix, and key_risk."],
      recommendation: "No action required.",
    }),
    evalResultSchema.parse({
      eval_id: "route-distinctiveness",
      run_id: RUN_ID,
      node_id: "generate-routes",
      name: "Route Distinctiveness",
      type: "output_quality",
      score: 0.61,
      passed: false,
      severity: "warning",
      findings: [
        "Routes 1 and 3 both target EMEA SMB — they share a primary audience.",
        "Distinctiveness threshold is 0.70 (each route should differ on at least 2 of 4 dimensions: audience, channel, hypothesis, timeline).",
      ],
      recommendation: "Regenerate routes with explicit constraint: each route must differ on primary audience OR primary channel.",
    }),
    evalResultSchema.parse({
      eval_id: "persona-reaction-consistency",
      run_id: RUN_ID,
      node_id: "simulate-reactions",
      name: "Persona Reaction Consistency",
      type: "output_quality",
      score: 0.87,
      passed: true,
      severity: "info",
      findings: ["All 3 personas reference at least 2 of their defined traits in their reaction.", "Predicted conversion ranges are plausible given persona buying cycle."],
      recommendation: "No action required.",
    }),
    evalResultSchema.parse({
      eval_id: "route-score-schema-validity",
      run_id: RUN_ID,
      node_id: "score-routes",
      name: "Route Score Schema Validity",
      type: "schema_validity",
      score: 1.0,
      passed: true,
      severity: "info",
      findings: ["All 3 routes have numeric scores on all 4 dimensions (persona_resonance, brand_fit, feasibility, tension_alignment)."],
      recommendation: "No action required.",
    }),
    evalResultSchema.parse({
      eval_id: "premortem-depth",
      run_id: RUN_ID,
      node_id: "premortem-review",
      name: "Premortem Depth",
      type: "output_quality",
      score: 0.93,
      passed: true,
      severity: "info",
      findings: [
        "3 distinct failure modes identified.",
        "All failure modes reference specific constraints from the normalized brief.",
        "Mitigation proposed for 2 of 3 failure modes.",
      ],
      recommendation: "No action required.",
    }),
  ];

  for (const er of evalResults) {
    await runStore.appendEvalResult(RUN_ID, er);
  }
  console.log(`  ✔  ${evalResults.length} eval results appended`);

  // ── 4. Complete run ──────────────────────────────────────────────────────

  await runStore.completeRun(RUN_ID, {
    status: "degraded",
    completed_at: ts(109100),
    total_duration_ms: 109100,
    total_cost_usd: 0.0570,
    model_calls_count: 6,
    tool_calls_count: 1,
    evals_passed: 5,
    evals_failed: 1,
    artifact_refs: [`campaign-recommendation-${RUN_ID}.json`],
    summary: "Campaign recommendation generated. Route 3 (content-led SMB SaaS) selected with paid amplification hedge. Run degraded: route-distinctiveness eval failed — routes 1 and 3 shared SMB focus.",
  });

  console.log("  ✔  Run completed with status: degraded");
  console.log("");
  console.log(`✅  Full Campaign Sandbox run seeded: ${RUN_ID}`);
  console.log(`   View at:  http://localhost:3000/dashboard/runs/${RUN_ID}`);
  console.log(`   All runs: http://localhost:3000/dashboard/runs`);
  console.log("");
  console.log("   What to expect:");
  console.log("   • 12 workflow nodes, each with node_started/completed events");
  console.log("   • 6 model calls (haiku for normalize+personas, sonnet for the rest)");
  console.log("   • 1 tool call (budget_calculator)");
  console.log("   • 6 evals (5 passed, 1 degraded — route-distinctiveness)");
  console.log("   • 1 approval gate (human-selection)");
  console.log("   • 1 artifact (campaign-recommendation JSON)");
  console.log("   • Status: degraded");
}

seedRun().catch((err: unknown) => {
  console.error("❌  Seed failed:", err);
  process.exit(1);
});
