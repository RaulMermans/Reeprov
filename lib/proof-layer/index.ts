import {
  traceEventSchema,
  workflowSpecSchema,
  type TraceEvent,
  type WorkflowSpec,
  type EvalResult,
} from "./schemas";

// ── In-memory event buffer ─────────────────────────────────────────────────

const _emittedEvents: TraceEvent[] = [];

// ── Validation ─────────────────────────────────────────────────────────────

/**
 * Validates an unknown value as a TraceEvent.
 * Throws a ZodError if validation fails.
 */
export function validateTraceEvent(event: unknown): TraceEvent {
  return traceEventSchema.parse(event);
}

/**
 * Validates an unknown value as a WorkflowSpec.
 * Throws a ZodError if validation fails.
 */
export function validateWorkflowSpec(spec: unknown): WorkflowSpec {
  return workflowSpecSchema.parse(spec);
}

// ── Emission ───────────────────────────────────────────────────────────────

/**
 * Validates and stores a TraceEvent in the in-memory buffer.
 */
export function emitTraceEvent(event: unknown): TraceEvent {
  const validated = validateTraceEvent(event);
  _emittedEvents.push(validated);
  return validated;
}

/**
 * Returns all events emitted via emitTraceEvent. Used in tests.
 */
export function getEmittedEvents(): TraceEvent[] {
  return [..._emittedEvents];
}

/**
 * Clears the in-memory event buffer. Used in tests.
 */
export function clearEmittedEvents(): void {
  _emittedEvents.length = 0;
}

// ── Trace contract ─────────────────────────────────────────────────────────

export interface ContractViolation {
  rule: string;
  message: string;
}

export interface ContractResult {
  passed: boolean;
  violations: ContractViolation[];
}

/**
 * Checks a set of TraceEvents against structural contract rules.
 *
 * Rules:
 * 1. run_started_required: each run_id must have a run_started event
 * 2. run_completed_required: successful traces must have a run_completed event
 * 3. run_failed_required: failed traces must have a run_failed event
 * 4. failed_run_error_required: run_failed events must be accompanied by at least one error event
 * 5. terminal_conflict_requires_degraded_metadata: run_completed and run_failed cannot both appear unless marked degraded/partial
 * 6. tool_call_completion_required: each tool_call_started must have a matching tool_call_completed or tool_call_failed
 * 7. eval_pass_fail_required: each eval_completed must have metadata.passed defined as a boolean
 * 8. artifact_run_id_required: each artifact_created must have a run_id
 */
