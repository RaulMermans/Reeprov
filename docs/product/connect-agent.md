# Connect Agent Wizard

The **Connect Agent Wizard** (`components/projects/ConnectAgentWizard.tsx`) provides an interactive interface for connecting existing AI agents to AgentPulse.

## Supported Frameworks & Runtimes

The wizard supports copy-paste integration across major agent ecosystems:

1. **Python SDK / OpenTelemetry**: Native Python decorator or context manager emitting canonical lifecycle events.
2. **LangChain / LangGraph**: Callbacks handler capturing agent steps, tool calls, and state transitions.
3. **LlamaIndex**: Instrumentation hooks capturing document retrieval and prompt synthesis.
4. **AutoGen & CrewAI**: Multi-agent message exchange, task handoffs, and delegation boundaries.
5. **TypeScript / JavaScript SDK**: First-class Node.js/browser client for Next.js and Node agent runtimes.
6. **Raw REST API**: Direct HTTP integration with `POST /api/runs/start` and `POST /api/traces/events`.

## Scoped Ingest Credentials

- Creating a project automatically generates a dedicated project ingest key (`ap_live_<hash>`).
- Keys are scoped strictly to the created project.
- Ingest keys cannot browse, query, or delete runs or projects.
