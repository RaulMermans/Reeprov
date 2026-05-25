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
import { traceEventSchema, evalResultSchema } from "@/lib/proof-layer/schemas";
import type { TraceEvent, EvalResult } from "@/lib/proof-layer/schemas";

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

      // If this is an eval_completed event, also create an EvalResult record.
      if (event.event_type === "eval_completed" && event.metadata) {
        const evalResult = tryBuildEvalResult(event);
        if (evalResult) {
          await fileRunStore.appendEvalResult(event.run_id, evalResult);
        }
      }

      accepted++;
    }

    return NextResponse.json({ accepted, rejected, errors });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * Attempts to build an EvalResult from an eval_completed trace event's metadata.
 * Returns null if metadata is too incomplete to produce a valid record.
 */
function tryBuildEvalResult(event: TraceEvent): EvalResult | null {
  const meta = event.metadata ?? {};

  const eval_id = typeof meta["eval_id"] === "string" ? meta["eval_id"] : null;
  const name = typeof meta["eval_name"] === "string" ? meta["eval_name"] : null;

  // Require at minimum an eval_id and a name.
  if (!eval_id || !name) return null;

  const passed = typeof meta["passed"] === "boolean" ? meta["passed"] : true;
  const score = typeof meta["score"] === "number" ? meta["score"] : undefined;
  const rawFindings: unknown[] = Array.isArray(meta["findings"]) ? (meta["findings"] as unknown[]) : [];
  const findings: string[] = rawFindings
    .filter((f): f is string => typeof f === "string");
  const recommendation = typeof meta["recommendation"] === "string"
    ? meta["recommendation"]
    : undefined;

  // Infer severity from passed/score when not supplied explicitly.
  const rawSeverity = typeof meta["severity"] === "string" ? meta["severity"] : null;
  const validSeverities = ["info", "warning", "fail", "critical"] as const;
  type EvalSeverity = typeof validSeverities[number];
  const severity: EvalSeverity =
    rawSeverity && (validSeverities as readonly string[]).includes(rawSeverity)
      ? rawSeverity as EvalSeverity
      : passed
        ? "info"
        : "fail";

  const evalType =
    typeof meta["type"] === "string" && ["schema_validity", "tool_call_assertion", "output_quality",
      "safety", "source_grounding", "trace_contract", "approval_gate", "model_benchmark"].includes(meta["type"] as string)
      ? meta["type"] as EvalResult["type"]
      : "output_quality";

  const result = evalResultSchema.safeParse({
    eval_id,
    run_id: event.run_id,
    node_id: event.node_id,
    name,
    type: evalType,
    score,
    passed,
    severity,
    findings,
    recommendation,
  });

  return result.success ? result.data : null;
}
