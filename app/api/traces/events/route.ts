/**
 * POST /api/traces/events
 *
 * Appends one or many trace events to a run.
 *
 * Auth: x-reeprov-key (REEPROV_INGEST_KEY or REEPROV_ACCESS_KEY)
 *
 * Body:
 *   events  TraceEvent[]  — array of trace events to ingest
 *
 * Response:
 *   { ok, accepted, duplicates, rejected, results: [{ index, event_id, status, code?, message? }], errors }
 *   200 all succeeded · 207 some rejected · 422 all rejected.
 *
 * Idempotency: an event with an existing event_id is reported as DUPLICATE
 * and not stored again. A storage write that fails is REJECTED
 * (PERSISTENCE_FAILED), never reported as accepted.
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
import { sanitizeCanonicalRecord } from "@/lib/core/capture/redaction";
import { DEFAULT_CAPTURE_POLICY } from "@/lib/core/capture/policy";
import { tryBuildEvalResultFromTraceEvent } from "@/lib/proof-layer/evalFromTrace";
import { classifyZodIssues } from "@/lib/diagnostics/classifyIngestError";
import { getCanonicalRun } from "@/lib/core/capture/persistence";
import { applyPolicyToTraceEvent, capturePolicyForRun } from "@/lib/core/capture/runPolicy";
import { ingestHttpStatus } from "@/lib/core/capture/ingestBoundaries";
import type { CapturePolicy } from "@/lib/core/capture/types";
import { agentIdFromMetadata, resolveExplicitAgentId } from "@/lib/core/contracts/identity";

interface EventError {
  event_id: string;
  message: string;
}

interface EventResult {
  index: number;
  event_id: string;
  status: "ACCEPTED" | "DUPLICATE" | "REJECTED";
  code?: string;
  message?: string;
  warnings?: string[];
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
      return NextResponse.json({ ok: true, accepted: 0, duplicates: 0, rejected: 0, results: [], errors: [] });
    }

    const results: EventResult[] = [];
    const touchedProjects = new Set<string>();
    const policies = new Map<string, CapturePolicy>();
    const reject = (index: number, event_id: string, code: string, message: string) =>
      results.push({ index, event_id, status: "REJECTED", code, message });

    for (const [index, raw] of rawEvents.entries()) {
      const parseResult = traceEventSchema.safeParse(raw);
      if (!parseResult.success) {
        const eventId =
          typeof raw === "object" && raw !== null && typeof (raw as Record<string, unknown>)["event_id"] === "string"
            ? String((raw as Record<string, unknown>)["event_id"])
            : "unknown";
        const message = parseResult.error.issues.map((i) => i.message).join("; ");
        reject(index, eventId, "SCHEMA_VALIDATION_FAILED", message);

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

      const resolvedAgentId = resolveExplicitAgentId(
        parseResult.data.agent_id,
        agentIdFromMetadata(parseResult.data.metadata)
      );
      parseResult.data = resolvedAgentId
        ? { ...parseResult.data, agent_id: resolvedAgentId }
        : parseResult.data;

      const run = await getRunStore().getRun(parseResult.data.run_id);
      // A scoped ingest key may only append events to runs it owns. Treat a
      // scope mismatch identically to "not found" so a scoped key cannot be
      // used to probe for the existence of other projects' runs.
      const ownedByScope = !auth.integration || run?.runRecord.project_id === auth.integration.projectId;
      if (!run || !ownedByScope) {
        const event = sanitizeCanonicalRecord(parseResult.data, DEFAULT_CAPTURE_POLICY);
        reject(index, event.event_id, "RUN_NOT_FOUND", `Run "${event.run_id}" not found. Start the run first with POST /api/runs/start.`);
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

      const warnings: string[] = [];
      let policy = policies.get(parseResult.data.run_id);
      if (!policy) {
        policy = capturePolicyForRun(await getCanonicalRun(parseResult.data.run_id));
        policies.set(parseResult.data.run_id, policy);
      }
      // Build eval evidence from the verdict-bearing metadata before content
      // minimization, then store the event under the run's content mode.
      const evalResult = tryBuildEvalResultFromTraceEvent(sanitizeCanonicalRecord(parseResult.data, policy));
      const event: TraceEvent = applyPolicyToTraceEvent(parseResult.data, policy);

      const appended = await getRunStore().appendTraceEvent(event.run_id, event);
      if (appended.warning) {
        reject(index, event.event_id, "PERSISTENCE_FAILED", appended.warning);
        continue;
      }

      // If this is an eval_completed event with well-formed metadata, also
      // append an EvalResult record via the shared helper. Duplicate events
      // retry this idempotent append so a lost eval write can be repaired.
      if (evalResult) {
        const evalAppend = await getRunStore().appendEvalResult(event.run_id, evalResult);
        if (evalAppend.warning) {
          reject(index, event.event_id, "EVAL_PERSISTENCE_FAILED", evalAppend.warning);
          continue;
        }
      } else if (event.event_type === "eval_completed") {
        warnings.push("EVAL_NOT_RECORDED: eval_completed requires eval_id, eval_name and a boolean passed verdict; no EvalResult was stored.");
        await recordIngestDiagnostic({
          projectId: run.runRecord.project_id,
          runId: event.run_id,
          eventType: event.event_type,
          category: "malformed_metadata",
          errorCode: "422",
          message: "eval_completed event requires eval_id, eval_name, and a boolean passed verdict; it was not converted to an EvalResult.",
        });
      }

      // Mark integration active — once per project per batch (non-fatal).
      const projectId = run.runRecord.project_id;
      if (!touchedProjects.has(projectId)) {
        touchedProjects.add(projectId);
        void touchIntegrationForProject(projectId, { runId: event.run_id });
      }

      results.push({
        index, event_id: event.event_id, status: appended.appended ? "ACCEPTED" : "DUPLICATE",
        warnings: warnings.length > 0 ? warnings : undefined,
      });
    }

    const rejected = results.filter((r) => r.status === "REJECTED");
    const errors: EventError[] = rejected.map((r) => ({ event_id: r.event_id, message: r.message ?? r.code ?? "rejected" }));
    const summary = {
      ok: rejected.length === 0,
      accepted: results.filter((r) => r.status === "ACCEPTED").length,
      duplicates: results.filter((r) => r.status === "DUPLICATE").length,
      rejected: rejected.length,
      results,
      errors,
    };
    return NextResponse.json(summary, { status: ingestHttpStatus(summary) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
