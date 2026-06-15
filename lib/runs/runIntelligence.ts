/**
 * Run intelligence helpers.
 *
 * Pure, deterministic functions that turn a raw run (RunRecord + TraceEvents +
 * EvalResults) into the building blocks for the visual run detail dashboard:
 * grouped workflow stages, a workflow map, an issues list, artifact cards,
 * status chips, and display-safe metric derivations.
 *
 * No I/O, no LLM calls — these only read the records that are already loaded.
 */

import type { EvalResult, RunRecord, TraceEvent, WorkflowNode } from "@/lib/proof-layer/schemas";

// ── Status vocabulary shared across stages and the workflow map ──────────────

export type StageStatus = "completed" | "warning" | "failed" | "running" | "skipped";

export type RunStatusChipLabel = "completed" | "warning" | "failed" | "recovered" | "publish-ready" | "running" | "pending";

export interface RunStatusChip {
  label: RunStatusChipLabel;
  tone: "success" | "warning" | "danger" | "info" | "neutral";
}

// ── Duration derivation ───────────────────────────────────────────────────────

/**
 * Returns a usable duration in milliseconds even when `total_duration_ms` is
 * missing or zero, by falling back to `completed_at - started_at`.
 */
export function deriveRunDurationMs(
  run: Pick<RunRecord, "started_at" | "completed_at" | "total_duration_ms">,
): number | undefined {
  if (typeof run.total_duration_ms === "number" && run.total_duration_ms > 0) {
    return run.total_duration_ms;
  }

  if (run.started_at && run.completed_at) {
    const start = Date.parse(run.started_at);
    const end = Date.parse(run.completed_at);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      return end - start;
    }
  }

  return run.total_duration_ms;
}

/**
 * Same fallback, scoped to a single trace event (for tool/model durations
 * that may only carry `metadata.latency_ms`).
 */
export function deriveEventDurationMs(event: Pick<TraceEvent, "duration_ms" | "metadata">): number | undefined {
  if (typeof event.duration_ms === "number" && event.duration_ms > 0) {
    return event.duration_ms;
  }

  const latency = event.metadata?.["latency_ms"];
  if (typeof latency === "number" && latency > 0) {
    return latency;
  }

  return event.duration_ms;
}

// ── Score normalization ───────────────────────────────────────────────────────

/**
 * Normalizes an eval score to a 0-100 percentage.
 *
 * Some projects emit fractional scores (0.88) and some emit already-scaled
 * scores (88). Treat anything greater than 1 as already a percentage so
 * `88` renders as `88%`, not `8800%`.
 */
export function normalizeScorePercent(score: number): number {
  const percent = score > 1 ? score : score * 100;
  return Math.round(Math.min(100, Math.max(0, percent)));
}

// ── Issues ────────────────────────────────────────────────────────────────────

export type IssueSeverity = "info" | "warning" | "fail" | "critical";

export interface RunIssue {
  id: string;
  stageId?: string;
  stageLabel: string;
  message: string;
  severity: IssueSeverity;
  recovered: boolean;
  recommendedFix?: string;
  source: "trace_event" | "eval_result";
  timestamp?: string;
}

const ERROR_EVENT_TYPES = new Set<TraceEvent["event_type"]>(["error", "node_failed", "tool_call_failed"]);
const RECOVERY_EVENT_TYPES = new Set<TraceEvent["event_type"]>([
  "node_completed",
  "tool_call_completed",
  "model_call_completed",
  "run_completed",
]);

