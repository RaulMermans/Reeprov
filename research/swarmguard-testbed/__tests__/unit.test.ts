import { describe, expect, it } from "vitest";
import {
  agentRoleSchema,
  agentTurnSchema,
  budgetSchema,
  injectionPlanSchema,
  scenarioSchema,
} from "../src/contracts";
import { RunBudget } from "../src/budget";
import { applyHandoffInjection, applyIncorrectAssertion, applySkippedValidation, isControl } from "../src/injection";
import { assertIsolated, createGroundTruth, findGroundTruthLeaks } from "../src/isolation";
import { resolveExecutionMode } from "../src/modes";
import { createSharedState } from "../src/state";
import { ToolDeniedError, ToolRegistry } from "../src/tools";
import { miniDomain, turn, useTestStore } from "./helpers";
import { runExperiment } from "../src/harness";

describe("P2 unit: schemas", () => {
  it("validates agent, scenario, budget, injection, and turn schemas", () => {
    const agent = agentRoleSchema.parse({
      id: "coder",
      role: "coder",
      description: "Writes artifacts",
      allowed_tools: ["write_artifact"],
    });
    expect(agent.max_steps).toBe(4);
    const scenario = scenarioSchema.parse({
      id: "s1",
      domain_id: "d1",
      title: "t",
      task: "do it",
      seed: "1",
      agents: [agent, { ...agent, id: "reviewer", role: "reviewer" }],
      workflow: [{ agent_id: "coder" }, { agent_id: "reviewer" }],
    });
    expect(scenario.agents).toHaveLength(2);
    expect(budgetSchema.parse({}).max_cost_usd).toBe(0.15);
    expect(injectionPlanSchema.parse({ enabled: false }).enabled).toBe(false);
    expect(agentTurnSchema.parse({ summary: "ok" }).tool_requests).toEqual([]);
    expect(() => scenarioSchema.parse({ id: "x" })).toThrow();
  });
});

describe("P2 unit: tool permission enforcement", () => {
  it("allows only listed agents and denies others", async () => {
    const registry = new ToolRegistry();
    const domain = miniDomain();
    domain.registerTools(registry, { kind: "mini" });
    expect(registry.authorize("alpha", "echo").name).toBe("echo");
    expect(() => registry.authorize("alpha", "secret_write")).toThrow(ToolDeniedError);
    expect(() => registry.authorize("beta", "echo")).toThrow(ToolDeniedError);
    expect(registry.schemasFor("alpha").map((tool) => tool.name)).toEqual(["echo"]);
  });
});

describe("P2 unit: context separation", () => {
  const store = useTestStore("p2-unit-ctx");

  it("does not copy producer private context into the consumer prompt", async () => {
    const result = await runExperiment(miniDomain(), {
      mode: "mocked",
      persist: true,
      outputDir: store.outputDir(),
      mockTurns: {
        alpha: turn({
          summary: "alpha done",
          assertions: [{ claim: "produced", evidence_refs: [] }],
          tool_requests: [{ name: "echo", arguments: { n: 1 } }],
          output: { secret_note: "alpha-private-marker" },
        }),
        beta: turn({
          summary: "beta done",
          output: { ok: true },
        }),
      },
    });
    const betaModel = result.artifact.models.find((model) => model.agent_id === "beta");
    const prompt = JSON.stringify(betaModel);
    expect(prompt).not.toContain("Mini system for alpha");
    expect(result.artifact.models.find((model) => model.agent_id === "alpha")).toBeTruthy();
    expect(betaModel?.agent_id).toBe("beta");
  });
});

describe("P2 unit: execution budget limits", () => {
  const store = useTestStore("p2-unit-budget");

  it("stops additional model calls when the call budget is exhausted", async () => {
    const result = await runExperiment(miniDomain(), {
      mode: "mocked",
      persist: true,
      outputDir: store.outputDir(),
      budget: { max_model_calls: 1, max_cost_usd: 10, max_tokens: 100000 },
      mockTurns: {
        alpha: turn({ summary: "alpha" }),
        beta: turn({ summary: "beta" }),
      },
    });
    expect(result.status === "budget_exceeded" || result.errors.some((error) => error.code === "budget_exceeded")).toBe(
      true
    );
    expect(result.artifact.models.length).toBe(1);
  });

  it("RunBudget reports timeout and cost exhaustion", () => {
    const budget = new RunBudget({
      max_cost_usd: 0.01,
      max_tokens: 10,
      max_model_calls: 2,
      max_steps_per_agent: 1,
      agent_timeout_ms: 10,
      run_timeout_ms: 50,
      max_retries: 0,
      max_tokens_per_call: 10,
    });
    budget.recordCall({ costUsd: 0.02, tokens: 3 });
    expect(budget.check()?.code).toBe("budget_exceeded");
  });
});