export function assertTraceContract(traceEvents: TraceEvent[]): ContractResult {
  const violations: ContractViolation[] = [];

  const validatedEvents = traceEvents.map(validateTraceEvent);

  // Collect all run IDs
  const runIds = new Set(validatedEvents.map(e => e.run_id));

  // Rule 1: run_started required for each run_id
  for (const runId of runIds) {
    const runEvents = validatedEvents.filter(e => e.run_id === runId);
    const hasRunStarted = runEvents.some(
      e => e.run_id === runId && e.event_type === "run_started"
    );
    const hasRunCompleted = runEvents.some(e => e.event_type === "run_completed");
    const hasRunFailed = runEvents.some(e => e.event_type === "run_failed");
    const hasTerminalFailureSignal = runEvents.some(e =>
      e.event_type === "error" ||
      e.event_type === "node_failed" ||
      e.event_type === "tool_call_failed"
    );

    if (!hasRunStarted) {
      violations.push({
        rule: "run_started_required",
        message: `Run "${runId}" has no run_started event.`,
      });
    }

    if (!hasRunFailed && !hasRunCompleted) {
      violations.push({
        rule: "run_completed_required",
        message: `Run "${runId}" has no run_completed event for a successful trace.`,
      });
    }

    if (hasTerminalFailureSignal && !hasRunCompleted && !hasRunFailed) {
      violations.push({
        rule: "run_failed_required",
        message: `Run "${runId}" has failure events but no run_failed event.`,
      });
    }

    if (hasRunCompleted && hasRunFailed && !isMarkedDegradedOrPartial(runEvents)) {
      violations.push({
        rule: "terminal_conflict_requires_degraded_metadata",
        message: `Run "${runId}" has both run_completed and run_failed without degraded/partial metadata.`,
      });
    }
  }

  // Rule 2: failed runs must have at least one error event
  const failedRunIds = new Set(
    validatedEvents
      .filter(e => e.event_type === "run_failed")
      .map(e => e.run_id)
  );
  for (const runId of failedRunIds) {
    const hasError = validatedEvents.some(
      e => e.run_id === runId && e.event_type === "error"
    );
    if (!hasError) {
      violations.push({
        rule: "failed_run_error_required",
        message: `Run "${runId}" has a run_failed event but no accompanying error event.`,
      });
    }
  }

  // Rule 3: tool_call_started must have a matching tool_call_completed or tool_call_failed
  const toolStarts = validatedEvents.filter(e => e.event_type === "tool_call_started");
  for (const start of toolStarts) {
    const hasCompletion = validatedEvents.some(e => isMatchingToolCompletion(start, e));
    if (!hasCompletion) {
      violations.push({
        rule: "tool_call_completion_required",
        message: `tool_call_started for node "${start.node_id ?? "unknown"}" in run "${start.run_id}" has no matching tool_call_completed or tool_call_failed.`,
      });
    }
  }

  // Rule 4: eval_completed must have metadata.passed as a boolean
  const evalCompletions = validatedEvents.filter(e => e.event_type === "eval_completed");
  for (const evalEvent of evalCompletions) {
    const passed = evalEvent.metadata?.["passed"];
    if (typeof passed !== "boolean") {
      violations.push({
        rule: "eval_pass_fail_required",
        message: `eval_completed for node "${evalEvent.node_id ?? "unknown"}" in run "${evalEvent.run_id}" is missing metadata.passed (must be boolean).`,
      });
    }
  }

  // Rule 5: artifact_created must have a run_id (always present per schema, but check metadata.run_id if needed)
  const artifactEvents = validatedEvents.filter(e => e.event_type === "artifact_created");
  for (const artifact of artifactEvents) {
    if (!artifact.run_id) {
      violations.push({
        rule: "artifact_run_id_required",
        message: `artifact_created event "${artifact.event_id}" is missing run_id.`,
      });
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

function isMatchingToolCompletion(start: TraceEvent, candidate: TraceEvent): boolean {
  if (
    candidate.event_type !== "tool_call_completed" &&
    candidate.event_type !== "tool_call_failed"
  ) {
    return false;
  }

  if (candidate.run_id !== start.run_id) {
    return false;
  }

  const startedToolCallId = metadataString(start, "tool_call_id");
  if (startedToolCallId) {
    return metadataString(candidate, "tool_call_id") === startedToolCallId;
  }

  const startedToolName = metadataString(start, "tool_name");
  if (!startedToolName) {
    return false;
  }

  return (
    candidate.node_id === start.node_id &&
    metadataString(candidate, "tool_name") === startedToolName
  );
}

function metadataString(event: TraceEvent, key: string): string | undefined {
  const value = event.metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isMarkedDegradedOrPartial(events: TraceEvent[]): boolean {
  return events.some((event) => {
    const metadata = event.metadata ?? {};
    return (
      metadata["degraded"] === true ||
      metadata["partial"] === true ||
      metadata["status"] === "degraded" ||
      metadata["status"] === "partial" ||
      metadata["run_state"] === "degraded" ||
      metadata["run_state"] === "partial"
    );
  });
}

/**
 * Throws an Error if any of the required event types are absent from traceEvents.
 */
export function assertRequiredEvents(
  traceEvents: TraceEvent[],
  requiredEventTypes: string[]
): void {
  const present = new Set(traceEvents.map(e => e.event_type));
  for (const required of requiredEventTypes) {
    if (!present.has(required as TraceEvent["event_type"])) {
      throw new Error(`Required event type "${required}" is missing from trace events.`);
    }
  }
}

// ── Tool call assertions ───────────────────────────────────────────────────

export interface ToolCallExpectation {
  tool_name: string;
  permission_class?: string;
  status?: string;
}

/**
 * Checks that tool_call_completed events (with tool info in metadata) match expectations.
 * Throws an Error if any expectation is not met.
 */
export function assertToolCalls(
  traceEvents: TraceEvent[],
  expectations: ToolCallExpectation[]
): void {
  const toolCompletions = traceEvents.filter(e => e.event_type === "tool_call_completed");

  for (const expectation of expectations) {
    const match = toolCompletions.find(e => {
      const meta = e.metadata ?? {};
      if (meta["tool_name"] !== expectation.tool_name) return false;
      if (
        expectation.permission_class !== undefined &&
        meta["permission_class"] !== expectation.permission_class
      ) {
        return false;
      }
      if (
        expectation.status !== undefined &&
        e.status !== expectation.status
      ) {
        return false;
      }
      return true;
    });

    if (!match) {
      throw new Error(
        `Expected tool_call_completed for tool "${expectation.tool_name}" not found in trace events.`
      );
    }
  }
}

/**
 * Checks that each approval_requested event has a matching approval_granted or approval_rejected.
 * Throws an Error if any approval is unmatched.
 */
export function assertApprovalTrail(traceEvents: TraceEvent[]): void {
  const approvalRequests = traceEvents.filter(
    e => e.event_type === "approval_requested"
  );

  for (const request of approvalRequests) {
    const hasResponse = traceEvents.some(
      e =>
        e.run_id === request.run_id &&
        e.node_id === request.node_id &&
        (e.event_type === "approval_granted" || e.event_type === "approval_rejected")
    );
    if (!hasResponse) {
      throw new Error(
        `approval_requested for node "${request.node_id ?? "unknown"}" in run "${request.run_id}" has no matching approval_granted or approval_rejected.`
      );
    }
  }
}

// ── Summarization ──────────────────────────────────────────────────────────

export interface RunSummary {
  runId: string;
  workflowId: string;
  status: "completed" | "failed" | "degraded" | "unknown";
  totalDurationMs: number;
  totalCostUsd: number;
  modelCallsCount: number;
  toolCallsCount: number;
  evalsPassedCount: number;
  evalsFailedCount: number;
  hasApprovalRequired: boolean;
  artifactCount: number;
}

/**
 * Summarizes a run from its trace events and eval results.
 */
export function summarizeRun(
  traceEvents: TraceEvent[],
  evalResults: EvalResult[]
): RunSummary {
  // Determine run_id and workflow_id from the first event
  const firstEvent = traceEvents[0];
  const runId = firstEvent?.run_id ?? "unknown";
  const workflowId = firstEvent?.workflow_id ?? "unknown";

  // Determine status
  const hasRunFailed = traceEvents.some(e => e.event_type === "run_failed");
  const hasRunCompleted = traceEvents.some(e => e.event_type === "run_completed");
  const hasCriticalFailure = evalResults.some(
    e => !e.passed && e.severity === "critical"
  );
  const hasDegradedFailure = evalResults.some(
    e => !e.passed && (e.severity === "fail" || e.severity === "critical")
  );

  let status: RunSummary["status"] = "unknown";
  const hasAnyEvalFailure = evalResults.some(e => !e.passed);

  if (hasRunFailed || hasCriticalFailure) {
    status = "failed";
  } else if (hasDegradedFailure || hasAnyEvalFailure) {
    status = "degraded";
  } else if (hasRunCompleted) {
    status = "completed";
  }

  return {
    runId,
    workflowId,
    status,
    totalDurationMs: calculateRunLatency(traceEvents),
    totalCostUsd: calculateRunCost(traceEvents),
    modelCallsCount: traceEvents.filter(e => e.event_type === "model_call_completed").length,
    toolCallsCount: traceEvents.filter(e => e.event_type === "tool_call_completed").length,
    evalsPassedCount: evalResults.filter(e => e.passed).length,
    evalsFailedCount: evalResults.filter(e => !e.passed).length,
    hasApprovalRequired: traceEvents.some(e => e.event_type === "approval_requested"),
    artifactCount: traceEvents.filter(e => e.event_type === "artifact_created").length,
  };
}

/**
 * Sums cost_usd from model_call_completed and tool_call_completed events.
 */
export function calculateRunCost(traceEvents: TraceEvent[]): number {
  return traceEvents
    .filter(
      e =>
        e.event_type === "model_call_completed" ||
        e.event_type === "tool_call_completed"
    )
    .reduce((sum, e) => sum + (e.cost_usd ?? 0), 0);
}

/**
 * Uses run_started + run_completed timestamps if available, else sums duration_ms.
 */
export function calculateRunLatency(traceEvents: TraceEvent[]): number {
  const runStarted = traceEvents.find(e => e.event_type === "run_started");
  const runCompleted = traceEvents.find(
    e => e.event_type === "run_completed" || e.event_type === "run_failed"
  );

  if (runStarted && runCompleted) {
    const start = new Date(runStarted.timestamp).getTime();
    const end = new Date(runCompleted.timestamp).getTime();
    if (!isNaN(start) && !isNaN(end)) {
      return end - start;
    }
  }

  // Fallback: sum all duration_ms
  return traceEvents.reduce((sum, e) => sum + (e.duration_ms ?? 0), 0);
}

// ── Failure classification ─────────────────────────────────────────────────

export type FailureType =
  | "none"
  | "model_failure"
  | "tool_failure"
  | "eval_failure"
  | "approval_rejected"
  | "trace_contract_violation"
  | "unknown";

export interface FailureClassification {
  failureType: FailureType;
  severity: "none" | "degraded" | "critical";
  details: string[];
}

/**
 * Classifies the failure mode of a run from trace events and eval results.
 *
 * Priority order:
 * 1. run_failed event → failed run, critical
 * 2. Critical eval failure (safety or any critical severity) → eval_failure, critical
 * 3. Fail-severity eval failure → eval_failure, degraded
 * 4. Warning/info eval failure → eval_failure, degraded
 * 5. approval_rejected event → approval_rejected, degraded
 * 6. No failures → none, none
 */
export function classifyFailure(
  traceEvents: TraceEvent[],
  evalResults: EvalResult[]
): FailureClassification {
  const details: string[] = [];

  // Priority 1: run_failed event
  const runFailed = traceEvents.find(e => e.event_type === "run_failed");
  if (runFailed) {
    const hasModelFailure = traceEvents.some(e => e.event_type === "node_failed");
    const hasToolFailure = traceEvents.some(e => e.event_type === "tool_call_failed");

    if (hasModelFailure) {
      details.push("A model call or node failed during the run.");
      return { failureType: "model_failure", severity: "critical", details };
    }
    if (hasToolFailure) {
      details.push("A tool call failed during the run.");
      return { failureType: "tool_failure", severity: "critical", details };
    }

    details.push("Run failed with no specific model or tool failure identified.");
    return { failureType: "unknown", severity: "critical", details };
  }

  // Priority 2: critical eval failure
  const criticalFailures = evalResults.filter(e => !e.passed && e.severity === "critical");
  if (criticalFailures.length > 0) {
    for (const f of criticalFailures) {
      details.push(`Eval "${f.name}" (${f.type}) failed with critical severity.`);
    }
    return { failureType: "eval_failure", severity: "critical", details };
  }

  // Priority 3: fail-severity eval failure
  const failSeverityFailures = evalResults.filter(
    e => !e.passed && e.severity === "fail"
  );
  if (failSeverityFailures.length > 0) {
    for (const f of failSeverityFailures) {
      details.push(`Eval "${f.name}" (${f.type}) failed.`);
    }
    return { failureType: "eval_failure", severity: "degraded", details };
  }

  // Priority 4: warning/info eval failure
  const nonBlockingEvalFailures = evalResults.filter(e => !e.passed);
  if (nonBlockingEvalFailures.length > 0) {
    for (const f of nonBlockingEvalFailures) {
      details.push(`Eval "${f.name}" (${f.type}) failed with ${f.severity} severity.`);
    }
    return { failureType: "eval_failure", severity: "degraded", details };
  }

  // Priority 5: approval_rejected
  const approvalRejected = traceEvents.find(e => e.event_type === "approval_rejected");
  if (approvalRejected) {
    details.push(
      `Approval was rejected for node "${approvalRejected.node_id ?? "unknown"}" in run "${approvalRejected.run_id}".`
    );
    return { failureType: "approval_rejected", severity: "degraded", details };
  }

  // No failures
  return { failureType: "none", severity: "none", details: [] };
}
