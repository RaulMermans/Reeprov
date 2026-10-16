# Framework Integration Strategy

## Current Status: Generic SDKs Work with Any Framework

Reeprov provides official client SDKs for TypeScript and Python, along with an open REST API:

- **TypeScript SDK:** [`@reeprov/client`](../../packages/client-typescript/README.md)
- **Python SDK:** [`reeprov-client`](../../packages/client-python/README.md)
- **Direct HTTP:** [`POST /api/traces/events`, `POST /api/traces/boundaries`](../trace_schema.md)

Because the client SDKs communicate over standard HTTP contracts and operate independently of runtime heaps, **Reeprov can be used today with any external agent framework**, including:
- LangChain / LangGraph
- LlamaIndex
- CrewAI
- AutoGen
- PydanticAI
- Custom bespoke agent loops

---

## The Generic Ingest Pattern

Instrumenting any framework requires only four lifecycle hooks:

```text
Agent Run Start
  ↓
  pulse.startRun({ summary: "Task description", workflowId: "flow-id" })

Intermediate Execution (Loops, Prompts, Tools)
  ↓
  pulse.emitTraceEvent(...)       // Trajectory sequence & token stats
  pulse.captureModelCall(...)     // Input prompt, output completion, token usage
  pulse.captureToolCall(...)      // Tool arguments, result, side-effect tier

Agent Run Completion
  ↓
  pulse.completeRun({ run_id: "..." })  // Or pulse.failRun(...)
```

---

## Framework-Specific Adapters (Community Contribution Opportunity)

Framework-specific middleware or callbacks (e.g. `ReeprovCallbackHandler` for LangChain, or event listeners for CrewAI) are **future community contributor opportunities**.

We explicitly chose not to bloat the core beta repository with unstable upstream framework dependencies.

### Contributor Adapter Contract

If you wish to contribute an adapter for a specific framework, the integration must adhere to these requirements:

1. **Failure Isolation:** Any telemetry failure must fail-open and never crash the host agent's core loop.
2. **Side-Effect Classification:** Tool calls must map to Reeprov permission tiers (`read_only`, `write_draft`, `external_side_effect`, `destructive`, `sensitive_data`).
3. **Project-Scoped Authentication:** Ingest requests must be signed with project-scoped keys (`ap_live_...`).
4. **Offline Tests:** The adapter test suite must include mock provider tests verifying that trace events and boundaries are correctly shaped without requiring live LLM API keys.
5. **No Framework Dependencies in Core:** Framework adapters must live either in separate community packages or as optional peer extensions.
