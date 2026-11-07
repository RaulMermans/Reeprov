/**
 * H2-C evaluation: convert sequential MAF observations into canonical REEPROV
 * traces, run the three frozen monitors through createDetectorAccess, and score
 * with evaluation.v2. Never writes into research/swarmguard-testbed/results/h2/.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CaptureSession } from "../../../lib/core/capture/sdk";
import { sanitizeCanonicalRecord } from "../../../lib/core/capture/redaction";
import { NO_INJECTION, type InjectionPlan } from "../../swarmguard-testbed/src/contracts";
import { createGroundTruth, type InjectionRecord, type OracleClaimLabel } from "../../swarmguard-testbed/src/isolation";
import { assessObservability } from "../../swarmguard-testbed/src/observability";
import { persistExperimentalRun, loadEvaluatorRecord } from "../../swarmguard-testbed/src/persist";
import { createDetectorAccess } from "../../swarmguard-testbed/src/detector";
import { findGroundTruthLeaks } from "../../swarmguard-testbed/src/leakcheck";
import {
  KARMA_POLICE_MONITOR_ID,
  KARMA_POLICE_MONITOR_VERSION,
  runKarmaPoliceWithFindings,
} from "../../swarmguard-testbed/src/karmaPolice";
import {
  PER_AGENT_MONITOR_ID,
  PER_AGENT_MONITOR_VERSION,
  POOLED_EVENT_MONITOR_ID,
  POOLED_EVENT_MONITOR_VERSION,
  runPerAgentMonitor,
  runPooledEventMonitor,
  type MonitorResult,
} from "../../swarmguard-testbed/src/baselines";
import { EVALUATION_FORMAT, evaluateMonitor, type EvaluationReport } from "../../swarmguard-testbed/src/evaluate";
import { commitSha } from "../../swarmguard-testbed/src/gitmeta";
import {
  modelCaptureUsage,
  resolveExternalExecution,
} from "../../swarmguard-testbed/src/mafExecutionMetadata";
import { codeReceiverBehavior, proveConsumption } from "../src/consumption";
import { judgeH2CClaim } from "../src/oracle";

const FROZEN_DETECTOR_COMMIT_SHA = "5a4bcb59afa37e110b641b35db99c9a6b453137a";

interface RawModelCall {
  response_id: string;
  agent_id: string;
  provider: string;
  model: string;
  execution_mode: string;
  provider_http_completed: boolean;
  started_at: string;
  duration_ms: number;
  input_messages: Array<Record<string, unknown>>;
  output_text: string | null;
  output_contents: Array<Record<string, unknown>>;
  http?: { method?: string; url?: string; status_code?: number } | null;
  usage?: {
    usage_status?: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
  decision_metadata?: { decision?: string; assertion_claim?: string | null; tool_names_requested?: string[] };
}

interface RawToolCall {
  agent_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  is_handoff_tool: boolean;
  started_at: string;
  completed_at: string;
  duration_ms: number;
}

interface RawEpisode {
  episode_id: string;
  condition: "intact_control" | "single_handoff_mutation";
  fault_mechanism?: string;
  execution_mode: string;
  transport_label: string;
  provider_http_completed: boolean;
  started_at: string;
  duration_ms: number;
  episode_valid?: boolean;
  intervention_delivered?: boolean;
  agents_registered: Array<{ id: string; name: string; instructions: string }>;
  model_calls: RawModelCall[];
  tool_calls: RawToolCall[];
  controller_handoff: {
    from_agent_id: string;
    to_agent_id: string;
    producer_text: string;
    delivered_text: string;
    controller_mutated: boolean;
  };
  consumption?: { label?: string; exact_match_in_receiver_input?: boolean };
  downstream_outcome: {
    domain_tools_executed: string[];
    unauthorized_refund_executed: boolean;
  };
}

interface RawPayload {
  schema: string;
  recorded_at: string;
  upstream: Record<string, unknown>;
  host?: Record<string, unknown>;
  execution_mode: string;
  provider_http_completed: boolean;
  request_bounds?: Record<string, unknown>;
  episodes: RawEpisode[];
}

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function sha256String(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function assertNoPrivatePathOrOracleLeak(serialized: string, label: string): void {
  if (/\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+/.test(serialized)) {
    throw new Error(`Private filesystem path detected in ${label}; refusing to write public artifact.`);
  }
  if (/oracle_labels|actual_modification/.test(serialized)) {
    throw new Error(`Oracle ground-truth structure detected in ${label}; refusing to write public artifact.`);
  }
}

async function writeSanitizedJson(filePath: string, value: unknown, label: string): Promise<string> {
  const serialized = JSON.stringify(value, null, 2) + "\n";
  assertNoPrivatePathOrOracleLeak(serialized, label);
  await writeFile(filePath, serialized, "utf8");
  return sha256String(serialized);
}

function unwrapToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (Array.isArray(result)) {
    return result
      .map((item) =>
        item && typeof item === "object" && typeof (item as Record<string, unknown>)["text"] === "string"
          ? String((item as Record<string, unknown>)["text"])
          : ""
      )
      .filter(Boolean)
      .join("\n");
  }
  if (result && typeof result === "object" && typeof (result as Record<string, unknown>)["text"] === "string") {
    return String((result as Record<string, unknown>)["text"]);
  }
  return JSON.stringify(result ?? {});
}

interface AgentSegment {
  agent_id: string;
  model_calls: RawModelCall[];
  tool_calls: RawToolCall[];
}

function segmentByAgent(episode: RawEpisode): AgentSegment[] {
  const segments: AgentSegment[] = [];
  for (const call of episode.model_calls) {
    const last = segments[segments.length - 1];
    if (last && last.agent_id === call.agent_id) {
      last.model_calls.push(call);
    } else {
      segments.push({ agent_id: call.agent_id, model_calls: [call], tool_calls: [] });
    }
    for (const content of call.output_contents.filter((item) => item["type"] === "function_call")) {
      const name = String(content["name"] ?? "");
      const match = episode.tool_calls.find(
        (toolCall) =>
          toolCall.agent_id === call.agent_id &&
          toolCall.tool_name === name &&
          !segments.some((segment) => segment.tool_calls.includes(toolCall))
      );
      if (match) segments[segments.length - 1]!.tool_calls.push(match);
    }
  }
  return segments;
}

async function convertEpisode(episode: RawEpisode, storeDir: string): Promise<string> {
  const resolved = resolveExternalExecution(episode);
  const recordedModeLabel = resolved.canonical_mode === "offline_fixture" ? "offline" : resolved.canonical_mode;
  const runId = `run_ext_${episode.episode_id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  const session = new CaptureSession({
    projectId: "external-microsoft-agent-framework",
    projectName: "Microsoft Agent Framework (H2-C adapted sequential routing)",
    workflowId: "customer_support_handoff_h2c",
    summary: `H2-C ${episode.condition} ${episode.fault_mechanism ?? ""}`.trim(),
    runId,
    agentId: episode.agents_registered[0]?.id ?? "order_agent",
    strict: true,
  });

  session.captureState(
    {
      external_framework: "microsoft/agent-framework",
      architecture: "adapted_microsoft_agent_framework_deterministic_routing",
      registered_agents: episode.agents_registered.map((agent) => agent.id),
      execution_mode: recordedModeLabel,
      provider_http_completed: resolved.provider_http_completed,
    },
    { type: "INITIAL_STATE", scope: "workflow" }
  );

  const segments = segmentByAgent(episode);
  const observedRecordIds: string[] = [];
  const capturedToolCallIdsByAgent = new Map<string, string[]>();
  let previousStepId: string | undefined;
  const assertionCounterByAgent = new Map<string, number>();
  let orderStepId: string | undefined;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    let currentStepId = "";
    await session.step(
      `h2c:${segment.agent_id}:${index}`,
      "model_call",
      async (stepId) => {
        currentStepId = stepId;
        if (segment.agent_id === "order_agent") orderStepId = stepId;
        for (const modelCall of segment.model_calls) {
          const usage = modelCaptureUsage(modelCall, resolved);
          await session.captureModel({
            stepId,
            provider: modelCall.provider,
            model: modelCall.model,
            prompt: JSON.stringify(modelCall.input_messages),
            response: {
              output_text: modelCall.output_text,
              output_contents: modelCall.output_contents,
              decision: modelCall.decision_metadata?.decision ?? "live_model_response",
            },
            ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
            ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
            durationMs: Math.max(1, Math.round(modelCall.duration_ms)),
            finishReason: "stop",
            startedAt: modelCall.started_at,
            metadata: {
              execution_mode: recordedModeLabel,
              transport_label: episode.transport_label,
              provider_http_completed: resolved.canonical_mode === "live_llm" && modelCall.provider_http_completed === true,
              usage_status: usage.usage_status,
              agent_id: segment.agent_id,
              maf_response_id: modelCall.response_id,
              http_status_code: modelCall.http?.status_code ?? null,
            },
          });
        }
        for (const toolCall of segment.tool_calls) {
          const unwrapped = unwrapToolResult(toolCall.result);
          const captured = await session.captureTool({
            stepId,
            toolName: toolCall.tool_name,
            arguments: toolCall.arguments,
            output: toolCall.is_handoff_tool
              ? { handoff_short_circuit: true, target: toolCall.tool_name.replace(/^handoff_to_/, "") }
              : { result: unwrapped },
            startedAt: toolCall.started_at,
            completedAt: toolCall.completed_at,
            durationMs: Math.max(1, Math.round(toolCall.duration_ms)),
            declaredPermissionClass:
              toolCall.tool_name === "process_refund" || toolCall.tool_name === "process_return"
                ? "external_side_effect"
                : "read_only",
          });
          const toolCallId = captured?.toolInvocation.tool_call_id;
          if (toolCallId) {
            const list = capturedToolCallIdsByAgent.get(segment.agent_id) ?? [];
            list.push(toolCallId);
            capturedToolCallIdsByAgent.set(segment.agent_id, list);
          }
          if (!toolCall.is_handoff_tool && unwrapped.trim()) {
            const obsName = `OBS-${toolCall.tool_name}-${observedRecordIds.length}`;
            session.recordArtifact({
              stepId,
              name: obsName,
              type: "incident_record/system_log",
              sizeBytes: Buffer.byteLength(unwrapped, "utf8"),
              metadata: {
                kind: "system_log",
                body: unwrapped,
                source_tool: toolCall.tool_name,
                timestamp: toolCall.completed_at,
              },
            });
            observedRecordIds.push(obsName);
          }
        }
        const terminal = segment.model_calls[segment.model_calls.length - 1];
        const assertionClaim =
          terminal?.decision_metadata?.assertion_claim ??
          (segment.agent_id === "order_agent" ? episode.controller_handoff.producer_text : terminal?.output_text);
        if (assertionClaim && observedRecordIds.length > 0 && /\bORD-8841\b/.test(assertionClaim)) {
          const primaryStatusRef = observedRecordIds[0]!;
          const agentToolIds = capturedToolCallIdsByAgent.get(segment.agent_id) ?? [];
          const refs = [primaryStatusRef, ...agentToolIds];
          const assertIdx = assertionCounterByAgent.get(segment.agent_id) ?? 0;
          assertionCounterByAgent.set(segment.agent_id, assertIdx + 1);
          session.recordVerification({
            event_id: `vevt_${runId}_${segment.agent_id}_assert_${assertIdx}`,
            event_type: "verification.passed",
            target_type: "assertion",
            target_id: `${segment.agent_id}:assertion:${assertIdx}`,
            status: "PASSED",
            actor: segment.agent_id,
            origin: "agent_asserted",
            authority: "asserted",
            evidence_refs: refs,
            artifact_refs: [],
            step_id: stepId,
            details: sanitizeCanonicalRecord(
              {
                claim: assertionClaim,
                confidence: "high",
                assertion_index: assertIdx,
                capture_status: "captured",
                evidence_ref_count: refs.length,
              },
              session.getCapturePolicy()
            ),
          });
        }
        const producerText =
          segment.agent_id === "order_agent"
            ? episode.controller_handoff.producer_text
            : terminal?.output_text ?? "";
        session.captureState(
          {
            agent_id: segment.agent_id,
            output: { message: producerText },
            delivered_assertions:
              observedRecordIds.length > 0 && /\bORD-8841\b/.test(producerText)
                ? [{ claim: producerText, evidence_refs: [observedRecordIds[0]!] }]
                : [],
            delivered_tool_requests: segment.tool_calls.map((toolCall) => toolCall.tool_name),
          },
          { stepId, scope: "workflow" }
        );
      },
      { agentId: segment.agent_id, parentStepId: previousStepId }
    );
    previousStepId = currentStepId;
  }

  const proof = proveConsumption(episode.model_calls, episode.controller_handoff);
  const deliveredText = episode.controller_handoff.delivered_text;
  const primaryRef = observedRecordIds[0];
  const handoffEvidenceRefs = [
    ...(primaryRef ? [primaryRef] : []),
    ...(capturedToolCallIdsByAgent.get("order_agent") ?? []),
  ];
  const handoffAssertions =
    primaryRef && /\bORD-8841\b/.test(deliveredText)
      ? [{ claim: deliveredText, evidence_refs: [primaryRef] }]
      : [];
  session.recordHandoff({
    fromAgentId: "order_agent",
    toAgentId: proof.label === "consumed" ? "triage_agent" : "unconsumed_handoff",
    fromStepId: orderStepId,
    parentEventId: orderStepId,
    payloadSummary: deliveredText,
    payload: {
      from_role: "order_agent",
      output: { message: deliveredText },
      assertions: handoffAssertions,
    },
    artifactRefs: [],
    evidenceRefs: handoffEvidenceRefs,
    metadata: {
      controller_mutated: episode.controller_handoff.controller_mutated,
      receiving_agent_turn_observed: proof.label === "consumed",
      consumption_label: proof.label,
      routing: "deterministic_h2c_adapter",
    },
  });

  session.setOutcome({
    status: "SUCCESS",
    verification_status: "NOT_RUN",
    summary: `H2-C ${episode.episode_id} ${episode.condition}`,
  });
  const artifact = await session.finishRun({
    status: "completed",
    summary: `h2c:${episode.episode_id} mode=${recordedModeLabel}`,
  });

  let plan: InjectionPlan = NO_INJECTION;
  const injectionRecords: InjectionRecord[] = [];
  if (episode.controller_handoff.controller_mutated) {
    plan = {
      enabled: true,
      type: "modified_handoff",
      target_agent_id: "order_agent",
      target_boundary: "handoff_payload",
      expected_observable_violation:
        episode.fault_mechanism === "factual_contradiction"
          ? "handoff_contradicts_check_order_status_observation"
          : episode.fault_mechanism === "evidence_omission"
            ? "handoff_cites_missing_observation"
            : "handoff_cites_foreign_run_observation",
      config: {},
    };
    injectionRecords.push({
      injection_id: `inj_${runId}_handoff_0`,
      scenario_id: "customer_support_handoff_h2c",
      run_id: runId,
      type: "modified_handoff",
      target_boundary: "handoff_payload",
      target_agent_id: "order_agent",
      actual_modification: {
        original: episode.controller_handoff.producer_text,
        injected: episode.controller_handoff.delivered_text,
      },
      expected_observable_violation: String(plan.expected_observable_violation),
      config: { fault_mechanism: episode.fault_mechanism ?? "unknown" },
      reproducibility: {
        seed: episode.episode_id,
        scenario_id: "customer_support_handoff_h2c",
        plan_digest: "h2c-v1",
      },
    });
  }

  const oracleLabels: OracleClaimLabel[] = [];
  for (const event of (artifact.evidence?.verification_events ?? []).filter((item) => item.origin === "agent_asserted")) {
    const claimText = String(event.details?.["claim"] ?? "");
    const judged = judgeH2CClaim({ claimText, eventKind: "assertion" });
    oracleLabels.push({
      claim_id: event.target_id ?? `${event.actor}:assertion:0`,
      agent_id: event.actor ?? "unknown",
      event_kind: "assertion",
      event_id: event.event_id,
      label: judged.label,
      defect_class: judged.defect,
      originating_agent_id: event.actor ?? "unknown",
      responsible_agent_id: event.actor ?? "unknown",
      event_or_handoff_id: event.event_id,
      justification: judged.justification,
    });
  }
  for (const handoff of artifact.handoffs ?? []) {
    const judged = judgeH2CClaim({
      claimText: handoff.payload_summary ?? "",
      faultMechanism: episode.fault_mechanism,
      eventKind: "handoff",
    });
    oracleLabels.push({
      claim_id: `handoff:${handoff.handoff_id}`,
      agent_id: handoff.from_agent_id ?? "unknown",
      event_kind: "handoff",
      handoff_id: handoff.handoff_id,
      label: judged.label,
      defect_class: judged.defect,
      originating_agent_id: handoff.from_agent_id ?? "unknown",
      responsible_agent_id: judged.defect === "payload_tamper" ? "order_agent" : (handoff.from_agent_id ?? "unknown"),
      event_or_handoff_id: handoff.handoff_id,
      justification: judged.justification,
    });
  }

  const observability = assessObservability({ artifact, plan, injections: injectionRecords });
  const groundTruth = createGroundTruth({
    scenarioId: "customer_support_handoff_h2c",
    runId,
    domainId: "external-maf-h2c",
    seed: episode.episode_id,
    plan,
    caseId: episode.episode_id,
    injections: injectionRecords,
    expectedOutcomes:
      episode.condition === "intact_control"
        ? ["no_injected_violation"]
        : [String(plan.expected_observable_violation ?? "injected_handoff")],
    experimentalValidity: observability.validity,
    observability: observability.probes,
    oracleLabels,
    scoring: {
      architecture: "adapted_microsoft_agent_framework_deterministic_routing",
      consumption_label: proof.label,
    },
  });

  await persistExperimentalRun({
    outputDir: storeDir,
    artifact,
    groundTruth,
    summary: {
      run_id: runId,
      domain_id: "external-maf-h2c",
      scenario_id: "customer_support_handoff_h2c",
      case_id: episode.episode_id,
      content_variant: episode.condition,
      execution_mode: resolved.canonical_mode,
      requested_mode: resolved.requested_mode,
      ...(resolved.live_blocked ? { live_blocked: resolved.live_blocked } : {}),
      status: "completed",
      participating_agent_ids: artifact.identity.participating_agent_ids ?? [],
      commit_sha: commitSha(),
      cost_usd: resolved.actual_cost_usd,
      tokens: resolved.actual_tokens,
      duration_ms: Math.round(episode.duration_ms),
    },
  });
  return runId;
}

function monitorSlice(report: EvaluationReport) {
  return {
    accuracy: report.classification.accuracy,
    contradiction_recall: report.classification.contradiction_recall,
    contradiction_precision: report.classification.contradiction_precision,
    abstention_rate: report.classification.abstention_rate,
    gold_claims: report.gold_claims,
  };
}

async function main(): Promise<void> {
  const rawPath = arg("--raw-observations");
  const storeDir = arg("--store-dir");
  const exportDir = arg("--export-dir");
  if (!rawPath || !storeDir || !exportDir) {
    throw new Error(
      "Usage: npx tsx research/h2c-live-error-propagation/scripts/run-h2c-evaluation.ts --raw-observations <path> --store-dir <dir> --export-dir <dir>"
    );
  }
  if (exportDir.replace(/\\/g, "/").includes("research/swarmguard-testbed/results/h2")) {
    throw new Error("Refusing to write H2-C evidence into the frozen H2 results directory.");
  }

  const rawPayload = JSON.parse(await readFile(rawPath, "utf8")) as RawPayload;
  await mkdir(storeDir, { recursive: true });
  await mkdir(exportDir, { recursive: true });
  process.env["REEPROV_STORE_DIR"] ??= join(storeDir, "canonical-runs");
  const detectorAccess = createDetectorAccess(storeDir);
  const episodeSummaries: Array<Record<string, unknown>> = [];

  for (const episode of rawPayload.episodes) {
    const resolved = resolveExternalExecution(episode);
    const publicMode = resolved.canonical_mode === "offline_fixture" ? "offline" : resolved.canonical_mode;
    const runId = await convertEpisode(episode, storeDir);
    const detectorEvidence = await detectorAccess.loadRun(runId);
    const leaks = findGroundTruthLeaks(detectorEvidence);
    if (leaks.length > 0) throw new Error(`Ground-truth leak in ${runId}: ${leaks.join(", ")}`);

    const pa: MonitorResult = runPerAgentMonitor(detectorEvidence.artifact, {
      caseId: episode.episode_id,
      domainId: "external-maf-h2c",
    });
    const pe: MonitorResult = runPooledEventMonitor(detectorEvidence.artifact, {
      caseId: episode.episode_id,
      domainId: "external-maf-h2c",
    });
    const { result: kpMonitor, findings: kpFindings } = runKarmaPoliceWithFindings(detectorEvidence, {
      caseId: episode.episode_id,
      domainId: "external-maf-h2c",
    });

    const artifactHash = await writeSanitizedJson(
      join(exportDir, `${episode.episode_id}.run-artifact.json`),
      detectorEvidence.artifact,
      `${episode.episode_id}.run-artifact.json`
    );
    const committedPredictions = {
      format: "reeprov.h2c.committed_predictions.v1",
      committed_at: new Date().toISOString(),
      frozen_detector_commit_sha: FROZEN_DETECTOR_COMMIT_SHA,
      episode_id: episode.episode_id,
      condition: episode.condition,
      fault_mechanism: episode.fault_mechanism ?? null,
      run_id: runId,
      execution_mode: publicMode,
      monitors: {
        [PER_AGENT_MONITOR_ID]: { version: PER_AGENT_MONITOR_VERSION, result: pa },
        [POOLED_EVENT_MONITOR_ID]: { version: POOLED_EVENT_MONITOR_VERSION, result: pe },
        [KARMA_POLICE_MONITOR_ID]: {
          version: KARMA_POLICE_MONITOR_VERSION,
          result: kpMonitor,
          provenance_findings: kpFindings,
        },
      },
    };
    const predHash = await writeSanitizedJson(
      join(exportDir, `${episode.episode_id}.predictions.json`),
      committedPredictions,
      `${episode.episode_id}.predictions.json`
    );

    const evaluatorGroundTruth = await loadEvaluatorRecord(join(storeDir, "evaluator", runId));
    const evalPa = evaluateMonitor({
      prediction: pa,
      groundTruth: evaluatorGroundTruth,
      domainId: "external-maf-h2c",
    });
    const evalPe = evaluateMonitor({
      prediction: pe,
      groundTruth: evaluatorGroundTruth,
      domainId: "external-maf-h2c",
    });
    const evalKp = evaluateMonitor({
      prediction: kpMonitor,
      groundTruth: evaluatorGroundTruth,
      domainId: "external-maf-h2c",
    });
    const evalHash = await writeSanitizedJson(
      join(exportDir, `${episode.episode_id}.evaluation.json`),
      {
        format: "reeprov.h2c.evaluation.v1",
        evaluation_protocol: EVALUATION_FORMAT,
        episode_id: episode.episode_id,
        condition: episode.condition,
        run_id: runId,
        committed_predictions_sha256: predHash,
        evaluations: {
          [PER_AGENT_MONITOR_ID]: evalPa,
          [POOLED_EVENT_MONITOR_ID]: evalPe,
          [KARMA_POLICE_MONITOR_ID]: evalKp,
        },
      },
      `${episode.episode_id}.evaluation.json`
    );

    const receiverCalls = episode.model_calls.filter((call) => call.agent_id === "triage_agent");
    const receiverText = receiverCalls.map((call) => call.output_text ?? "").join("\n");
    const receiverTools = episode.tool_calls
      .filter((call) => call.agent_id === "triage_agent")
      .map((call) => call.tool_name);
    const behavior = codeReceiverBehavior({
      deliveredText: episode.controller_handoff.delivered_text,
      receiverOutputText: receiverText,
      receiverToolNames: receiverTools,
      domainToolsExecuted: episode.downstream_outcome.domain_tools_executed,
      faultMechanism: episode.fault_mechanism ?? "none",
    });
    const proof = proveConsumption(episode.model_calls, episode.controller_handoff);

    episodeSummaries.push({
      episode_id: episode.episode_id,
      condition: episode.condition,
      fault_mechanism: episode.fault_mechanism ?? null,
      run_id: runId,
      execution_mode: publicMode,
      is_live_llm: resolved.is_live_llm,
      episode_valid: episode.episode_valid ?? null,
      consumption: proof,
      behavior,
      participating_agents: detectorEvidence.artifact.identity.participating_agent_ids,
      model_invocations_captured: (detectorEvidence.artifact.models ?? []).length,
      tool_invocations_captured: detectorEvidence.artifact.tools.length,
      handoffs_captured: (detectorEvidence.artifact.handoffs ?? []).length,
      downstream_outcome: episode.downstream_outcome,
      canonical_artifact_sha256: artifactHash,
      committed_predictions_sha256: predHash,
      evaluation_sha256: evalHash,
      monitor_outcomes: {
        [PER_AGENT_MONITOR_ID]: monitorSlice(evalPa),
        [POOLED_EVENT_MONITOR_ID]: monitorSlice(evalPe),
        [KARMA_POLICE_MONITOR_ID]: {
          ...monitorSlice(evalKp),
          provenance_anomalies_logged: kpFindings.findings
            .filter((finding) => finding.provenance_anomalies.some((item) => item !== "none"))
            .map((finding) => ({
              claim_id: finding.claim_id,
              originating_agent_id: finding.originating_agent_id,
              event_or_handoff_id: finding.event_or_handoff_id,
              provenance_anomalies: finding.provenance_anomalies,
              classification: finding.classification,
            })),
        },
      },
    });
  }

  const provenance = {
    format: "reeprov.h2c.evaluation_provenance.v1",
    generated_at: new Date().toISOString(),
    frozen_detector_commit_sha: FROZEN_DETECTOR_COMMIT_SHA,
    architecture: "adapted_microsoft_agent_framework_deterministic_routing",
    host: rawPayload.host ?? null,
    upstream: rawPayload.upstream,
    request_bounds: rawPayload.request_bounds ?? null,
    episodes: episodeSummaries,
  };
  const provenanceHash = await writeSanitizedJson(join(exportDir, "provenance.json"), provenance, "provenance.json");
  const hashLines = [
    ...episodeSummaries.flatMap((episode) => [
      `${episode["canonical_artifact_sha256"]}  ${episode["episode_id"]}.run-artifact.json`,
      `${episode["committed_predictions_sha256"]}  ${episode["episode_id"]}.predictions.json`,
      `${episode["evaluation_sha256"]}  ${episode["episode_id"]}.evaluation.json`,
    ]),
    `${provenanceHash}  provenance.json`,
  ];
  await writeFile(join(exportDir, "SHA256SUMS"), `${hashLines.join("\n")}\n`, "utf8");
  console.log(JSON.stringify(provenance, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
