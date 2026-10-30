import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { InMemoryContentStore, setContentStore } from "../../../lib/core/capture/contentStore";
import { agentTurnSchema, scenarioSchema, type AgentTurn, type Scenario } from "../src/contracts";
import type { DomainModule, DomainWorkspace } from "../src/domain";
import type { ToolRegistry } from "../src/tools";
import { sharedViewForAgent, type SharedExecutionState } from "../src/state";

export function turn(partial: Partial<AgentTurn> & Pick<AgentTurn, "summary">): AgentTurn {
  return agentTurnSchema.parse({
    assertions: [],
    tool_requests: [],
    output: {},
    ready_for_handoff: true,
    ...partial,
  });
}

export function miniDomain(options?: {
  tools?: (registry: ToolRegistry, workspace: DomainWorkspace) => void;
  agents?: Scenario["agents"];
  workflow?: Scenario["workflow"];
  failingTool?: boolean;
}): DomainModule {
  const agents = options?.agents ?? [
    {
      id: "alpha",
      role: "producer",
      description: "Produces a finding.",
      allowed_tools: ["echo"],
      max_steps: 2,
    },
    {
      id: "beta",
      role: "consumer",
      description: "Consumes a handoff.",
      allowed_tools: [],
      max_steps: 2,
    },
  ];
  return {
    id: "mini",
    title: "Mini",
    buildScenario(seed = "mini"): Scenario {
      return scenarioSchema.parse({
        id: "mini-v1",
        domain_id: "mini",
        title: "Mini collaboration",
        seed,
        task: "Produce and consume a handoff.",
        agents,
        workflow: options?.workflow ?? agents.map((agent) => ({ agent_id: agent.id })),
      });
    },
    async createWorkspace() {
      return { kind: "mini" };
    },
    registerTools(registry, workspace) {
      if (options?.tools) {
        options.tools(registry, workspace);
        return;
      }
      registry.register({
        name: "echo",
        description: "Echo arguments.",
        permissionClass: "read_only",
        allowedAgentIds: ["alpha"],
        execute: async (args) => {
          if (options?.failingTool) throw new Error("echo failed");
          return args;
        },
      });
      registry.register({
        name: "secret_write",
        description: "Denied to alpha.",
        permissionClass: "write_draft",
        allowedAgentIds: ["beta"],
        execute: async () => ({ ok: true }),
      });
    },
    systemPrompt: (agent) => `Mini system for ${agent.id}.`,
    userPrompt: (agent, scenario, shared) =>
      `${scenario.task}\nagent=${agent.id}\nshared=${JSON.stringify(sharedViewForAgent(shared))}`,
  };
}

export function useTestStore(prefix: string): { outputDir: () => string } {
  let storeDir = "";
  let outputDir = "";
  const origStore = process.env["REEPROV_STORE_DIR"];

  beforeEach(async () => {
    setContentStore(new InMemoryContentStore());
    storeDir = await mkdtemp(join(tmpdir(), `${prefix}-store-`));
    outputDir = await mkdtemp(join(tmpdir(), `${prefix}-out-`));
    process.env["REEPROV_STORE_DIR"] = storeDir;
  });

  afterEach(async () => {
    if (origStore) process.env["REEPROV_STORE_DIR"] = origStore;
    else delete process.env["REEPROV_STORE_DIR"];
    await rm(storeDir, { recursive: true, force: true }).catch(() => undefined);
    await rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
  });

  return { outputDir: () => outputDir };
}

export function inspectShared(shared: SharedExecutionState) {
  return sharedViewForAgent(shared);
}
