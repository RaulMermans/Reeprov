import type { CaptureSession } from "../../../lib/core/capture/sdk";
import type { AgentRole, Scenario } from "./contracts";
import type { AgentPrivateContext, SharedExecutionState } from "./state";
import type { ToolRegistry } from "./tools";

export interface DomainWorkspace {
  kind: string;
  rootDir?: string;
  close?: () => Promise<void>;
}

export interface DomainModule {
  id: string;
  title: string;
  buildScenario(seed?: string): Scenario;
  createWorkspace(): Promise<DomainWorkspace>;
  registerTools(registry: ToolRegistry, workspace: DomainWorkspace): void;
  seedEvidence?(
    session: CaptureSession,
    workspace: DomainWorkspace,
    shared: SharedExecutionState
  ): Promise<void> | void;
  systemPrompt(agent: AgentRole, scenario: Scenario): string;
  userPrompt(
    agent: AgentRole,
    scenario: Scenario,
    shared: SharedExecutionState,
    privateCtx: AgentPrivateContext
  ): string;
}
