# Product Direction

## Mission

AgentPulse is a black-box recorder and proof layer for agentic AI workflows. It turns black-box AI runs into visible, evaluable execution traces.

## Core Questions AgentPulse Answers

- What workflow ran, and which version?
- Which nodes executed and in what order?
- Which model and provider handled each call?
- Which tools were called, with what permission class?
- What were the inputs and outputs at each step?
- Which evals passed or failed, and why?
- How many retries occurred? What errors were raised?
- What was the total cost and latency for the run?
- Was human approval required, and was it granted or rejected?
- What final artifact was produced?
- Which failing behaviors should become regression test cases?

## Why the First Product Surface is Read-Only and Inspection-Focused

Trust before control. Before AgentPulse can make decisions about workflows, it needs to observe them faithfully. The first dashboard uses static proof-layer examples to show workflow specs, run records, trace timelines, tool calls, eval results, costs, latency, approvals, and artifacts. Adding control surfaces before the trace layer is stable would add complexity without a reliable foundation. Inspection earns the right to act.

## Scope

**In scope:**

- Static example workflows, traces, evals, and run records
- Dashboard overview metrics from local proof data
- Workflow gallery and workflow inspector
- Run detail pages with trace timeline, model calls, tool calls, evals, errors, retries, artifacts, cost, and latency
- Trace event ingestion from connected projects in a later task
- Workflow spec validation (declarative description of what a workflow is supposed to do)
- Proof layer assertions (did the run conform to the spec?)
- Run summaries (cost, latency, model calls, tool calls, eval results)
- Eval result ingestion (pass/fail assertions linked to trace events)

**Out of scope:**

- Workflow runtime (AgentPulse does not execute workflows)
- No-code agent builder
- Generic chatbot dashboard
- Live model calls initiated by AgentPulse
- Database-backed run history
- Marketplace or public SaaS surfaces

## Target Users

Raul first. The tool exists to make personal AI workflow projects inspectable and reliable. As the patterns stabilize, the same schema and proof layer can be extracted for other AI builders who want observability without building it themselves.

## Example Connected Projects

- **Website Auditor**: crawls pages, runs brand/UX/SEO audit agents, synthesizes a report.
- **Campaign Sandbox**: generates route options, simulates personas, scores strategies.
- **Content Trend Analyzer**: collects signals, classifies trends, extracts angles for content.
- **Blog Agent**: takes a topic, researches, drafts, and publishes a post.

The Task 2 dashboard uses local example data for Website Auditor, Campaign Sandbox, and Content Trend Analyzer. Blog Agent remains a planned card until example workflow, trace, eval, and run records exist.

## Dashboard Views

- **Overview**: proof-layer metrics, recent workflows, recent failures, and clear read-only positioning.
- **Workflow Gallery**: workflow cards with architecture type, node count, edge count, eval count, latest run status, average eval score, latest run timestamp, and project name.
- **Workflow Inspector**: metadata, architecture type, node list, edges, tools, evals, permission classes, approval gates, and artifacts.
- **Run Detail**: summary, status, workflow, project, timestamps, duration, cost, model/tool call counts, eval pass/fail counts, approval status, artifacts, trace timeline, errors, retries, and cost/latency summary.

The UI language should emphasize agentic workflow observability, traceable AI runs, eval-backed reliability, tool-call inspection, model/provider visibility, workflow proof layer, run timeline, and black-box recording.

## Future Framework Path

The intended progression:

1. Static proof UI — example workflows, runs, workflow inspector, trace timeline, eval display
2. Trace SDK — projects emit AgentPulse-compatible traces to local/file-based ingestion
3. Eval and assertion layer — stronger trace contracts, tool-call assertions, safety/output records
4. Project integrations — Website Auditor, Campaign Sandbox, Content Trend Analyzer, Blog Agent
5. Workflow spec validator — YAML/JSON definitions, graph validation, node registry, permissions, approval gates
6. Later: thin runtime only if justified by proof-layer usage

## Language to Avoid

Do not describe AgentPulse as offering "AI magic", "autonomous everything", or as an "all-in-one AI platform". It is a focused observability and proof layer, not a general-purpose agent framework.
