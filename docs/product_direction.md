# Product Direction

## Mission

AgentPulse is a lightweight reliability and observability framework for agentic AI workflows. It turns black-box AI runs into visible, evaluable execution traces.

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

## Why v1 is Read-Only and Inspection-Focused

Trust before control. Before AgentPulse can make decisions about workflows, it needs to observe them faithfully. v1 receives trace events, validates them against a schema, runs assertions, and presents a readable record. Adding control surfaces before the trace layer is stable would add complexity without a reliable foundation. Inspection earns the right to act.

## Scope

**In scope:**

- Trace event ingestion from connected projects
- Workflow spec validation (declarative description of what a workflow is supposed to do)
- Proof layer assertions (did the run conform to the spec?)
- Run summaries (cost, latency, model calls, tool calls, eval results)
- Eval result ingestion (pass/fail assertions linked to trace events)

**Out of scope:**

- Workflow runtime (AgentPulse does not execute workflows)
- No-code agent builder
- Generic chatbot dashboard
- Live model calls initiated by AgentPulse

## Target Users

Raul first. The tool exists to make personal AI workflow projects inspectable and reliable. As the patterns stabilize, the same schema and proof layer can be extracted for other AI builders who want observability without building it themselves.

## Example Connected Projects

- **Website Auditor**: crawls pages, runs brand/UX/SEO audit agents, synthesizes a report.
- **Campaign Sandbox**: generates route options, simulates personas, scores strategies.
- **Content Trend Analyzer**: collects signals, classifies trends, extracts angles for content.
- **Blog Agent**: takes a topic, researches, drafts, and publishes a post.

Each of these emits trace events to AgentPulse. AgentPulse validates the run and surfaces what happened.

## Future Framework Path

The intended progression:

1. Trace schema — define what a trace event looks like (current)
2. Eval assertions — validate that runs meet behavioral contracts
3. Workflow spec — declare what a workflow is supposed to do
4. Reusable SDK/package — `emitTraceEvent`, `validateTraceEvent` for connected projects
5. Workflow inspector UI — visualize workflow spec with trace overlay
6. Later: validator — compare actual run against declared spec
7. Later: thin executor — scaffold a run from a spec

## Language to Avoid

Do not describe AgentPulse as offering "AI magic", "autonomous everything", or as an "all-in-one AI platform". It is a focused observability and proof layer, not a general-purpose agent framework.
