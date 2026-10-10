/**
 * Model Invocation Capture Adapter.
 *
 * Captures observable API/runtime inputs and outputs for foundation model interactions,
 * attributes tokens, links ContextSnapshots, and emits canonical ExecutionBoundary records.
 */

import { modelInvocationSchema, type ModelInvocation } from "../../contracts/models";
import { normalizeBoundary } from "../normalizeBoundary";
import { buildContextSnapshot, type ContextItemInput } from "../contextSnapshotBuilder";
import { hashPayload } from "../hashing";
import { sanitizePayload } from "../redaction";
import { resolvePolicy } from "../policy";
import type { ModelCaptureInput, ModelCaptureResult, CapturePolicy } from "../types";

/**
 * Captures a foundation model invocation and produces linked canonical records.
 */
export async function captureModelInvocation(
  input: ModelCaptureInput,
  policyOverrides?: Partial<CapturePolicy>
): Promise<ModelCaptureResult> {
  const policy = resolvePolicy(policyOverrides);
  const invocationId = `model_${input.runId}_${input.stepId || Date.now()}`;
  const startedAt = input.startedAt;
  const completedAt = input.completedAt || new Date().toISOString();
  const durationMs =
    input.durationMs ??
    Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());

  // ── 1. Assemble Context Items ─────────────────────────────────────────────
  const contextItems: ContextItemInput[] = [];

  // If explicit context items provided, use them
  if (input.contextItems && input.contextItems.length > 0) {
    contextItems.push(...input.contextItems);
  } else {
    // Synthesize context items from messages or prompt
    if (input.prompt) {
      contextItems.push({
        sourceType: "user_input",
        content: input.prompt,
        inclusionReason: "direct_prompt",
      });
    }

    if (input.messages && input.messages.length > 0) {
      for (const msg of input.messages) {
        let sourceType: ContextItemInput["sourceType"] = "conversation_history";
        if (msg.role === "system") {
          sourceType = "system_policy";
        } else if (msg.role === "user") {
          sourceType = "user_input";
        }

        contextItems.push({
          sourceType,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
          sourceReference: msg.name,
          inclusionReason: `chat_turn_${msg.role}`,
        });
      }
    }

    if (input.toolsExposed && input.toolsExposed.length > 0) {
      contextItems.push({
        sourceType: "tool_definition",
        content: JSON.stringify(input.toolsExposed),
        inclusionReason: "active_tools_schema",
      });
    }
  }

  // ── 2. Materialize Context Snapshot ───────────────────────────────────────
  let contextSnapshotId: string | undefined;
  let contextSnapshot = undefined;

  if (contextItems.length > 0) {
    contextSnapshot = await buildContextSnapshot({
      stepId: input.stepId,
      modelInvocationId: invocationId,
      items: contextItems,
      timestamp: startedAt,
      policyOverrides: policy,
    });
    contextSnapshotId = contextSnapshot.snapshot_id;
  }

  // ── 3. Sanitize Response & Compute Hash ────────────────────────────────────
  const responseRedaction = sanitizePayload(input.response, { policy });
  const responseHash = responseRedaction.persisted_hash;
  const promptTokens = input.inputTokens ?? (contextSnapshot?.total_token_estimate || 0);
  const completionTokens = input.outputTokens ?? 0;
  const totalTokens = promptTokens + completionTokens;

  const modelInvocation: ModelInvocation = modelInvocationSchema.parse({
    invocation_id: invocationId,
    step_id: input.stepId,
    node_id: input.nodeId,
    model_name: input.model,
    provider: input.provider,
    parameters: input.parameters,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    cost_usd: input.costUsd,
    duration_ms: durationMs,
    context_snapshot_id: contextSnapshotId,
    response_summary:
      typeof input.response === "string"
        ? input.response.slice(0, 300)
        : JSON.stringify(input.response).slice(0, 300),
    raw_captured: true,
    response_hash: responseHash,
    finish_reason: input.finishReason,
    started_at: startedAt,
    completed_at: completedAt,
    metadata: {
      ...(input.metadata ?? {}),
      tools_count: input.toolsExposed?.length ?? 0,
      cached_tokens: input.cachedTokens,
      reasoning_tokens: input.reasoningTokens,
      revision: input.revision,
    },
  });

  // ── 4. Build Execution Boundary ───────────────────────────────────────────
  const boundaryInput = {
    model: input.model,
    provider: input.provider,
    parameters: input.parameters,
    prompt: input.prompt,
    messages: input.messages,
    tools: input.toolsExposed,
  };

  const boundary = await normalizeBoundary(
    {
      runId: input.runId,
      stepId: input.stepId,
      nodeId: input.nodeId,
      boundaryType: "model_call",
      name: `${input.provider}/${input.model}`,
      startedAt,
      completedAt,
      durationMs,
      input: boundaryInput,
      output: input.response,
      error: input.error,
      declaredSideEffectClass: "read_only",
      declaredReplayability: "REPLAYABLE_RECORDED",
      dependencyIdentity: `${input.provider}:${input.model}`,
      linkedModelInvocationId: invocationId,
      metadata: {
        context_snapshot_id: contextSnapshotId,
        cost_usd: input.costUsd,
        total_tokens: totalTokens,
      },
    },
    policy
  );

  return { boundary, modelInvocation, contextSnapshot };
}
