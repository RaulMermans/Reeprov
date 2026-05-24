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
 */

import { NextResponse } from "next/server";
import { apiErrorResponse, invalidRequest } from "@/lib/api/errors";
import { requireIngestKey } from "@/lib/auth/requireIngestKey";
import { fileRunStore } from "@/lib/runs/runStore";
import { traceEventSchema } from "@/lib/proof-layer/schemas";
import type { TraceEvent } from "@/lib/proof-layer/schemas";

interface EventError {
  event_id: string;
  message: string;
}

export async function POST(request: Request) {
  try {
    requireIngestKey(request);

    const body = await request.json() as Record<string, unknown>;
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

    for (const raw of rawEvents) {
      // Validate the event.
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

      // Find the run — if the run doesn't exist yet, reject the event.
      const run = await fileRunStore.getRun(event.run_id);
      if (!run) {
        rejected++;
        errors.push({
          event_id: event.event_id,
          message: `Run "${event.run_id}" not found. Start the run first with POST /api/runs/start.`,
        });
        continue;
      }

      await fileRunStore.appendTraceEvent(event.run_id, event);
      accepted++;
    }

    return NextResponse.json({ accepted, rejected, errors });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
