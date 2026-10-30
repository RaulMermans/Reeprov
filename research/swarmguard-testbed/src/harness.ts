/**
 * Universal multi-agent experimental controller.
 *
 * Owns scenario selection, agent order, handoff routing, tool authorization,
 * fault injection, run identifiers, ground-truth storage, and budgets.
 * LLM agents own interpretation, tool selection (when permitted), and
 * structured judgments. Reeprov owns capture, persistence, and export.
 */

import { CaptureSession } from "../../../lib/core/capture/sdk";
import type { CapturePolicy } from "../../../lib/core/capture/types";
import { exportRunEvidenceBundle } from "../../../lib/core/evidence/exportBundle";
import { sanitizeCanonicalRecord } from "../../../lib/core/capture/redaction";
import type { RunArtifact } from "../../../lib/core/contracts/runArtifact";
import type { AgentRole, AgentTurn, ExecutionError, ExecutionMode, ExecutionStatus, ExperimentBudget, InjectionPlan, Scenario } from "./contracts";
import { DEFAULT_BUDGET, NO_INJECTION, scenarioSchema } from "./contracts";
import { RunBudget } from "./budget";
import { applyHandoffInjection, applyIncorrectAssertion, applySkippedValidation, isControl, planDigest } from "./injection";
import { assertIsolated, createGroundTruth, type GroundTruthRecord, type InjectionRecord, type OracleClaimLabel } from "./isolation";
import { invokeModel, ModelInvocationError, type ChatMessage } from "./llm";
import { resolveExecutionMode } from "./modes";
import { persistExperimentalRun, type PersistedExperimentalRun } from "./persist";
import { createPrivateContext, createSharedState, resolveRefs, sharedViewForAgent, type SharedExecutionState } from "./state";
import { invokeAuthorizedTool, ToolRegistry, type ToolContext } from "./tools";
import type { DomainModule, DomainWorkspace } from "./domain";
import { assessObservability } from "./observability";
import { commitSha } from "./gitmeta";
import { bindOracleLabels, type OracleTemplate } from "./oracle";

export interface HarnessOptions {
  mode?: ExecutionMode | string;
  budget?: Partial<ExperimentBudget>;
  injection?: InjectionPlan;
  runId?: string;
  outputDir?: string;
  seed?: string;
  variant?: string;
  caseId?: string;
  mockTurns?: Record<string, AgentTurn>;
  persist?: boolean;
  strictCapture?: boolean;
  capturePolicy?: Partial<CapturePolicy>;
  oracleLabels?: OracleClaimLabel[];
  oracleTemplates?: OracleTemplate[];
}

export interface ExperimentalRunResult {
  run_id: string;
  domain_id: string;
  scenario_id: string;
  execution_mode: ExecutionMode;
  requested_mode: ExecutionMode;
  live_blocked?: string;
  status: ExecutionStatus;
  errors: ExecutionError[];
  artifact: RunArtifact;
  ground_truth: GroundTruthRecord;
  persisted?: PersistedExperimentalRun;
  participating_agent_ids: string[];
}

const JSON_CONTRACT = `Reply with a single JSON object using this schema:
{
  "summary": string,
  "assertions": [{ "claim": string, "evidence_refs": string[], "confidence"?: "low"|"medium"|"high" }],
  "tool_requests": [{ "name": string, "arguments": object }],
  "output": object,
  "ready_for_handoff": boolean
}
Cite evidence with symbolic refs when needed (artifact:current, artifact:v1, tool:<name>, record:<id>).
Do not include chain-of-thought, hidden reasoning, or experiment-administration fields.`;

