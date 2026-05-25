/**
 * examples/integrations/campaign-sandbox/instrumentation.ts
 *
 * Stage-specific instrumentation helpers for Campaign Sandbox.
 *
 * Each helper wraps a Campaign Sandbox stage with:
 *   - node_started / node_completed events
 *   - model_call_started / model_call_completed events (for LLM stages)
 *   - eval_started / eval_completed events (for evaluator stages)
 *   - artifact_created event (for the export stage)
 *
 * Usage:
 *
 *   import { createCampaignSandboxPulseClient } from "./agentpulse-client";
 *   import { startCampaignRun, emitNormalizeBrief, ... } from "./instrumentation";
 *
 *   const pulse = createCampaignSandboxPulseClient();
 *   const { runId } = await startCampaignRun(pulse, { briefSummary: "..." });
 *
 *   await emitNormalizeBrief(pulse, runId, {
 *     inputSummary: "Raw brief received.",
 *     outputSummary: "Parsed: region=EMEA, segment=SMB.",
 *     durationMs: 2400,
 *     costUsd: 0.0018,
 *     modelProvider: "anthropic",
 *     modelName: "claude-haiku-4-5",
 *     inputTokens: 620,
 *     outputTokens: 280,
 *   });
 */

import type { CampaignSandboxPulseClient, StartRunResult } from "./agentpulse-client";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ModelCallMeta {
  modelProvider: string;
  modelName: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  durationMs?: number;
}

export interface NodeCallMeta {
  inputSummary?: string;
  outputSummary?: string;
  durationMs?: number;
}

export interface LLMNodeMeta extends NodeCallMeta, ModelCallMeta {}

export interface EvalMeta {
  evalId: string;
  evalName: string;
  passed: boolean;
  score?: number;
  findings?: string[];
  durationMs?: number;
}

export interface RunMeta {
  totalCostUsd?: number;
  totalDurationMs?: number;
  modelCallsCount?: number;
  toolCallsCount?: number;
  evalsPassedCount?: number;
  evalsFailedCount?: number;
  artifactRefs?: string[];
}

// ── Run lifecycle ─────────────────────────────────────────────────────────────

export async function startCampaignRun(
  pulse: CampaignSandboxPulseClient,
  opts: { briefSummary: string; runId?: string },
): Promise<{ runId: string; run: StartRunResult }> {
  const run = await pulse.startRun({
    summary: opts.briefSummary,
    run_id: opts.runId,
  });
  return { runId: run.run_id, run };
}

export async function completeCampaignRun(
  pulse: CampaignSandboxPulseClient,
  runId: string,
  meta: RunMeta & { summary: string },
): Promise<void> {
  await pulse.completeRun({
    run_id: runId,
    summary: meta.summary,
    total_cost_usd: meta.totalCostUsd,
    total_duration_ms: meta.totalDurationMs,
    model_calls_count: meta.modelCallsCount,
    tool_calls_count: meta.toolCallsCount,
    evals_passed: meta.evalsPassedCount,
    evals_failed: meta.evalsFailedCount,
    artifact_refs: meta.artifactRefs,
  });
}

export async function failCampaignRun(
  pulse: CampaignSandboxPulseClient,
  runId: string,
  error: { message: string; code?: string },
): Promise<void> {
  await pulse.failRun({
    run_id: runId,
    error_summary: `Run failed: ${error.message}`,
    error_code: error.code,
  });
}

// ── Shared helpers ────────────────────────────────────────────────────────────

async function emitLLMNode(
  pulse: CampaignSandboxPulseClient,
  runId: string,
  nodeId: string,
  meta: LLMNodeMeta,
): Promise<void> {
  await pulse.emitEvents(runId, [
    {
      event_type: "node_started",
      node_id: nodeId,
      status: "running",
      input_summary: meta.inputSummary,
    },
    {
      event_type: "model_call_started",
      node_id: nodeId,
      status: "running",
      input_summary: meta.inputSummary,
      metadata: {
        model_provider: meta.modelProvider,
        model_name: meta.modelName,
        input_tokens: meta.inputTokens,
      },
    },
    {
      event_type: "model_call_completed",
      node_id: nodeId,
      status: "completed",
      duration_ms: meta.durationMs,
      cost_usd: meta.costUsd,
      output_summary: meta.outputSummary,
      metadata: {
        model_provider: meta.modelProvider,
        model_name: meta.modelName,
        input_tokens: meta.inputTokens,
        output_tokens: meta.outputTokens,
      },
    },
    {
      event_type: "node_completed",
      node_id: nodeId,
      status: "completed",
      duration_ms: meta.durationMs,
      output_summary: meta.outputSummary,
    },
  ]);
}