describe("P2 unit: fault injection targeting", () => {
  it("control mode does not mutate turns", () => {
    const plan = injectionPlanSchema.parse({ enabled: false });
    expect(isControl(plan)).toBe(true);
    const original = turn({
      summary: "ok",
      assertions: [{ claim: "original", evidence_refs: ["a"] }],
    });
    const result = applyIncorrectAssertion(plan, original, {
      scenarioId: "s",
      runId: "r",
      seed: "1",
      agentId: "alpha",
      shared: createSharedState(),
    });
    expect(result.record).toBeUndefined();
    expect(result.turn.assertions[0]?.claim).toBe("original");
  });

  it("incorrect_assertion only mutates the targeted agent", () => {
    const plan = injectionPlanSchema.parse({
      enabled: true,
      type: "incorrect_assertion",
      target_agent_id: "alpha",
      config: { claim: "injected" },
    });
    const original = turn({
      summary: "ok",
      assertions: [{ claim: "original", evidence_refs: [] }],
    });
    const hit = applyIncorrectAssertion(plan, original, {
      scenarioId: "s",
      runId: "r",
      seed: "1",
      agentId: "alpha",
      shared: createSharedState(),
    });
    const miss = applyIncorrectAssertion(plan, original, {
      scenarioId: "s",
      runId: "r",
      seed: "1",
      agentId: "beta",
      shared: createSharedState(),
    });
    expect(hit.turn.assertions[0]?.claim).toBe("injected");
    expect(hit.record?.type).toBe("incorrect_assertion");
    expect(miss.record).toBeUndefined();
  });

  it("skipped_validation removes validation tool requests", () => {
    const plan = injectionPlanSchema.parse({
      enabled: true,
      type: "skipped_validation",
      target_agent_id: "coder",
    });
    const original = turn({
      summary: "ok",
      tool_requests: [
        { name: "write_artifact", arguments: {} },
        { name: "run_validation", arguments: {} },
      ],
    });
    const result = applySkippedValidation(plan, original, {
      scenarioId: "s",
      runId: "r",
      seed: "1",
      agentId: "coder",
      shared: createSharedState(),
    });
    expect(result.skipped).toBe(true);
    expect(result.turn.tool_requests.map((request) => request.name)).toEqual(["write_artifact"]);
  });

  it("handoff injections cover missing, stale, cross-run, and modified payloads", () => {
    const shared = createSharedState();
    shared.previousArtifactId = "art_old";
    shared.currentArtifactId = "art_new";
    const payload = {
      summary: "handoff",
      artifactRefs: ["art_new"],
      evidenceRefs: ["ev1"],
      body: { severity: "high" },
    };
    const ctx = { scenarioId: "s", runId: "r", seed: "1", agentId: "alpha", shared };

    const missing = applyHandoffInjection(
      injectionPlanSchema.parse({ enabled: true, type: "missing_evidence" }),
      payload,
      ctx
    );
    expect(missing.payload.evidenceRefs).toEqual([]);

    const stale = applyHandoffInjection(
      injectionPlanSchema.parse({ enabled: true, type: "stale_evidence" }),
      payload,
      ctx
    );
    expect(stale.payload.artifactRefs).toEqual(["art_old"]);

    const cross = applyHandoffInjection(
      injectionPlanSchema.parse({
        enabled: true,
        type: "cross_run_evidence",
        config: { foreign_run_id: "run_other" },
      }),
      payload,
      ctx
    );
    expect(cross.payload.evidenceRefs.some((ref) => ref.startsWith("run_other:"))).toBe(true);

    const modified = applyHandoffInjection(
      injectionPlanSchema.parse({
        enabled: true,
        type: "modified_handoff",
        config: { field: "severity", value: "low" },
      }),
      payload,
      ctx
    );
    expect(modified.payload.body["severity"]).toBe("low");
  });
});

describe("P2 unit: ground-truth isolation", () => {
  it("keeps evaluator-only fields out of detector-visible objects", () => {
    const gt = createGroundTruth({
      scenarioId: "s",
      runId: "r",
      domainId: "mini",
      seed: "seed-1",
      plan: { enabled: true, type: "incorrect_assertion", config: {} },
      injections: [],
    });
    expect(gt.control).toBe(false);
    expect(findGroundTruthLeaks({ summary: "ok", agent_id: "alpha" })).toEqual([]);
    expect(assertIsolated({ injection_type: "incorrect_assertion" }).isolated).toBe(false);
    expect(assertIsolated(gt).isolated).toBe(false);
  });
});

describe("P2 unit: event and artifact correlation", () => {
  const store = useTestStore("p2-unit-corr");

  it("links model, tool, handoff, and parent step identities", async () => {
    const result = await runExperiment(miniDomain(), {
      mode: "mocked",
      persist: true,
      outputDir: store.outputDir(),
      mockTurns: {
        alpha: turn({
          summary: "alpha",
          tool_requests: [{ name: "echo", arguments: { x: 1 } }],
        }),
        beta: turn({ summary: "beta" }),
      },
    });
    const alphaStep = result.artifact.trajectory.find((step) => step.agent_id === "alpha" && step.step_type === "model_call");
    const betaStep = result.artifact.trajectory.find((step) => step.agent_id === "beta");
    expect(alphaStep?.model_invocation_ids.length).toBeGreaterThan(0);
    expect(alphaStep?.tool_invocation_ids.length).toBeGreaterThan(0);
    expect(betaStep?.parent_step_id).toBe(alphaStep?.step_id);
    const handoff = result.artifact.handoffs?.[0];
    expect(handoff?.from_agent_id).toBe("alpha");
    expect(handoff?.to_agent_id).toBe("beta");
    expect(handoff?.from_step_id).toBe(alphaStep?.step_id);
    expect(result.artifact.tools[0]?.agent_id).toBe("alpha");
    expect(result.artifact.models[0]?.agent_id).toBe("alpha");
  });
});

describe("P2 unit: live mode is never inferred from credentials", () => {
  it("keeps offline_fixture even when provider keys are present", () => {
    const resolved = resolveExecutionMode("offline_fixture", {
      OPENAI_API_KEY: "sk-not-a-real-key",
    } as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe("offline_fixture");
    expect(resolved.credentials_present).toBe(true);
  });

  it("blocks live_llm when credentials are missing instead of fabricating a provider call", () => {
    const resolved = resolveExecutionMode("live_llm", {} as NodeJS.ProcessEnv);
    expect(resolved.requested).toBe("live_llm");
    expect(resolved.mode).toBe("offline_fixture");
    expect(resolved.live_blocked).toMatch(/blocked/i);
  });
});
