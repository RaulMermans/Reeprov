# Replay Host Adapter Contract

## 1. Motivation and Principles

Reeprov does not magically execute arbitrary black-box code from JSON files. A faithful reproduction requires:
1. The captured `RunArtifact` with replay-grade evidence.
2. The executable host application code (agent graph, workflow engine, or script).
3. A framework-neutral seam connecting recorded nondeterministic boundaries to the application's runtime dependencies.

The `ReplayHostAdapter` provides this seam:
- It mounts restored application state.
- It exposes wrapped dependency stubs (`callModel`, `callTool`, `callRetrieval`).
- It captures step lifecycle events (`onStepStart`, `onStepComplete`).
- It captures the final application output (`finalize`, `getFinalOutput`).

---

## 2. Interface Contract

```typescript
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
```

---

## 3. Reference Implementation (`ReferenceReplayHostAdapter`)

The `ReferenceReplayHostAdapter` implements the contract:
- Connects directly to `BoundaryResolver` and `DivergenceDetector`.
- Auto-extracts dependency identities (`anthropic:claude-3-5-sonnet`, `tool:get_customer_account`).
- Invokes `onBoundarySubstituted` callback to emit real-time telemetry events.
- Safely decodes payloads whether stored inline or within the content-addressed blob store.
- Allows default sequential replay of `source.trajectory` when no custom host function is provided (e.g. in the CLI).
