/**
 * Tool Invocation Capture Adapter.
 *
 * Captures external tool, function, and API executions, records argument and
 * result hashes, evaluates permission and side-effect classes, and produces
 * linked ToolInvocation and ExecutionBoundary records.
 */

import { toolInvocationSchema, type ToolInvocation } from "../../contracts/tools";
import { normalizeBoundary } from "../normalizeBoundary";
import { classifySideEffect } from "../sideEffectClassifier";
import { resolvePolicy } from "../policy";
import { sanitizeCanonicalValue } from "../redaction";
import type { ToolCaptureInput, ToolCaptureResult, CapturePolicy } from "../types";

/**
 * Captures a tool invocation and produces linked canonical records.
 */
export async function captureToolInvocation(
  input: ToolCaptureInput,
  policyOverrides?: Partial<CapturePolicy>
): Promise<ToolCaptureResult> {
  const policy = resolvePolicy(policyOverrides);
  const toolCallId = `tool_${input.runId}_${input.stepId || Date.now()}`;
  const startedAt = input.startedAt;
  const completedAt = input.completedAt || new Date().toISOString();
  const durationMs =
    input.durationMs ??
    Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());

  // 1. Determine side effect class (declared takes precedence, otherwise classified)
  const sideEffectClass = classifySideEffect(
    "tool_call",
    input.toolName,
    input.declaredPermissionClass
  );
  const safeArguments = sanitizeCanonicalValue(input.arguments, policy);
  const safeOutput = sanitizeCanonicalValue(input.output, policy);

  // 2. Build ToolInvocation
  const toolInvocation: ToolInvocation = toolInvocationSchema.parse(sanitizeCanonicalValue({
    tool_call_id: toolCallId,
    step_id: input.stepId,
    node_id: input.nodeId,
    tool_name: input.toolName,
    permission_class: sideEffectClass,
    replayability: "UNKNOWN", // normalized boundary computes exact replayability
    input: safeArguments,
    input_summary:
      typeof safeArguments === "string"
        ? safeArguments.slice(0, 300)
        : JSON.stringify(safeArguments).slice(0, 300),
    output: safeOutput,
    output_summary:
      typeof safeOutput === "string"
        ? safeOutput.slice(0, 300)
        : safeOutput !== undefined
          ? JSON.stringify(safeOutput).slice(0, 300)
          : undefined,
    status: input.status || (input.error ? "failed" : "completed"),
    error: input.error?.message,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: durationMs,
    metadata: {
      ...(input.metadata ?? {}),
      tool_version: input.toolVersion,
      tool_provider: input.toolProvider,
      retry_attempt: input.retryAttempt,
      approval_state: input.approvalState,
    },
  }, policy));

  // 3. Build ExecutionBoundary
  const boundary = await normalizeBoundary(
    {
      runId: input.runId,
      stepId: input.stepId,
      nodeId: input.nodeId,
      sequenceIndex: input.sequenceIndex,
      boundaryType: "tool_call",
      name: input.toolName,
      startedAt,
      completedAt,
      durationMs,
      input: input.arguments,
      output: input.output,
      error: input.error,
      declaredSideEffectClass: sideEffectClass,
      isIdempotent: input.isIdempotent,
      idempotencyKey: input.idempotencyKey,
      dependencyIdentity: input.toolProvider ? `${input.toolProvider}:${input.toolName}` : `tool:${input.toolName}`,
      linkedToolInvocationId: toolCallId,
      metadata: {
        tool_version: input.toolVersion,
        retry_attempt: input.retryAttempt,
        approval_state: input.approvalState,
      },
    },
    policy
  );

  // Update toolInvocation with the boundary's resolved replayability & boundary_id
  toolInvocation.replayability = boundary.replayability;
  toolInvocation.boundary_id = boundary.boundary_id;

  return { boundary, toolInvocation };
}
