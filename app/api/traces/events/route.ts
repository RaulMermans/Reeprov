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
import { getRunStore, recordIngestDiagnostic, requireIngestAuth, touchIntegrationForProject } from "@/lib/db/getStores";
import { traceEventSchema } from "@/lib/proof-layer/schemas";
import type { TraceEvent } from "@/lib/proof-layer/schemas";
import { tryBuildEvalResultFromTraceEvent } from "@/lib/proof-layer/evalFromTrace";
import { classifyZodIssues } from "@/lib/diagnostics/classifyIngestError";

interface EventError {
  event_id: string;
  message: string;
}

export async function POST(request: Request) {
  try {
    const auth = await requireIngestAuth(request, "POST /api/traces/events");

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
        const message = parseResult.error.issues.map((i) => i.message).join("; ");
        errors.push({ event_id: eventId, message });

        const { category, schemaPath } = classifyZodIssues(parseResult.error.issues);
        const rawRunId =
          typeof raw === "object" && raw !== null && typeof (raw as Record<string, unknown>)["run_id"] === "string"
            ? String((raw as Record<string, unknown>)["run_id"])
            : undefined;
        const rawEventType =
          typeof raw === "object" && raw !== null && typeof (raw as Record<string, unknown>)["event_type"] === "string"
            ? String((raw as Record<string, unknown>)["event_type"])
            : undefined;
        await recordIngestDiagnostic({
          runId: rawRunId,
          eventType: rawEventType,
          category,
          errorCode: "400",
          message: `Trace event validation failed: ${message}`,
          schemaPath,
        });
        continue;
      }

      const event: TraceEvent = parseResult.data;

      const run = await getRunStore().getRun(event.run_id);
      // A scoped ingest key may only append events to runs it owns. Treat a
      // scope mismatch identically to "not found" so a scoped key cannot be
      // used to probe for the existence of other projects' runs.
      const ownedByScope = !auth.integration || run?.runRecord.project_id === auth.integration.projectId;
      if (!run || !ownedByScope) {
        rejected++;
        errors.push({
          event_id: event.event_id,
          message: `Run "${event.run_id}" not found. Start the run first with POST /api/runs/start.`,
        });
        await recordIngestDiagnostic({
          integrationId: auth.integration?.integrationId,
          runId: event.run_id,
          eventType: event.event_type,
          category: "run_not_found",
          errorCode: "404",
          message: `Run "${event.run_id}" not found for incoming trace event.`,
        });
        continue;
      }

      await getRunStore().appendTraceEvent(event.run_id, event);

      // If this is an eval_completed event with well-formed metadata, also
      // append an EvalResult record via the shared helper.
      const evalResult = tryBuildEvalResultFromTraceEvent(event);
      if (evalResult) {
        await getRunStore().appendEvalResult(event.run_id, evalResult);
      } else if (event.event_type === "eval_completed") {
        await recordIngestDiagnostic({
          projectId: run.runRecord.project_id,
          runId: event.run_id,
          eventType: event.event_type,
          category: "malformed_metadata",
          errorCode: "422",
          message: "eval_completed event was missing required metadata (eval_id, eval_name) and was not converted to an EvalResult.",
        });
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