function metadataString(event: TraceEvent | undefined, key: string): string | undefined {
  const value = event?.metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function recommendedFixForEvent(event: TraceEvent): string | undefined {
  const explicit = metadataString(event, "recommendation") ?? metadataString(event, "recommended_fix");
  if (explicit) return explicit;

  switch (event.event_type) {
    case "tool_call_failed":
      return "Check the tool's input payload and permissions; consider adding a retry or dry-run guard.";
    case "node_failed":
      return "Inspect this node's input/output schema and add error handling or a fallback path.";
    case "error":
      return "Review the error details in the raw trace and add monitoring for this failure mode.";
    default:
      return undefined;
  }
}

function wasRecovered(allEvents: TraceEvent[], issueEvent: TraceEvent): boolean {
  return allEvents.some((candidate) => {
    if (candidate === issueEvent) return false;
    if (!RECOVERY_EVENT_TYPES.has(candidate.event_type)) return false;
    if (candidate.node_id !== issueEvent.node_id) return false;
    return candidate.timestamp.localeCompare(issueEvent.timestamp) > 0;
  });
}

function stageLabelFor(nodeId: string | undefined, specNodes?: WorkflowNode[]): string {
  if (!nodeId) return "Run";
  const node = specNodes?.find((n) => n.id === nodeId);
  return node?.label ?? humanizeStageId(nodeId);
}

/**
 * Extracts a flat, ranked list of run issues from error-shaped trace events
 * and failing/critical eval results — the dedicated "what went wrong" view
 * the issues panel needs instead of burying problems in the raw timeline.
 */
export function extractRunIssues(
  traceEvents: TraceEvent[],
  evalResults: EvalResult[],
  specNodes?: WorkflowNode[],
): RunIssue[] {
  const sortedEvents = [...traceEvents].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const issues: RunIssue[] = [];

  for (const event of sortedEvents) {
    if (!ERROR_EVENT_TYPES.has(event.event_type)) continue;

    const message =
      event.output_summary ??
      metadataString(event, "error") ??
      metadataString(event, "error_message") ??
      `${event.event_type.replace(/_/g, " ")} occurred`;

    issues.push({
      id: event.event_id,
      stageId: event.node_id,
      stageLabel: stageLabelFor(event.node_id, specNodes),
      message,
      severity: event.event_type === "node_failed" ? "critical" : "warning",
      recovered: wasRecovered(sortedEvents, event),
      recommendedFix: recommendedFixForEvent(event),
      source: "trace_event",
      timestamp: event.timestamp,
    });
  }

  for (const evalResult of evalResults) {
    if (evalResult.passed && evalResult.severity !== "fail" && evalResult.severity !== "critical") continue;

    issues.push({
      id: evalResult.eval_id,
      stageId: evalResult.node_id,
      stageLabel: stageLabelFor(evalResult.node_id, specNodes),
      message: evalResult.findings[0] ?? `${evalResult.name} did not pass.`,
      severity: evalResult.severity,
      recovered: false,
      recommendedFix: evalResult.recommendation,
      source: "eval_result",
    });
  }

  return issues;
}

// ── Workflow stage grouping ───────────────────────────────────────────────────

export interface RunStage {
  id: string;
  label: string;
  status: StageStatus;
  durationMs?: number;
  modelCallCount: number;
  toolCallCount: number;
  evalCount: number;
  errorCount: number;
  inputSummary?: string;
  outputSummary?: string;
  events: TraceEvent[];
}

function humanizeStageId(id: string): string {
  return id
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function deriveStageStatus(events: TraceEvent[]): StageStatus {
  const hasFailure = events.some(
    (e) => e.event_type === "node_failed" || e.event_type === "tool_call_failed" || e.event_type === "error" || e.status === "failed",
  );
  const hasCompletion = events.some((e) => e.event_type === "node_completed" || e.status === "completed");
  const hasStart = events.some((e) => e.event_type === "node_started" || e.status === "started" || e.status === "running");

  if (hasFailure && hasCompletion) return "warning";
  if (hasFailure && !hasCompletion) return "failed";
  if (hasCompletion) return "completed";
  if (hasStart) return "running";
  return "completed";
}

function deriveStageDuration(events: TraceEvent[]): number | undefined {
  const start = events.find((e) => e.event_type === "node_started");
  const end = [...events].reverse().find((e) => e.event_type === "node_completed" || e.event_type === "node_failed");

  if (start && end) {
    const startMs = Date.parse(start.timestamp);
    const endMs = Date.parse(end.timestamp);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      return endMs - startMs;
    }
  }

  const explicitDurations = events.map((e) => deriveEventDurationMs(e)).filter((ms): ms is number => typeof ms === "number");
  if (explicitDurations.length) {
    return explicitDurations.reduce((sum, ms) => sum + ms, 0);
  }

  return undefined;
}

function countModelCalls(events: TraceEvent[]): number {
  const completed = events.filter((e) => e.event_type === "model_call_completed").length;
  if (completed > 0) return completed;
  return events.filter((e) => e.event_type === "model_call_started").length;
}

function firstSummary(events: TraceEvent[], key: "input_summary" | "output_summary"): string | undefined {
  for (const event of events) {
    const value = event[key];
    if (value) return value;
  }
  return undefined;
}

/**
 * Groups raw trace events by `node_id` into stage cards. Events without a
 * `node_id` (run-level lifecycle events, generic errors) are returned
 * separately as `unassignedEvents` — they belong in the raw trace, not a
 * stage card.
 */
export function groupTraceEventsIntoStages(
  traceEvents: TraceEvent[],
  specNodes?: WorkflowNode[],
): { stages: RunStage[]; unassignedEvents: TraceEvent[] } {
  const sorted = [...traceEvents].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const order: string[] = [];
  const grouped = new Map<string, TraceEvent[]>();
  const unassignedEvents: TraceEvent[] = [];

  for (const event of sorted) {
    if (!event.node_id) {
      unassignedEvents.push(event);
      continue;
    }
    if (!grouped.has(event.node_id)) {
      grouped.set(event.node_id, []);
      order.push(event.node_id);
    }
    grouped.get(event.node_id)!.push(event);
  }

  const stages: RunStage[] = order.map((nodeId) => {
    const events = grouped.get(nodeId)!;
    const startEvent = events.find((e) => e.event_type === "node_started");
    const completionEvent = [...events].reverse().find((e) => e.event_type === "node_completed" || e.event_type === "node_failed");

    return {
      id: nodeId,
      label: stageLabelFor(nodeId, specNodes),
      status: deriveStageStatus(events),
      durationMs: deriveStageDuration(events),
      modelCallCount: countModelCalls(events),
      toolCallCount: events.filter((e) => e.event_type === "tool_call_completed" || e.event_type === "tool_call_failed").length,
      evalCount: events.filter((e) => e.event_type === "eval_completed").length,
      errorCount: events.filter((e) => ERROR_EVENT_TYPES.has(e.event_type)).length,
      inputSummary: startEvent?.input_summary ?? firstSummary(events, "input_summary"),
      outputSummary: completionEvent?.output_summary ?? [...events].reverse().map((e) => e.output_summary).find(Boolean),
      events,
    };
  });

  return { stages, unassignedEvents };
}

// ── Workflow map ordering ─────────────────────────────────────────────────────

export interface WorkflowMapNode {
  id: string;
  label: string;
  status: StageStatus | "not_observed";
}

/**
 * Canonical BlogAgent pipeline order. Used to render a stable, readable
 * pipeline map even when trace events arrive out of declared order, and to
 * surface stages that were never observed (gray, "not observed").
 */
export const BLOGAGENT_STAGE_ORDER: readonly string[] = [
  "intake_request_parsing",
  "generate_research_questions",
  "topic_product_research",
  "extract_webpages",
  "score_sources",
  "outline_generation",
  "draft_writing",
  "seo_optimization",
  "reviewer_critic_pass",
  "final_article_packaging",
];

/**
 * Builds the ordered list of nodes for the visual workflow map.
 *
 * Preference order:
 * 1. Registered/example WorkflowSpec node order (highest confidence).
 * 2. The canonical BlogAgent stage order, when observed stage IDs match it.
 * 3. Chronological order of first observation in the trace.
 */
export function buildWorkflowMap(stages: RunStage[], specNodes?: WorkflowNode[]): WorkflowMapNode[] {
  const stageById = new Map(stages.map((s) => [s.id, s]));

  if (specNodes && specNodes.length > 0) {
    return specNodes.map((node) => {
      const stage = stageById.get(node.id);
      return {
        id: node.id,
        label: node.label,
        status: stage?.status ?? "not_observed",
      };
    });
  }

  const observedIds = new Set(stages.map((s) => s.id));
  const matchesBlogAgent = BLOGAGENT_STAGE_ORDER.some((id) => observedIds.has(id));

  if (matchesBlogAgent) {
    const canonical: WorkflowMapNode[] = BLOGAGENT_STAGE_ORDER.map((id) => {
      const stage = stageById.get(id);
      return {
        id,
        label: stage?.label ?? humanizeStageId(id),
        status: stage?.status ?? "not_observed",
      };
    });
    const extras = stages
      .filter((s) => !BLOGAGENT_STAGE_ORDER.includes(s.id))
      .map((s) => ({ id: s.id, label: s.label, status: s.status }));
    return [...canonical, ...extras];
  }

  return stages.map((s) => ({ id: s.id, label: s.label, status: s.status }));
}

// ── Status chip ───────────────────────────────────────────────────────────────

/**
 * Derives the single, top-level status chip for the run header from the
 * run's lifecycle status plus the issues actually observed — so a run that
 * failed twice and recovered reads as "recovered", not a flat "completed".
 */
export function deriveRunStatusChip(
  run: Pick<RunRecord, "status" | "approval_status">,
  issues: RunIssue[],
  artifactCount: number,
): RunStatusChip {
  if (run.status === "failed") {
    return { label: "failed", tone: "danger" };
  }

  const hasUnrecovered = issues.some((i) => !i.recovered);
  const hasRecovered = issues.some((i) => i.recovered);

  if (run.status === "degraded" || hasUnrecovered) {
    return { label: "warning", tone: "warning" };
  }

  if (hasRecovered) {
    return { label: "recovered", tone: "warning" };
  }

  if (run.status === "completed") {
    const approvalOk = run.approval_status === "granted" || run.approval_status === "not_required" || !run.approval_status;
    if (artifactCount > 0 && approvalOk) {
      return { label: "publish-ready", tone: "success" };
    }
    return { label: "completed", tone: "success" };
  }

  if (run.status === "running" || run.status === "pending") {
    return { label: run.status, tone: "info" };
  }

  return { label: "completed", tone: "neutral" };
}

// ── Artifact cards ────────────────────────────────────────────────────────────

export interface ArtifactCard {
  ref: string;
  title: string;
  artifactType?: string;
  sizeLabel?: string;
  preview?: string;
  downloadUrl?: string;
  isMarkdownArticle: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function metadataNumber(event: TraceEvent | undefined, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = event?.metadata?.[key];
    if (typeof value === "number") return value;
  }
  return undefined;
}

function metadataAny(event: TraceEvent | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = event?.metadata?.[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

/**
 * Builds preview-ready artifact cards from `artifact_created` events.
 * `article_markdown` (or any markdown/article artifact) gets a markdown
 * preview surfaced; other types fall back to a plain summary card.
 */
export function buildArtifactCards(traceEvents: TraceEvent[], fallbackRefs: string[] = []): ArtifactCard[] {
  const artifactEvents = traceEvents.filter((e) => e.event_type === "artifact_created");
  const cards: ArtifactCard[] = artifactEvents
    .map((event) => {
      const ref = metadataAny(event, "artifact_ref") ?? event.event_id;
      const artifactType = metadataAny(event, "artifact_type");
      const sizeBytes = metadataNumber(event, "size_bytes", "size");
      const preview = metadataAny(event, "preview", "content", "markdown", "body");
      const downloadUrl = metadataAny(event, "download_url", "url");
      const isMarkdownArticle = Boolean(
        artifactType && /markdown|article/i.test(artifactType),
      );

      return {
        ref,
        title: metadataAny(event, "title") ?? event.output_summary ?? ref,
        artifactType,
        sizeLabel: typeof sizeBytes === "number" ? formatBytes(sizeBytes) : undefined,
        preview,
        downloadUrl,
        isMarkdownArticle,
      };
    });

  const seenRefs = new Set(cards.map((c) => c.ref));
  for (const ref of fallbackRefs) {
    if (seenRefs.has(ref)) continue;
    cards.push({ ref, title: ref, isMarkdownArticle: false });
  }

  return cards;
}

// ── Inferred workflow fallback ────────────────────────────────────────────────

export interface InferredWorkflowSummary {
  inferred: true;
  stageCount: number;
  message: string;
}

/**
 * Produces the friendly "workflow inferred from run events" summary shown
 * when no registered WorkflowSpec is available — replacing a scary
 * "missing spec" warning with a description of what AgentPulse derived.
 */
export function buildInferredWorkflowSummary(stages: RunStage[]): InferredWorkflowSummary | null {
  if (!stages.length) return null;

  return {
    inferred: true,
    stageCount: stages.length,
    message: `Workflow inferred from run events — ${stages.length} stage${stages.length === 1 ? "" : "s"} observed in the trace. No registered WorkflowSpec was used.`,
  };
}
