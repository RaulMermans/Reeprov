/**
 * Replay Host Adapter Contract & Reference Implementation.
 *
 * Framework-neutral seam between recorded boundary execution and the host application:
 * - Mounts restored state.
 * - Exposes replay-aware model, tool, and retrieval dependencies.
 * - Relays step lifecycle events.
 * - Captures final output.
 */

import { BoundaryResolver, type ResolveBoundaryResponse } from "./resolver";
import { DivergenceDetector } from "./divergenceDetector";

export interface ReplayHostDependencies {
  callModel: <TOutput = unknown>(input: {
    model: string;
    provider?: string;
    prompt: string;
    tools?: unknown[];
    [key: string]: unknown;
  }) => Promise<TOutput>;
  callTool: <TOutput = unknown>(input: {
    name: string;
    args: unknown;
    sideEffectIntent?: "substitute_recorded" | "execute_live";
  }) => Promise<TOutput>;
  callRetrieval: <TOutput = unknown>(input: {
    service: string;
    query: string;
    [key: string]: unknown;
  }) => Promise<TOutput>;
}

export interface ReplayHostAdapter<TState = Record<string, unknown>, TOutput = unknown> {
  initialize(initialState: TState): Promise<void>;
  getState(): TState;
  getDependencies(): ReplayHostDependencies;
  onStepStart(stepIndex: number, stepName: string): Promise<void>;
  onStepComplete(stepIndex: number, stepName: string, stateUpdate?: Partial<TState>): Promise<void>;
  finalize(output: TOutput): Promise<void>;
  getFinalOutput(): TOutput | undefined;
}

export interface ReferenceAdapterOptions {
  resolver: BoundaryResolver;
  divergenceDetector: DivergenceDetector;
  onBoundarySubstituted?: (res: ResolveBoundaryResponse) => void;
}

export class ReferenceReplayHostAdapter<TState extends Record<string, unknown> = Record<string, unknown>, TOutput = unknown>
  implements ReplayHostAdapter<TState, TOutput>
{
  private state: TState = {} as TState;
  private finalOutput: TOutput | undefined;
  private readonly resolver: BoundaryResolver;
  private readonly divergenceDetector: DivergenceDetector;
  private readonly onBoundarySubstituted?: (res: ResolveBoundaryResponse) => void;

  constructor(options: ReferenceAdapterOptions) {
    this.resolver = options.resolver;
    this.divergenceDetector = options.divergenceDetector;
    this.onBoundarySubstituted = options.onBoundarySubstituted;
  }

  async initialize(initialState: TState): Promise<void> {
    this.state = { ...initialState };
  }

  getState(): TState {
    return { ...this.state };
  }

  getDependencies(): ReplayHostDependencies {
    return {
      callModel: async <R = unknown>(input: {
        model: string;
        provider?: string;
        prompt: string;
        tools?: unknown[];
        [key: string]: unknown;
      }): Promise<R> => {
        const provider = input.provider ?? "anthropic";
        const dependencyIdentity = `${provider}:${input.model}`;
        const boundaryInput = {
          model: input.model,
          provider,
          prompt: input.prompt,
          tools: input.tools,
        };

        const res = await this.resolver.resolve({
          expectedType: "model_call",
          name: `${provider}/${input.model}`,
          dependencyIdentity,
          input: boundaryInput,
        });

        this.onBoundarySubstituted?.(res);
        return res.output as R;
      },

      callTool: async <R = unknown>(input: {
        name: string;
        args: unknown;
        sideEffectIntent?: "substitute_recorded" | "execute_live";
      }): Promise<R> => {
        const res = await this.resolver.resolve({
          expectedType: "tool_call",
          name: input.name,
          dependencyIdentity: `tool:${input.name}`,
          input: input.args,
          sideEffectIntent: input.sideEffectIntent ?? "substitute_recorded",
        });

        this.onBoundarySubstituted?.(res);
        return res.output as R;
      },

      callRetrieval: async <R = unknown>(input: {
        service: string;
        query: string;
        [key: string]: unknown;
      }): Promise<R> => {
        const res = await this.resolver.resolve({
          expectedType: "retrieval_call",
          name: `${input.service}:search`,
          dependencyIdentity: `retrieval:${input.service}`,
          input: { query: input.query },
        });

        this.onBoundarySubstituted?.(res);
        const outputAny = res.output as { results?: R } | R;
        if (outputAny && typeof outputAny === "object" && "results" in outputAny) {
          return outputAny.results as R;
        }
        return res.output as R;
      },
    };
  }

  async onStepStart(stepIndex: number, stepName: string): Promise<void> {
    // Relays step start; can be observed or hook into step metrics
  }

  async onStepComplete(stepIndex: number, stepName: string, stateUpdate?: Partial<TState>): Promise<void> {
    if (stateUpdate) {
      this.state = { ...this.state, ...stateUpdate };
    }
  }

  async finalize(output: TOutput): Promise<void> {
    this.finalOutput = output;
  }

  getFinalOutput(): TOutput | undefined {
    return this.finalOutput;
  }
}
