/**
 * POST /api/traces/events
 *
 * Appends one or many trace events to a run.
 *
 * Auth: x-agentpulse-key (AGENTPULSE_INGEST_KEY or AGENTPULSE_ACCESS_KEY)
 *
 * Body:
 *   events  TraceEvent[]  — array of trace events to ingest
 *
 * Response:
 *   { accepted: number, rejected: number, errors: [...] }
 *
 * Idempotency: events with a duplicate event_id for the same run are silently
 * skipped and counted as accepted (not rejected).
 *
 * Eval pass-through: when an `eval_completed` event has well-formed metadata,
 * the shared `tryBuildEvalResultFromTraceEvent` helper builds an EvalResult
 * record and appends it to the run.
 */

import { NextResponse } from "next/server";
import { apiErrorResponse, invalidRequest } from "@/lib/api/errors";
import { requireIngestKey } from "@/lib/auth/requireIngestKey";
import { getRunStore, touchIntegrationForProject } from "@/lib/db/getStores";
import { traceEventSchema } from "@/lib/proof-layer/schemas";
import type { TraceEvent } from "@/lib/proof-layer/schemas";
import { tryBuildEvalResultFromTraceEvent } from "@/lib/proof-layer/evalFromTrace";

interface EventError {
  event_id: string;
  message: string;
}

export async function POST(request: Request) {
  try {
    requireIngestKey(request);

    const body = (await request.json()) as Record<string, unknown>;
    const rawEvents = body["events"];

    if (!Array.isArray(rawEvents)) {
      throw invalidRequest('Body must include an "events" array.');
    }

    if (rawEvents.length === 0) {
      return NextResponse.json({ accepted: 0, rejected: 0, errors: [] });
    }

    let accepted = 0;
    let rejected = 0;
    const errors: EventError[] = [];
    const touchedProjects = new Set<string>();

    for (const raw of rawEvents) {
      const parseResult = traceEventSchema.safeParse(raw);
      if (!parseResult.success) {
        const eventId =
          typeof raw === "object" && raw !== null && typeof (raw as Record<string, unknown>)["event_id"] === "string"
            ? String((raw as Record<string, unknown>)["event_id"])
            : "unknown";
        rejected++;
        errors.push({
          event_id: eventId,
          message: parseResult.error.issues.map((i) => i.message).join("; "),
        });
        continue;
      }

      const event: TraceEvent = parseResult.data;

      const run = await getRunStore().getRun(event.run_id);
      if (!run) {
        rejected++;
        errors.push({
          event_id: event.event_id,
          message: `Run "${event.run_id}" not found. Start the run first with POST /api/runs/start.`,
        });
        continue;
      }

      await getRunStore().appendTraceEvent(event.run_id, event);

      // If this is an eval_completed event with well-formed metadata, also
      // append an EvalResult record via the shared helper.
      const evalResult = tryBuildEvalResultFromTraceEvent(event);
      if (evalResult) {
        await getRunStore().appendEvalResult(event.run_id, evalResult);
      }

      // Mark integration active — once per project per batch (non-fatal).
      const projectId = run.runRecord.project_id;
      if (!touchedProjects.has(projectId)) {
        touchedProjects.add(projectId);
        void touchIntegrationForProject(projectId, { runId: event.run_id });
      }

      accepted++;
    }

    return NextResponse.json({ accepted, rejected, errors });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