export async function runExperiment(
  domain: DomainModule,
  options: HarnessOptions = {}
): Promise<ExperimentalRunResult> {
  const resolved = resolveExecutionMode(options.mode);
  if (resolved.requested === "live_llm" && resolved.mode !== "live_llm") {
    // Caller asked for live but credentials are missing. Do not silently claim live.
    // Offline still runs so the rest of the laboratory stays usable.
  }
  const mode = resolved.mode;
  const scenario = scenarioSchema.parse(domain.buildScenario(options.seed, options.variant));
  const budgetLimits = { ...DEFAULT_BUDGET, ...options.budget };
  const budget = new RunBudget(budgetLimits);
  const injection = options.injection ?? NO_INJECTION;
  const runId =
    options.runId ??
    `run_${domain.id}_${options.caseId ?? scenario.variant}_${scenario.seed}_${Date.now().toString(36)}`;
  const errors: ExecutionError[] = [];
  const injectionRecords: InjectionRecord[] = [];

  const workspace = await domain.createWorkspace(scenario);
  const registry = new ToolRegistry();
  domain.registerTools(registry, workspace);
  const shared = createSharedState();

  const session = new CaptureSession({
    projectId: `swarmguard-testbed-${domain.id}`,
    projectName: `SwarmGuard Testbed (${domain.title})`,
    workflowId: scenario.id,
    summary: scenario.title,
    runId,
    agentId: scenario.agents[0]?.id,
    strict: options.strictCapture ?? false,
    policy: options.capturePolicy,
  });

  try {
    session.captureState(
      { domain: domain.id, scenario: scenario.id, agent_count: scenario.agents.length },
      { type: "INITIAL_STATE", scope: "workflow" }
    );
    if (domain.seedEvidence) {
      await domain.seedEvidence(session, workspace, shared);
    }

    let previousStepId: string | undefined;
    let lastAgentId: string | undefined;
    let status: ExecutionStatus = "completed";

    for (const step of scenario.workflow) {
      const budgetError = budget.check("agent_start");
      if (budgetError) {
        errors.push(budgetError);
        status = budgetError.code === "timeout" ? "timeout" : "budget_exceeded";
        break;
      }
      const agent = scenario.agents.find((candidate) => candidate.id === step.agent_id);
      if (!agent) {
        errors.push({
          code: "internal",
          message: `Workflow references unknown agent "${step.agent_id}".`,
          retryable: false,
        });
        status = "failed";
        break;
      }

      const agentResult = await runAgentTurn({
        domain,
        scenario,
        agent,
        session,
        registry,
        workspace,
        shared,
        mode,
        mockTurn: options.mockTurns?.[agent.id],
        budget,
        budgetLimits,
        injection,
        injectionRecords,
        parentStepId: previousStepId,
      });
      previousStepId = agentResult.stepId;
      lastAgentId = agent.id;
      errors.push(...agentResult.errors);
      if (agentResult.fatal) {
        status = agentResult.status;
        break;
      }
      if (agentResult.errors.length > 0 && status === "completed") {
        status = "degraded";
      }

      const isLast = step === scenario.workflow[scenario.workflow.length - 1];
      if (!isLast && agentResult.turn?.ready_for_handoff !== false) {
        const next = scenario.workflow[scenario.workflow.indexOf(step) + 1];
        const nextAgentId = next?.agent_id;
        const rawPayload = {
          summary: agentResult.turn?.summary ?? `Handoff from ${agent.id}`,
          artifactRefs: shared.currentArtifactId ? [shared.currentArtifactId] : [],
          evidenceRefs: [
            ...(shared.currentArtifactId ? [shared.currentArtifactId] : []),
            ...shared.toolEvidence.filter((item) => item.agent_id === agent.id).map((item) => item.tool_call_id),
          ],
          body: {
            from_role: agent.role,
            output: agentResult.turn?.output ?? {},
            assertions: agentResult.turn?.assertions ?? [],
          },
        };
        const injected = applyHandoffInjection(injection, rawPayload, {
          scenarioId: scenario.id,
          runId,
          seed: scenario.seed,
          agentId: agent.id,
          shared,
        });
        if (injected.record) injectionRecords.push(injected.record);
        const resolvedArtifactRefs = resolveRefs(injected.payload.artifactRefs, shared);
        const resolvedEvidenceRefs = resolveRefs(injected.payload.evidenceRefs, shared);
        session.recordHandoff({
          fromAgentId: agent.id,
          toAgentId: nextAgentId,
          fromStepId: agentResult.stepId,
          parentEventId: agentResult.stepId,
          payloadSummary: injected.payload.summary,
          payload: injected.payload.body,
          artifactRefs: resolvedArtifactRefs,
          evidenceRefs: resolvedEvidenceRefs,
        });
        shared.handoffs.push({
          from_agent_id: agent.id,
          to_agent_id: nextAgentId,
          summary: injected.payload.summary,
          body: injected.payload.body,
          artifact_refs: resolvedArtifactRefs,
          evidence_refs: resolvedEvidenceRefs,
        });
      }
    }

    const outcomeStatus =
      status === "completed" && errors.length === 0
        ? "SUCCESS"
        : status === "partial" || errors.some((error) => error.code === "incomplete")
          ? "PARTIAL_SUCCESS"
          : status === "blocked"
            ? "BLOCKED"
            : "FAILURE";
    session.setOutcome({
      status: outcomeStatus,
      verification_status: "NOT_RUN",
      summary: `${scenario.title} (${mode})`,
    });

    const artifact = await session.finishRun({
      status:
        status === "completed" && errors.length === 0
          ? "completed"
          : status === "failed"
            ? "failed"
            : "degraded",
      summary: `${domain.id}:${scenario.id} mode=${mode}`,
      error: errors[0] ? { message: errors[0].message, code: errors[0].code } : undefined,
    });

    const observability = assessObservability({
      artifact,
      plan: injection,
      injections: injectionRecords,
    });
    const groundTruth = createGroundTruth({
      scenarioId: scenario.id,
      runId,
      domainId: domain.id,
      seed: scenario.seed,
      plan: injection,
      caseId: options.caseId,
      injections: injectionRecords,
      expectedOutcomes: isControl(injection)
        ? ["no_injected_violation"]
        : injectionRecords.map((record) => record.expected_observable_violation),
      experimentalValidity: observability.validity,
      observability: observability.probes,
      oracleLabels:
        options.oracleLabels ??
        (options.oracleTemplates ? bindOracleLabels(artifact, options.oracleTemplates) : []),
      scoring: {
        plan_digest: planDigest(injection),
        last_agent_id: lastAgentId,
        content_variant: scenario.variant,
      },
    });

    const isolation = assertIsolated(artifact);
    if (!isolation.isolated) {
      throw new Error(`Isolation violation: ${isolation.leaks.join("; ")}`);
    }
    assertIsolated(exportRunEvidenceBundle(artifact));

    let persisted: PersistedExperimentalRun | undefined;
    if (options.persist !== false && options.outputDir) {
      persisted = await persistExperimentalRun({
        outputDir: options.outputDir,
        artifact,
        groundTruth,
        summary: {
          run_id: runId,
          domain_id: domain.id,
          scenario_id: scenario.id,
          case_id: options.caseId,
          content_variant: scenario.variant,
          execution_mode: mode,
          requested_mode: resolved.requested,
          live_blocked: resolved.live_blocked,
          status,
          participating_agent_ids: artifact.identity.participating_agent_ids ?? [],
          commit_sha: commitSha(),
        },
      });
    }

    return {
      run_id: runId,
      domain_id: domain.id,
      scenario_id: scenario.id,
      execution_mode: mode,
      requested_mode: resolved.requested,
      live_blocked: resolved.live_blocked,
      status,
      errors,
      artifact,
      ground_truth: groundTruth,
      persisted,
      participating_agent_ids: artifact.identity.participating_agent_ids ?? [],
    };
  } finally {
    await workspace.close?.();
  }
}

