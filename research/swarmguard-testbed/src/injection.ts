/**
 * Deterministic fault injection. Applied by the experimental controller, never
 * by agents, and never described in detector-visible prompts or metadata.
 */

import { createHash } from "node:crypto";
import type { AgentTurn, InjectionPlan } from "./contracts";
import type { InjectionRecord } from "./isolation";
import type { SharedExecutionState } from "./state";

export function planDigest(plan: InjectionPlan): string {
  const payload = JSON.stringify({
    enabled: plan.enabled,
    type: plan.type ?? null,
    target_agent_id: plan.target_agent_id ?? null,
    target_boundary: plan.target_boundary ?? null,
    config: plan.config,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function isControl(plan: InjectionPlan): boolean {
  return !plan.enabled || !plan.type;
}

function matchesAgent(plan: InjectionPlan, agentId: string): boolean {
  return !plan.target_agent_id || plan.target_agent_id === agentId;
}

export interface InjectionContext {
  scenarioId: string;
  runId: string;
  seed: string;
  agentId: string;
  shared: SharedExecutionState;
}

export function applyIncorrectAssertion(
  plan: InjectionPlan,
  turn: AgentTurn,
  ctx: InjectionContext
): { turn: AgentTurn; record?: InjectionRecord } {
  if (isControl(plan) || plan.type !== "incorrect_assertion") return { turn };
  if (!matchesAgent(plan, ctx.agentId)) return { turn };
  if (plan.target_boundary && plan.target_boundary !== "agent_output") return { turn };
  if (turn.assertions.length === 0) return { turn };

  const mutated = structuredClone(turn);
  const original = mutated.assertions[0]!.claim;
  const replacement =
    typeof plan.config["claim"] === "string"
      ? plan.config["claim"]
      : "Validation succeeded for all gold cases.";
  mutated.assertions[0]!.claim = replacement;
  return {
    turn: mutated,
    record: buildRecord(plan, ctx, {
      original_claim: original,
      injected_claim: replacement,
    }),
  };
}

export function applySkippedValidation(
  plan: InjectionPlan,
  turn: AgentTurn,
  ctx: InjectionContext
): { turn: AgentTurn; skipped: boolean; record?: InjectionRecord } {
  if (isControl(plan) || plan.type !== "skipped_validation") {
    return { turn, skipped: false };
  }
  if (!matchesAgent(plan, ctx.agentId)) return { turn, skipped: false };
  const mutated = structuredClone(turn);
  const removed = mutated.tool_requests.filter((request) => isValidationTool(request.name));
  mutated.tool_requests = mutated.tool_requests.filter((request) => !isValidationTool(request.name));
  if (removed.length === 0) return { turn, skipped: false };
  return {
    turn: mutated,
    skipped: true,
    record: buildRecord(plan, ctx, {
      skipped_tools: removed.map((request) => request.name),
    }),
  };
}

export function applyHandoffInjection(
  plan: InjectionPlan,
  payload: {
    summary: string;
    artifactRefs: string[];
    evidenceRefs: string[];
    body: Record<string, unknown>;
  },
  ctx: InjectionContext
): { payload: typeof payload; record?: InjectionRecord } {
  if (isControl(plan) || !matchesAgent(plan, ctx.agentId)) return { payload };

  if (plan.type === "missing_evidence") {
    const original = [...payload.evidenceRefs];
    return {
      payload: { ...payload, evidenceRefs: [] },
      record: buildRecord(plan, ctx, { stripped_evidence_refs: original }),
    };
  }

  if (plan.type === "stale_evidence") {
    const stale = ctx.shared.previousArtifactId;
    if (!stale) return { payload };
    const original = [...payload.artifactRefs];
    return {
      payload: {
        ...payload,
        artifactRefs: [stale],
        evidenceRefs: payload.evidenceRefs,
      },
      record: buildRecord(plan, ctx, {
        original_artifact_refs: original,
        injected_artifact_ref: stale,
      }),
    };
  }

  if (plan.type === "cross_run_evidence") {
    const foreignRun =
      typeof plan.config["foreign_run_id"] === "string"
        ? plan.config["foreign_run_id"]
        : "run_foreign_control_0001";
    const foreignRef = `${foreignRun}:art_foreign_1`;
    return {
      payload: {
        ...payload,
        evidenceRefs: [...payload.evidenceRefs, foreignRef],
      },
      record: buildRecord(plan, ctx, { injected_ref: foreignRef }),
    };
  }

  if (plan.type === "modified_handoff") {
    const field = typeof plan.config["field"] === "string" ? plan.config["field"] : "severity";
    const value = plan.config["value"] ?? "low";
    const original = payload.body[field];
    const body = { ...payload.body, [field]: value };
    return {
      payload: {
        ...payload,
        body,
        summary: payload.summary,
      },
      record: buildRecord(plan, ctx, {
        field,
        original,
        injected: value,
      }),
    };
  }

  return { payload };
}

export function isValidationTool(name: string): boolean {
  return name === "run_validation" || name.endsWith("_validation") || name === "validate_findings";
}

function buildRecord(
  plan: InjectionPlan,
  ctx: InjectionContext,
  actual: Record<string, unknown>
): InjectionRecord {
  const type = plan.type!;
  const boundary = plan.target_boundary ?? defaultBoundary(type);
  return {
    injection_id: `inj_${ctx.runId}_${type}`,
    scenario_id: ctx.scenarioId,
    run_id: ctx.runId,
    type,
    target_boundary: boundary,
    target_agent_id: ctx.agentId,
    expected_observable_violation:
      plan.expected_observable_violation ?? defaultExpectedViolation(type),
    ground_truth_agent_id: ctx.agentId,
    actual_modification: actual,
    config: plan.config,
    reproducibility: {
      seed: ctx.seed,
      scenario_id: ctx.scenarioId,
      plan_digest: planDigest(plan),
    },
  };
}

function defaultBoundary(type: NonNullable<InjectionPlan["type"]>) {
  switch (type) {
    case "incorrect_assertion":
      return "agent_output" as const;
    case "missing_evidence":
    case "stale_evidence":
    case "cross_run_evidence":
      return "evidence_refs" as const;
    case "modified_handoff":
      return "handoff_payload" as const;
    case "skipped_validation":
      return "validation_step" as const;
  }
}

function defaultExpectedViolation(type: NonNullable<InjectionPlan["type"]>): string {
  switch (type) {
    case "incorrect_assertion":
      return "Agent assertion does not match observed tool or artifact evidence.";
    case "missing_evidence":
      return "Handoff or assertion cites no resolving evidence.";
    case "stale_evidence":
      return "Evidence refers to an earlier artifact version than the current workspace head.";
    case "cross_run_evidence":
      return "Evidence reference points at another run.";
    case "modified_handoff":
      return "Handoff payload diverges from the producing agent's recorded output.";
    case "skipped_validation":
      return "Required validation tool was not executed.";
  }
}
