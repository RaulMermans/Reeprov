/**
 * Replay host contract.
 *
 * An agent that wants Reeprov offline replay and checkpoint forks is written
 * against injected dependencies: every nondeterministic call (model, tool)
 * goes through `HostDependencies`. Live runs pass dependencies that execute
 * for real and record a boundary; the developer-side Reeprov runner passes
 * dependencies backed by recorded evidence. The agent's own step logic is
 * the same code in both cases — that is what replay re-executes.
 *
 * Rules for a host adapter:
 * - No network, filesystem, clock or randomness outside `deps`.
 * - `run` must be resumable from any step index `supportsResume` accepts,
 *   using only the provided state.
 * - State must be JSON-serializable.
 */

import type { ReeprovClient } from "./client.js";
import type { PermissionClass, ResumeAdapterIdentity } from "./types.js";

export interface HostModelRequest {
  provider: string;
  model: string;
  prompt?: string;
  messages?: unknown[];
  [key: string]: unknown;
}

export interface HostToolRequest {
  name: string;
  args: unknown;
  /** Declared effect of the tool. Anything other than read_only is never executed during replay or fork. */
  sideEffect?: PermissionClass;
}

export interface HostDependencies {
  callModel(request: HostModelRequest): Promise<unknown>;
  callTool(request: HostToolRequest): Promise<unknown>;
}

export interface HostHooks<TState> {
  onStepStart?(stepIndex: number, stepId: string): void | Promise<void>;
  /** Called after each step with the state the next step will see. */
  onStepComplete?(stepIndex: number, stepId: string, state: TState): void | Promise<void>;
}

export interface ResumePosition {
  resume_step_index: number;
  resume_step_id?: string;
}

export interface ReeprovHostAdapter<TInput = unknown, TState extends Record<string, unknown> = Record<string, unknown>, TOutput = unknown> {
  readonly identity: ResumeAdapterIdentity;
  /** Ordered host step ids. */
  readonly steps: readonly string[];
  initialState(input: TInput): TState;
  supportsResume(position: ResumePosition): boolean;
  run(params: {
    state: TState;
    fromStepIndex: number;
    deps: HostDependencies;
    hooks?: HostHooks<TState>;
  }): Promise<{ state: TState; output: TOutput }>;
}

/** Boundary identity shared by capture and replay. Do not change without a schema version bump. */
export function modelBoundaryIdentity(request: HostModelRequest): { name: string; dependencyIdentity: string } {
  const name = `${request.provider}/${request.model}`;
  return { name, dependencyIdentity: `model:${name}` };
}

export function toolBoundaryIdentity(request: HostToolRequest): { name: string; dependencyIdentity: string } {
  return { name: request.name, dependencyIdentity: `tool:${request.name}` };
}

export interface LiveDependencies {
  callModel(request: HostModelRequest): Promise<unknown>;
  callTool(request: HostToolRequest): Promise<unknown>;
}

/**
 * Live dependencies that execute for real and record each call as a keyed
 * boundary whose input is exactly the request object, so replay can verify
 * it by hash. `currentNode` labels each boundary with the host step (node_id).
 */
export function createCapturingDependencies(
  client: ReeprovClient,
  runId: string,
  live: LiveDependencies,
  options: { currentNode?: () => string | undefined } = {},
): HostDependencies {
  return {
    async callModel(request) {
      const startedAt = Date.now();
      const output = await live.callModel(request);
      await client.captureBoundary(runId, {
        boundaryType: "model_call",
        ...modelBoundaryIdentity(request),
        nodeId: options.currentNode?.(),
        durationMs: Date.now() - startedAt,
        input: request,
        output,
        declaredSideEffectClass: "read_only",
      });
      return output;
    },
    async callTool(request) {
      const startedAt = Date.now();
      let output: unknown;
      let error: { message: string } | undefined;
      try {
        output = await live.callTool(request);
      } catch (err) {
        error = { message: err instanceof Error ? err.message : String(err) };
      }
      await client.captureBoundary(runId, {
        boundaryType: "tool_call",
        ...toolBoundaryIdentity(request),
        nodeId: options.currentNode?.(),
        durationMs: Date.now() - startedAt,
        input: request.args,
        output,
        error,
        declaredSideEffectClass: request.sideEffect ?? "read_only",
      });
      if (error) throw new Error(error.message);
      return output;
    },
  };
}
