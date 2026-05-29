/**
 * POST /api/runs/demo
 *
 * Creates a complete, realistic Website Auditor demo run for product testing.
 * This route exists so the runtime proof layer is explorable from the UI
 * without requiring an external project to integrate AgentPulse first.
 *
 * Auth:   x-agentpulse-key (AGENTPULSE_ACCESS_KEY — dashboard key, not ingest key)
 * Body:   none
 * Returns: { ok: true, runId: string, redirectTo: string }
 *
 * The demo run includes:
 *   - 8 nodes (URL intake, crawler, brand audit, UX audit, SEO audit,
 *              evidence evaluator, report synthesizer, final artifact)
 *   - 4 model calls (brand/UX/SEO/synthesis agents)
 *   - 3 tool calls (fetch_page, screenshot, sitemap_crawl)
 *   - 4 eval results (schema validity, output quality, safety, source grounding)
 *   - 1 artifact (audit-report)
 *   - Realistic cost + latency values
 */

import { NextResponse } from "next/server";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { apiErrorResponse } from "@/lib/api/errors";
import { fileRunStore } from "@/lib/runs/runStore";
import { generateRunId } from "@/lib/runs/runId";
import { traceEventSchema, runRecordSchema, evalResultSchema } from "@/lib/proof-layer/schemas";
import type { TraceEvent, EvalResult, RunRecord } from "@/lib/proof-layer/schemas";

// ── Deterministic timestamp helpers ──────────────────────────────────────────

