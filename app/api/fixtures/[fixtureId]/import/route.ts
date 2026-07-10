/**
 * POST /api/fixtures/[fixtureId]/import
 *
 * Imports a bundled example fixture as a fresh run, entirely server-side, so
 * AgentPulse can be validated with a non-BlogAgent, non-Website-Auditor
 * project without any external integration. This is a demo/test-data action,
 * clearly separate from production ingestion.
 *
 * Auth:   x-agentpulse-key (AGENTPULSE_ACCESS_KEY — dashboard key, not ingest key)
 * Body:   none
 * Returns: { ok: true, runId: string, redirectTo: string }
 *
 * Each call generates a fresh run_id and reuses the fixture's own event_id /
 * tool_call_id / eval_id / artifact_ref values, since those are only unique
 * within a run_id — repeated imports never collide with each other or with
 * real ingested data.
 *
 * Only a fixed allowlist of fixture files can be imported; the fixtureId is
 * never used to build a filesystem path directly.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { getRunStore, touchIntegrationForProject } from "@/lib/db/getStores";
import { generateRunId } from "@/lib/runs/runId";
import {
  evalResultSchema,
  runRecordSchema,
  toolCallRecordSchema,
  traceEventSchema,
} from "@/lib/proof-layer/schemas";
import type { EvalResult, RunRecord, ToolCallRecord, TraceEvent } from "@/lib/proof-layer/schemas";

/** Allowlist of importable fixtures. Never derive a file path from user input. */
const FIXTURE_FILES: Record<string, string> = {
  "customer-support-triage": "customer-support-triage-run.json",
};

type RouteContext = { params: Promise<{ fixtureId: string }> };

interface FixtureFile {
  runRecord: RunRecord;
  traceEvents: TraceEvent[];
  toolCalls?: ToolCallRecord[];
  evalResults?: EvalResult[];
}

export async function POST(request: Request, context: RouteContext) {
  try {
    requireAccessKey(request);

    const { fixtureId } = await context.params;
    const filename = FIXTURE_FILES[fixtureId];
    if (!filename) {
      return NextResponse.json(
        { error: "not_found", message: `Unknown fixture "${fixtureId}".`, availableFixtures: Object.keys(FIXTURE_FILES) },
        { status: 404 },
      );
    }

    const filePath = join(process.cwd(), "examples", "integrations", "fixtures", filename);
    const raw = JSON.parse(await readFile(filePath, "utf8")) as FixtureFile;

    // Every import gets a fresh run_id, prefixed so the UI can label it as
    // fixture-imported demo data (distinct from "demo-" and "seed-" runs).
    // event_id / tool_call_id / eval_id / artifact_ref are only unique within
    // a run_id, so they are reused from the fixture as-is.
    const runId = `fixture-${generateRunId().replace(/^run_/, "")}`;

    const runRecord = runRecordSchema.parse({ ...raw.runRecord, run_id: runId });
    const traceEvents = raw.traceEvents.map((event) =>
      traceEventSchema.parse({ ...event, run_id: runId }),
    );
    const toolCalls = (raw.toolCalls ?? []).map((toolCall) =>
      toolCallRecordSchema.parse({ ...toolCall, run_id: runId }),
    );
    const evalResults = (raw.evalResults ?? []).map((evalResult) =>
      evalResultSchema.parse({ ...evalResult, run_id: runId }),
    );

    const result = await getRunStore().createRun(runRecord);
    if (!result.saved) {
      return NextResponse.json(
        { code: "persistence_unavailable", message: "Fixture run could not be persisted.", details: result.warning },
        { status: 503 },
      );
    }

    for (const event of traceEvents) {
      await getRunStore().appendTraceEvent(runId, event);
    }
    for (const toolCall of toolCalls) {
      await getRunStore().appendToolCallRecord(runId, toolCall);
    }
    for (const evalResult of evalResults) {
      await getRunStore().appendEvalResult(runId, evalResult);
    }

    void touchIntegrationForProject(runRecord.project_id, {
      runId,
      runStatus: runRecord.status,
    });

    return NextResponse.json({ ok: true, runId, redirectTo: `/dashboard/runs/${runId}` });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