async function emitDeterministicNode(
  pulse: CampaignSandboxPulseClient,
  runId: string,
  nodeId: string,
  meta: NodeCallMeta,
): Promise<void> {
  await pulse.emitEvents(runId, [
    {
      event_type: "node_started",
      node_id: nodeId,
      status: "running",
      input_summary: meta.inputSummary,
    },
    {
      event_type: "node_completed",
      node_id: nodeId,
      status: "completed",
      duration_ms: meta.durationMs,
      output_summary: meta.outputSummary,
    },
  ]);
}

// ── Stage-specific helpers ────────────────────────────────────────────────────

export async function emitNormalizeBrief(
  pulse: CampaignSandboxPulseClient,
  runId: string,
  meta: LLMNodeMeta,
): Promise<void> {
  await emitLLMNode(pulse, runId, "normalize-brief", meta);
}

export async function emitExtractStrategicTension(
  pulse: CampaignSandboxPulseClient,
  runId: string,
  meta: LLMNodeMeta,
): Promise<void> {
  await emitLLMNode(pulse, runId, "extract-strategic-tension", meta);
}

export async function emitGenerateRoutes(
  pulse: CampaignSandboxPulseClient,
  runId: string,
  meta: LLMNodeMeta,
): Promise<void> {
  await emitLLMNode(pulse, runId, "generate-routes", meta);
}

export async function emitBuildPersonas(
  pulse: CampaignSandboxPulseClient,
  runId: string,
  meta: LLMNodeMeta,
): Promise<void> {
  await emitLLMNode(pulse, runId, "build-personas", meta);
}

export async function emitSimulateReactions(
  pulse: CampaignSandboxPulseClient,
  runId: string,
  meta: LLMNodeMeta,
): Promise<void> {
  await emitLLMNode(pulse, runId, "simulate-reactions", meta);
}

export async function emitScoreRoutes(
  pulse: CampaignSandboxPulseClient,
  runId: string,
  meta: NodeCallMeta,
): Promise<void> {
  await emitDeterministicNode(pulse, runId, "score-routes", meta);
}

export async function emitPremortumReview(
  pulse: CampaignSandboxPulseClient,
  runId: string,
  meta: LLMNodeMeta,
): Promise<void> {
  await emitLLMNode(pulse, runId, "premortem-review", meta);
}

export async function emitCompareRoutes(
  pulse: CampaignSandboxPulseClient,
  runId: string,
  meta: NodeCallMeta,
): Promise<void> {
  await emitDeterministicNode(pulse, runId, "compare-routes", meta);
}

export async function emitHumanSelectionRequested(
  pulse: CampaignSandboxPulseClient,
  runId: string,
): Promise<void> {
  await pulse.emitEvent(runId, {
    event_type: "approval_requested",
    node_id: "human-selection",
    status: "pending",
    input_summary: "Route comparison ready. Awaiting human route selection.",
  });
}

export async function emitHumanSelectionCompleted(
  pulse: CampaignSandboxPulseClient,
  runId: string,
  selectedRoute: string,
): Promise<void> {
  await pulse.emitEvent(runId, {
    event_type: "approval_granted",
    node_id: "human-selection",
    status: "completed",
    output_summary: `Route selected: ${selectedRoute}`,
  });
}

export async function emitGenerateExecutionPlan(
  pulse: CampaignSandboxPulseClient,
  runId: string,
  meta: LLMNodeMeta,
): Promise<void> {
  await emitLLMNode(pulse, runId, "generate-execution-plan", meta);
}

export async function emitCampaignArtifactCreated(
  pulse: CampaignSandboxPulseClient,
  runId: string,
  opts: { artifactRef: string; summary: string },
): Promise<void> {
  await pulse.emitEvent(runId, {
    event_type: "artifact_created",
    node_id: "export-artifact",
    status: "completed",
    output_summary: opts.summary,
    metadata: {
      artifact_ref: opts.artifactRef,
      artifact_type: "json_report",
    },
  });
}

// ── Eval helpers ──────────────────────────────────────────────────────────────

export async function emitCampaignNodeEval(
  pulse: CampaignSandboxPulseClient,
  runId: string,
  nodeId: string,
  meta: EvalMeta,
): Promise<void> {
  await pulse.emitEvents(runId, [
    {
      event_type: "eval_started",
      node_id: nodeId,
      status: "running",
      metadata: { eval_id: meta.evalId, eval_name: meta.evalName },
    },
    {
      event_type: "eval_completed",
      node_id: nodeId,
      status: "completed",
      duration_ms: meta.durationMs,
      metadata: {
        eval_id: meta.evalId,
        eval_name: meta.evalName,
        passed: meta.passed,
        score: meta.score,
        findings: meta.findings,
      },
    },
  ]);
}