async function runAgentTurn(input: {
  domain: DomainModule;
  scenario: Scenario;
  agent: AgentRole;
  session: CaptureSession;
  registry: ToolRegistry;
  workspace: DomainWorkspace;
  shared: SharedExecutionState;
  mode: ExecutionMode;
  mockTurn?: AgentTurn;
  budget: RunBudget;
  budgetLimits: ExperimentBudget;
  injection: InjectionPlan;
  injectionRecords: InjectionRecord[];
  parentStepId?: string;
}): Promise<{
  stepId: string;
  turn?: AgentTurn;
  errors: ExecutionError[];
  fatal: boolean;
  status: ExecutionStatus;
}> {
  const { agent, session, domain, scenario } = input;
  const privateCtx = createPrivateContext(agent.id, agent.role);
  const errors: ExecutionError[] = [];
  let stepId = "";

  const turn = await session.step(
    `${agent.role}:${agent.id}`,
    "model_call",
    async (id) => {
      stepId = id;
      const callError = input.budget.check("model_call");
      if (callError) {
        errors.push({ ...callError, agent_id: agent.id });
        return null;
      }

      const tools = input.registry.schemasFor(agent.id);
      const messages: ChatMessage[] = [
        { role: "system", content: buildSystemPrompt(domain, agent, scenario, tools) },
        { role: "user", content: domain.userPrompt(agent, scenario, input.shared, privateCtx) },
      ];
      privateCtx.working["last_shared_view"] = sharedViewForAgent(input.shared);

      const timeoutMs = Math.min(agent.timeout_ms, input.budget.remainingMs(), input.budgetLimits.agent_timeout_ms);
      try {
        const model = await invokeModel(
          {
            mode: input.mode,
            agentId: agent.id,
            domainId: domain.id,
            scenarioId: scenario.id,
            messages,
            maxTokens: input.budgetLimits.max_tokens_per_call,
            timeoutMs,
            mockTurn: input.mockTurn,
          },
          input.budgetLimits.max_retries
        );
        input.budget.recordCall({
          costUsd: model.cost_usd,
          tokens: model.total_tokens ?? (model.prompt_tokens ?? 0) + (model.completion_tokens ?? 0),
        });
        await session.captureModel({
          stepId: id,
          provider: model.provider,
          model: model.model,
          prompt: messages.map((message) => `${message.role}: ${message.content}`).join("\n"),
          response: model.turn,
          inputTokens: model.prompt_tokens,
          outputTokens: model.completion_tokens,
          costUsd: model.cost_usd,
          durationMs: model.duration_ms,
          finishReason: model.finish_reason,
          startedAt: new Date(Date.now() - model.duration_ms).toISOString(),
          metadata: {
            execution_mode: model.mode,
            provider_http_completed: model.provider_http_completed,
            attempts: model.attempts,
            agent_id: agent.id,
            agent_role: agent.role,
          },
        });

        let turn = model.turn;
        const assertionInj = applyIncorrectAssertion(input.injection, turn, {
          scenarioId: scenario.id,
          runId: session.runId,
          seed: scenario.seed,
          agentId: agent.id,
          shared: input.shared,
        });
        turn = assertionInj.turn;
        if (assertionInj.record) input.injectionRecords.push(assertionInj.record);

        const skipInj = applySkippedValidation(input.injection, turn, {
          scenarioId: scenario.id,
          runId: session.runId,
          seed: scenario.seed,
          agentId: agent.id,
          shared: input.shared,
        });
        turn = skipInj.turn;
        if (skipInj.record) input.injectionRecords.push(skipInj.record);

        for (const request of turn.tool_requests) {
          const ctx: ToolContext = {
            agentId: agent.id,
            runId: session.runId,
            stepId: id,
            session,
            shared: input.shared,
            workspace: input.workspace,
          };
          const startedAt = new Date().toISOString();
          const startMs = Date.now();
          try {
            const result = await invokeAuthorizedTool(
              input.registry,
              agent.id,
              request.name,
              request.arguments,
              ctx
            );
            if (result.denied) {
              errors.push({
                code: "tool_denied",
                message: result.error,
                agent_id: agent.id,
                retryable: false,
              });
              await session.captureTool({
                stepId: id,
                toolName: request.name,
                arguments: request.arguments,
                error: { message: result.error },
                startedAt,
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - startMs,
                declaredPermissionClass: "read_only",
              });
              continue;
            }
            const captured = await session.captureTool({
              stepId: id,
              toolName: request.name,
              arguments: request.arguments,
              output: result.output,
              startedAt,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - startMs,
              declaredPermissionClass: result.spec.permissionClass,
            });
            const toolCallId = captured?.toolInvocation.tool_call_id;
            if (toolCallId) {
              input.shared.toolEvidence.push({
                tool_call_id: toolCallId,
                tool_name: request.name,
                agent_id: agent.id,
                status: "completed",
                output: result.output,
              });
              input.shared.symbolic[`tool:${request.name}`] = toolCallId;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push({
              code: "tool_failed",
              message,
              agent_id: agent.id,
              retryable: false,
            });
            await session.captureTool({
              stepId: id,
              toolName: request.name,
              arguments: request.arguments,
              error: { message },
              startedAt,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - startMs,
            });
          }
        }

        turn.assertions.forEach((assertion, index) => {
          const refs = resolveRefs(assertion.evidence_refs, input.shared);
          const captureMode = session.getCapturePolicy().contentMode;
          const captureStatus =
            captureMode === "STRUCTURE_ONLY"
              ? "structure_only"
              : assertion.claim.trim().length === 0
                ? "incomplete"
                : "captured";
          const details =
            captureStatus === "captured"
              ? sanitizeCanonicalRecord(
                  {
                    claim: assertion.claim,
                    confidence: assertion.confidence,
                    assertion_index: index,
                    capture_status: captureStatus,
                    evidence_ref_count: refs.length,
                  },
                  session.getCapturePolicy()
                )
              : {
                  assertion_index: index,
                  capture_status: captureStatus,
                  evidence_ref_count: refs.length,
                };
          session.recordVerification({
            event_id: `vevt_${session.runId}_${agent.id}_assert_${index}`,
            event_type: "verification.passed",
            target_type: "assertion",
            target_id: `${agent.id}:assertion:${index}`,
            status: "PASSED",
            actor: agent.id,
            origin: "agent_asserted",
            authority: "asserted",
            evidence_refs: refs,
            artifact_refs: [],
            step_id: id,
            details,
          });
        });

        session.captureState(
          {
            agent_id: agent.id,
            output: turn.output,
            delivered_assertions: turn.assertions,
            delivered_tool_requests: turn.tool_requests.map((request) => request.name),
          },
          { stepId: id, scope: "workflow" }
        );
        privateCtx.working["turn"] = turn;
        return turn;
      } catch (error) {
        if (error instanceof ModelInvocationError) {
          errors.push({
            code: error.code,
            message: error.message,
            agent_id: agent.id,
            retryable: error.retryable,
          });
          await session.captureModel({
            stepId: id,
            provider: input.mode === "live_llm" ? "live" : input.mode,
            model: "uncompleted",
            prompt: "omitted",
            response: { error: error.code },
            error: { message: error.message, code: error.code },
            startedAt: new Date().toISOString(),
            metadata: {
              execution_mode: input.mode,
              provider_http_completed: false,
              agent_id: agent.id,
            },
          });
          return null;
        }
        throw error;
      }
    },
    { agentId: agent.id, nodeId: agent.role, parentStepId: input.parentStepId }
  );

  const fatal = errors.some((error) => error.code === "budget_exceeded" || error.code === "timeout");
  const status: ExecutionStatus = fatal
    ? errors.some((error) => error.code === "timeout")
      ? "timeout"
      : "budget_exceeded"
    : errors.length > 0
      ? "degraded"
      : "completed";
  return { stepId, turn: turn ?? undefined, errors, fatal, status };
}

function buildSystemPrompt(
  domain: DomainModule,
  agent: AgentRole,
  scenario: Scenario,
  tools: Array<{ name: string; description: string; permissionClass: string }>
): string {
  const toolLines =
    tools.length === 0
      ? "You have no tools."
      : `Permitted tools:\n${tools.map((tool) => `- ${tool.name} (${tool.permissionClass}): ${tool.description}`).join("\n")}`;
  return [
    `You are ${agent.id}, role: ${agent.role}.`,
    agent.description,
    `Domain: ${domain.title}. Task: ${scenario.task}`,
    domain.systemPrompt(agent, scenario),
    toolLines,
    JSON_CONTRACT,
  ].join("\n\n");
}