function ts(base: Date, offsetMs: number): string {
  return new Date(base.getTime() + offsetMs).toISOString();
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    requireAccessKey(request);

    const runId = `demo-${generateRunId()}`;
    const workflowId = "website-auditor-v1";
    const projectId = "proj_website-auditor";
    const projectName = "Website Auditor";
    const startTime = new Date();

    // ── Build all trace events ───────────────────────────────────────────────

    const events: TraceEvent[] = [

      // 1. run_started
      traceEventSchema.parse({
        event_id: `${runId}::run_started`,
        run_id: runId,
        workflow_id: workflowId,
        timestamp: ts(startTime, 0),
        event_type: "run_started",
        status: "running",
        input_summary: "Target URL: https://example-brand.com",
      }),

      // 2. URL intake node
      traceEventSchema.parse({
        event_id: `${runId}::url-intake::started`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "url-intake",
        timestamp: ts(startTime, 50),
        event_type: "node_started",
        status: "running",
        input_summary: "Parsing and validating target URL",
      }),
      traceEventSchema.parse({
        event_id: `${runId}::url-intake::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "url-intake",
        timestamp: ts(startTime, 180),
        event_type: "node_completed",
        status: "completed",
        duration_ms: 130,
        output_summary: "URL validated: https://example-brand.com (reachable, HTTPS)",
      }),

      // 3. Web crawler — tool calls
      traceEventSchema.parse({
        event_id: `${runId}::crawler::started`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "web-crawler",
        timestamp: ts(startTime, 200),
        event_type: "node_started",
        status: "running",
        input_summary: "Crawling https://example-brand.com",
      }),
      traceEventSchema.parse({
        event_id: `${runId}::tool::fetch-page::started`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "web-crawler",
        timestamp: ts(startTime, 210),
        event_type: "tool_call_started",
        status: "running",
        input_summary: "fetch_page(url=https://example-brand.com)",
        metadata: {
          tool_name: "fetch_page",
          tool_call_id: `${runId}::tc1`,
          permission_class: "read_only",
        },
      }),
      traceEventSchema.parse({
        event_id: `${runId}::tool::fetch-page::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "web-crawler",
        timestamp: ts(startTime, 870),
        event_type: "tool_call_completed",
        status: "completed",
        duration_ms: 660,
        output_summary: "Page fetched: 12 KB HTML, 8 images, 4 CSS files",
        metadata: {
          tool_name: "fetch_page",
          tool_call_id: `${runId}::tc1`,
          permission_class: "read_only",
        },
      }),
      traceEventSchema.parse({
        event_id: `${runId}::tool::sitemap::started`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "web-crawler",
        timestamp: ts(startTime, 880),
        event_type: "tool_call_started",
        status: "running",
        input_summary: "sitemap_crawl(url=https://example-brand.com/sitemap.xml)",
        metadata: {
          tool_name: "sitemap_crawl",
          tool_call_id: `${runId}::tc2`,
          permission_class: "read_only",
        },
      }),
      traceEventSchema.parse({
        event_id: `${runId}::tool::sitemap::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "web-crawler",
        timestamp: ts(startTime, 1340),
        event_type: "tool_call_completed",
        status: "completed",
        duration_ms: 460,
        output_summary: "Sitemap parsed: 24 URLs discovered, 18 reachable",
        metadata: {
          tool_name: "sitemap_crawl",
          tool_call_id: `${runId}::tc2`,
          permission_class: "read_only",
        },
      }),
      traceEventSchema.parse({
        event_id: `${runId}::crawler::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "web-crawler",
        timestamp: ts(startTime, 1360),
        event_type: "node_completed",
        status: "completed",
        duration_ms: 1160,
        output_summary: "Crawl complete: 24 pages indexed, screenshots captured",
      }),

      // 4. Screenshot tool
      traceEventSchema.parse({
        event_id: `${runId}::tool::screenshot::started`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "web-crawler",
        timestamp: ts(startTime, 1370),
        event_type: "tool_call_started",
        status: "running",
        input_summary: "screenshot(url=https://example-brand.com, viewport=1440x900)",
        metadata: {
          tool_name: "screenshot",
          tool_call_id: `${runId}::tc3`,
          permission_class: "read_only",
        },
      }),
      traceEventSchema.parse({
        event_id: `${runId}::tool::screenshot::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "web-crawler",
        timestamp: ts(startTime, 2100),
        event_type: "tool_call_completed",
        status: "completed",
        duration_ms: 730,
        output_summary: "Screenshot captured: 1440×900 PNG, 245 KB",
        metadata: {
          tool_name: "screenshot",
          tool_call_id: `${runId}::tc3`,
          permission_class: "read_only",
        },
      }),

      // 5. Brand audit agent — model call
      traceEventSchema.parse({
        event_id: `${runId}::brand-audit::started`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "brand-audit",
        timestamp: ts(startTime, 2150),
        event_type: "node_started",
        status: "running",
        input_summary: "Analysing brand consistency, logo, colours, typography",
      }),
      traceEventSchema.parse({
        event_id: `${runId}::brand-audit::model::started`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "brand-audit",
        timestamp: ts(startTime, 2200),
        event_type: "model_call_started",
        status: "running",
        input_summary: "Brand audit prompt with crawl evidence (3,820 tokens)",
        metadata: { model_provider: "anthropic", model_name: "claude-sonnet-4-6" },
      }),
      traceEventSchema.parse({
        event_id: `${runId}::brand-audit::model::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "brand-audit",
        timestamp: ts(startTime, 5800),
        event_type: "model_call_completed",
        status: "completed",
        duration_ms: 3600,
        cost_usd: 0.0048,
        input_summary: "Brand audit prompt with crawl evidence (3,820 tokens)",
        output_summary: "Brand score: 72/100. Issues: inconsistent logo sizing on mobile, 2 non-brand fonts detected.",
        metadata: {
          model_provider: "anthropic",
          model_name: "claude-sonnet-4-6",
          input_tokens: 3820,
          output_tokens: 640,
        },
      }),
      traceEventSchema.parse({
        event_id: `${runId}::brand-audit::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "brand-audit",
        timestamp: ts(startTime, 5820),
        event_type: "node_completed",
        status: "completed",
        duration_ms: 3670,
        output_summary: "Brand audit complete. Score: 72/100. 3 findings.",
      }),

      // 6. UX audit agent — model call
      traceEventSchema.parse({
        event_id: `${runId}::ux-audit::started`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "ux-audit",
        timestamp: ts(startTime, 5850),
        event_type: "node_started",
        status: "running",
        input_summary: "Analysing UX: navigation, CTA clarity, accessibility",
      }),
      traceEventSchema.parse({
        event_id: `${runId}::ux-audit::model::started`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "ux-audit",
        timestamp: ts(startTime, 5900),
        event_type: "model_call_started",
        status: "running",
        input_summary: "UX audit prompt with screenshots and DOM structure (4,210 tokens)",
        metadata: { model_provider: "anthropic", model_name: "claude-sonnet-4-6" },
      }),
      traceEventSchema.parse({
        event_id: `${runId}::ux-audit::model::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "ux-audit",
        timestamp: ts(startTime, 9700),
        event_type: "model_call_completed",
        status: "completed",
        duration_ms: 3800,
        cost_usd: 0.0056,
        input_summary: "UX audit prompt with screenshots and DOM structure (4,210 tokens)",
        output_summary: "UX score: 81/100. CTA buttons visible above the fold. Navigation clear. Missing skip links.",
        metadata: {
          model_provider: "anthropic",
          model_name: "claude-sonnet-4-6",
          input_tokens: 4210,
          output_tokens: 720,
        },
      }),
      traceEventSchema.parse({
        event_id: `${runId}::ux-audit::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "ux-audit",
        timestamp: ts(startTime, 9720),
        event_type: "node_completed",
        status: "completed",
        duration_ms: 3870,
        output_summary: "UX audit complete. Score: 81/100. 2 findings.",
      }),

      // 7. SEO audit agent — model call
      traceEventSchema.parse({
        event_id: `${runId}::seo-audit::started`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "seo-audit",
        timestamp: ts(startTime, 9750),
        event_type: "node_started",
        status: "running",
        input_summary: "Analysing SEO: meta tags, headings, structured data, page speed signals",
      }),
      traceEventSchema.parse({
        event_id: `${runId}::seo-audit::model::started`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "seo-audit",
        timestamp: ts(startTime, 9800),
        event_type: "model_call_started",
        status: "running",
        input_summary: "SEO audit prompt with page HTML and sitemap (5,100 tokens)",
        metadata: { model_provider: "anthropic", model_name: "claude-sonnet-4-6" },
      }),
      traceEventSchema.parse({
        event_id: `${runId}::seo-audit::model::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "seo-audit",
        timestamp: ts(startTime, 14200),
        event_type: "model_call_completed",
        status: "completed",
        duration_ms: 4400,
        cost_usd: 0.0064,
        input_summary: "SEO audit prompt with page HTML and sitemap (5,100 tokens)",
        output_summary: "SEO score: 68/100. Missing meta descriptions on 6 pages. H1 tag absent on homepage.",
        metadata: {
          model_provider: "anthropic",
          model_name: "claude-sonnet-4-6",
          input_tokens: 5100,
          output_tokens: 810,
        },
      }),
      traceEventSchema.parse({
        event_id: `${runId}::seo-audit::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "seo-audit",
        timestamp: ts(startTime, 14220),
        event_type: "node_completed",
        status: "completed",
        duration_ms: 4470,
        output_summary: "SEO audit complete. Score: 68/100. 4 findings.",
      }),

      // 8. Evidence evaluator
      traceEventSchema.parse({
        event_id: `${runId}::eval-node::started`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "evidence-evaluator",
        timestamp: ts(startTime, 14250),
        event_type: "node_started",
        status: "running",
        input_summary: "Evaluating quality and consistency of audit evidence",
      }),
      traceEventSchema.parse({
        event_id: `${runId}::eval::schema-validity::started`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "evidence-evaluator",
        timestamp: ts(startTime, 14260),
        event_type: "eval_started",
        status: "running",
        input_summary: "schema_validity check: audit output structure",
      }),
      traceEventSchema.parse({
        event_id: `${runId}::eval::schema-validity::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "evidence-evaluator",
        timestamp: ts(startTime, 14380),
        event_type: "eval_completed",
        status: "completed",
        duration_ms: 120,
        output_summary: "All audit sections present and well-formed.",
        metadata: {
          eval_id: `${runId}::ev1`,
          eval_name: "Schema Validity",
          eval_type: "schema_validity",
          passed: true,
          severity: "info",
          score: 1.0,
          findings: [],
        },
      }),
      traceEventSchema.parse({
        event_id: `${runId}::eval::output-quality::started`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "evidence-evaluator",
        timestamp: ts(startTime, 14390),
        event_type: "eval_started",
        status: "running",
        input_summary: "output_quality check: audit recommendation specificity",
      }),
      traceEventSchema.parse({
        event_id: `${runId}::eval::output-quality::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "evidence-evaluator",
        timestamp: ts(startTime, 14580),
        event_type: "eval_completed",
        status: "completed",
        duration_ms: 190,
        output_summary: "Recommendations are specific and actionable.",
        metadata: {
          eval_id: `${runId}::ev2`,
          eval_name: "Output Quality",
          eval_type: "output_quality",
          passed: true,
          severity: "info",
          score: 0.88,
          findings: [],
        },
      }),
      traceEventSchema.parse({
        event_id: `${runId}::eval::safety::started`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "evidence-evaluator",
        timestamp: ts(startTime, 14590),
        event_type: "eval_started",
        status: "running",
        input_summary: "safety check: no sensitive data in report",
      }),
      traceEventSchema.parse({
        event_id: `${runId}::eval::safety::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "evidence-evaluator",
        timestamp: ts(startTime, 14700),
        event_type: "eval_completed",
        status: "completed",
        duration_ms: 110,
        output_summary: "No PII, credentials, or sensitive data found in report output.",
        metadata: {
          eval_id: `${runId}::ev3`,
          eval_name: "Safety Check",
          eval_type: "safety",
          passed: true,
          severity: "info",
          score: 1.0,
          findings: [],
        },
      }),
      traceEventSchema.parse({
        event_id: `${runId}::eval::source-grounding::started`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "evidence-evaluator",
        timestamp: ts(startTime, 14710),
        event_type: "eval_started",
        status: "running",
        input_summary: "source_grounding: audit findings cite crawl evidence",
      }),
      traceEventSchema.parse({
        event_id: `${runId}::eval::source-grounding::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "evidence-evaluator",
        timestamp: ts(startTime, 14880),
        event_type: "eval_completed",
        status: "completed",
        duration_ms: 170,
        output_summary: "Warning: SEO section missing page-level source citations.",
        metadata: {
          eval_id: `${runId}::ev4`,
          eval_name: "Source Grounding",
          eval_type: "source_grounding",
          passed: false,
          severity: "warning",
          score: 0.61,
          findings: ["SEO audit findings lack per-page source citations."],
          recommendation: "Add URL references for each SEO finding.",
        },
      }),
      traceEventSchema.parse({
        event_id: `${runId}::eval-node::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "evidence-evaluator",
        timestamp: ts(startTime, 14900),
        event_type: "node_completed",
        status: "completed",
        duration_ms: 650,
        output_summary: "Evaluation complete: 3/4 evals passed. 1 warning.",
      }),

      // 9. Report synthesizer — model call
      traceEventSchema.parse({
        event_id: `${runId}::synthesizer::started`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "report-synthesizer",
        timestamp: ts(startTime, 14930),
        event_type: "node_started",
        status: "running",
        input_summary: "Synthesising final audit report from brand, UX, and SEO findings",
      }),
      traceEventSchema.parse({
        event_id: `${runId}::synthesizer::model::started`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "report-synthesizer",
        timestamp: ts(startTime, 14980),
        event_type: "model_call_started",
        status: "running",
        input_summary: "Report synthesis prompt with all audit sections (6,840 tokens)",
        metadata: { model_provider: "anthropic", model_name: "claude-sonnet-4-6" },
      }),
      traceEventSchema.parse({
        event_id: `${runId}::synthesizer::model::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "report-synthesizer",
        timestamp: ts(startTime, 20500),
        event_type: "model_call_completed",
        status: "completed",
        duration_ms: 5520,
        cost_usd: 0.0096,
        input_summary: "Report synthesis prompt with all audit sections (6,840 tokens)",
        output_summary: "Final audit report: overall score 74/100. 9 recommendations prioritised by impact.",
        metadata: {
          model_provider: "anthropic",
          model_name: "claude-sonnet-4-6",
          input_tokens: 6840,
          output_tokens: 1240,
        },
      }),
      traceEventSchema.parse({
        event_id: `${runId}::synthesizer::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "report-synthesizer",
        timestamp: ts(startTime, 20520),
        event_type: "node_completed",
        status: "completed",
        duration_ms: 5590,
        output_summary: "Report synthesised. 9 prioritised recommendations.",
      }),

      // 10. Artifact created
      traceEventSchema.parse({
        event_id: `${runId}::artifact::audit-report`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "report-synthesizer",
        timestamp: ts(startTime, 20600),
        event_type: "artifact_created",
        status: "completed",
        output_summary: "Website audit report for example-brand.com (74/100 overall)",
        metadata: {
          artifact_ref: "audit-report",
          artifact_type: "report",
          artifact_size_bytes: 18432,
          pages: 7,
        },
      }),

      // 11. run_completed
      traceEventSchema.parse({
        event_id: `${runId}::run_completed`,
        run_id: runId,
        workflow_id: workflowId,
        timestamp: ts(startTime, 20700),
        event_type: "run_completed",
        status: "completed",
        duration_ms: 20700,
        output_summary: "Website audit complete. Overall score: 74/100. Report available.",
      }),

    ];

    // ── Build eval results ────────────────────────────────────────────────────

    const evalResults: EvalResult[] = [
      evalResultSchema.parse({
        eval_id: `${runId}::ev1`,
        run_id: runId,
        node_id: "evidence-evaluator",
        name: "Schema Validity",
        type: "schema_validity",
        score: 1.0,
        passed: true,
        severity: "info",
        findings: [],
        recommendation: undefined,
      }),
      evalResultSchema.parse({
        eval_id: `${runId}::ev2`,
        run_id: runId,
        node_id: "evidence-evaluator",
        name: "Output Quality",
        type: "output_quality",
        score: 0.88,
        passed: true,
        severity: "info",
        findings: [],
        recommendation: undefined,
      }),
      evalResultSchema.parse({
        eval_id: `${runId}::ev3`,
        run_id: runId,
        node_id: "evidence-evaluator",
        name: "Safety Check",
        type: "safety",
        score: 1.0,
        passed: true,
        severity: "info",
        findings: [],
        recommendation: undefined,
      }),
      evalResultSchema.parse({
        eval_id: `${runId}::ev4`,
        run_id: runId,
        node_id: "evidence-evaluator",
        name: "Source Grounding",
        type: "source_grounding",
        score: 0.61,
        passed: false,
        severity: "warning",
        findings: ["SEO audit findings lack per-page source citations."],
        recommendation: "Add URL references for each SEO finding.",
      }),
    ];

    // ── Compute summary values ───────────────────────────────────────────────

    const totalCostUsd = events.reduce((sum, e) => sum + (e.cost_usd ?? 0), 0);
    const modelCallsCount = events.filter((e) => e.event_type === "model_call_completed").length;
    const toolCallsCount = events.filter((e) => e.event_type === "tool_call_completed").length;
    const evalsPassed = evalResults.filter((e) => e.passed).length;
    const evalsFailed = evalResults.filter((e) => !e.passed).length;

    // Status: degraded because source grounding eval failed with "warning" severity
    const runStatus: RunRecord["status"] = "degraded";

    const runRecord = runRecordSchema.parse({
      run_id: runId,
      workflow_id: workflowId,
      project_id: projectId,
      project_name: projectName,
      status: runStatus,
      started_at: ts(startTime, 0),
      completed_at: ts(startTime, 20700),
      total_duration_ms: 20700,
      total_cost_usd: totalCostUsd,
      model_calls_count: modelCallsCount,
      tool_calls_count: toolCallsCount,
      evals_passed: evalsPassed,
      evals_failed: evalsFailed,
      approval_status: "not_required",
      artifact_refs: ["audit-report"],
      summary: `Website audit for example-brand.com — overall score 74/100, ${evalsPassed}/${evalsPassed + evalsFailed} evals passed`,
    } satisfies RunRecord);

    // ── Persist run ───────────────────────────────────────────────────────────

    const createResult = await fileRunStore.createRun(runRecord);
    if (!createResult.saved) {
      return NextResponse.json(
        {
          code: "persistence_unavailable",
          message: "Demo run could not be persisted. Check server storage configuration.",
          details: createResult.warning ?? "Unknown storage error",
        },
        { status: 503 },
      );
    }

    // Append all trace events.
    for (const event of events) {
      await fileRunStore.appendTraceEvent(runId, event);
    }

    // Append eval results.
    for (const evalResult of evalResults) {
      await fileRunStore.appendEvalResult(runId, evalResult);
    }

    // Mark run complete (degraded due to source grounding warning).
    await fileRunStore.completeRun(runId, {
      status: runStatus,
      completed_at: ts(startTime, 20700),
      total_duration_ms: 20700,
      total_cost_usd: totalCostUsd,
      model_calls_count: modelCallsCount,
      tool_calls_count: toolCallsCount,
      evals_passed: evalsPassed,
      evals_failed: evalsFailed,
    });

    const redirectTo = `/dashboard/runs/${runId}`;

    return NextResponse.json({ ok: true, runId, redirectTo }, { status: 201 });

  } catch (error) {
    return apiErrorResponse(error);
  }
}
