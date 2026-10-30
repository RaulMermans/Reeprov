/**
 * Permissioned tool registry. Authorization is owned by the experimental
 * controller; agents may only request tools listed on their role.
 */

import type { SideEffectClass } from "../../../lib/core/contracts/replay";
import type { CaptureSession } from "../../../lib/core/capture/sdk";
import type { SharedExecutionState } from "./state";

export interface ToolContext {
  agentId: string;
  runId: string;
  stepId: string;
  session: CaptureSession;
  shared: SharedExecutionState;
  workspace: unknown;
}

export interface ToolSpec {
  name: string;
  description: string;
  permissionClass: SideEffectClass;
  allowedAgentIds: string[];
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

export class ToolDeniedError extends Error {
  constructor(readonly agentId: string, readonly toolName: string) {
    super(`Agent "${agentId}" is not permitted to invoke tool "${toolName}".`);
    this.name = "ToolDeniedError";
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolSpec>();

  register(spec: ToolSpec): void {
    this.tools.set(spec.name, spec);
  }

  get(name: string): ToolSpec | undefined {
    return this.tools.get(name);
  }

  listFor(agentId: string): ToolSpec[] {
    return [...this.tools.values()].filter((tool) => tool.allowedAgentIds.includes(agentId));
  }

  authorize(agentId: string, toolName: string): ToolSpec {
    const spec = this.tools.get(toolName);
    if (!spec || !spec.allowedAgentIds.includes(agentId)) {
      throw new ToolDeniedError(agentId, toolName);
    }
    return spec;
  }

  schemasFor(agentId: string): Array<{ name: string; description: string; permissionClass: string }> {
    return this.listFor(agentId).map((tool) => ({
      name: tool.name,
      description: tool.description,
      permissionClass: tool.permissionClass,
    }));
  }
}

export async function invokeAuthorizedTool(
  registry: ToolRegistry,
  agentId: string,
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<{ spec: ToolSpec; output: unknown; denied?: false } | { spec?: undefined; output?: undefined; denied: true; error: string }> {
  try {
    const spec = registry.authorize(agentId, toolName);
    ctx.session.recordSecurityEvent({
      agent_id: agentId,
      tool_id: toolName,
      permission_class: spec.permissionClass,
      event_type: "permission.checked",
      decision: "ALLOW",
      step_id: ctx.stepId,
    });
    const output = await spec.execute(args, ctx);
    return { spec, output };
  } catch (error) {
    if (error instanceof ToolDeniedError) {
      ctx.session.recordSecurityEvent({
        agent_id: agentId,
        tool_id: toolName,
        event_type: "permission.checked",
        decision: "DENY",
        reason_code: "tool_not_permitted",
        step_id: ctx.stepId,
      });
      return { denied: true, error: error.message };
    }
    throw error;
  }
}
