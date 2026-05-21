# Roadmap

## Phase 1 (current): Foundation

Typed schemas, proof layer, mock examples, and trace contract validation.

- `WorkflowSpec` Zod schema with node types, edges, permission classes, and architecture types
- `TraceEvent` schema for runtime events
- `EvalResult` schema for pass/fail assertions
- `RunRecord` schema for execution summaries
- Proof layer: `validateTraceEvent`, `validateWorkflowSpec`, `assertTraceContract`, `classifyFailure`, `summarizeRun`
- Example workflows and trace files for Website Auditor, Campaign Sandbox, Content Trend Analyzer
- In-memory `emitTraceEvent` buffer for testing

## Phase 2: Trace Ingestion API

HTTP endpoint to receive trace events from connected projects.

- `POST /api/trace` accepts a single `TraceEvent` and stores it in memory per `run_id`
- `POST /api/trace/batch` accepts an array of events
- Authentication using `AGENTPULSE_ACCESS_KEY`
- Return 422 on schema validation failure with structured error
- `GET /api/runs/:runId` returns collected events and a `RunSummary`

## Phase 3: Dashboard v2

Run history, workflow graph view, and trace timeline.

- Run list with status, duration, cost, eval pass rate
- Workflow graph view: nodes and edges from `WorkflowSpec` overlaid with trace status
- Trace timeline: ordered event list with durations and costs per node
- Filter by run status, workflow, date range

## Phase 4: Eval Assertions

Eval result ingestion, score trends, and regression detection.

- `POST /api/evals` accepts `EvalResult[]` linked to a `run_id`
- Score trend chart per workflow and per eval type
- Regression detection: flag evals that were passing and are now failing
- Regression test promotion: mark a failing eval as an expected regression case

## Phase 5: SDK Package

Reusable `emitTraceEvent` and `validateTraceEvent` for connected projects.

- Extracted as a standalone package (e.g. `@agentpulse/sdk`)
- `emitTraceEvent(event)`: validates and sends to the AgentPulse ingestion endpoint
- `validateTraceEvent(event)`: validates locally without sending
- TypeScript types exported for `TraceEvent`, `WorkflowSpec`, `EvalResult`, `RunRecord`
- Minimal dependencies, works in Node.js and edge runtimes

## Phase 6: Workflow Inspector

Visualize workflow spec with trace overlay.

- Load a `WorkflowSpec` JSON file into the dashboard
- Overlay trace events: which nodes ran, which succeeded, which failed, durations
- Highlight approval gates, eval nodes, and artifact nodes
- Side-by-side view: spec intent vs. actual run behavior

## Not in the Roadmap

- Workflow runtime (AgentPulse does not execute workflows)
- No-code agent builder
- Live model calls from AgentPulse
- Generic chatbot dashboard
- Multi-tenant SaaS deployment
