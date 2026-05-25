# Product Direction

## What AgentPulse Is

AgentPulse is a **black-box recorder and proof layer for agentic AI workflows**.

It accepts trace events from external AI projects, validates them, stores them, and presents them as inspectable run timelines. It answers: what happened, why, how much did it cost, and did it pass?

AgentPulse is **not**:
- A workflow runtime
- A no-code agent builder
- A marketplace
- A generic chatbot dashboard

## Primary Product Surface: Proof Runs

The primary product surface is `/dashboard/runs` — real trace ingestion runs from connected AI projects.

Each run is:
1. Recorded — trace events POSTed by a connected project, validated, and stored.
2. Evaluated — eval results indicate pass/fail at each step.
3. Inspectable — trace timeline, model calls, tool calls, costs, latency, artifacts.
4. Provable — the proof layer checks trace contracts and classifies failure modes.

## Secondary Surface: Repository Scanner

The repository scanner at `/dashboard/scanner` is a supporting tool that audits GitHub repos for AI system structure, secret exposure, and documentation quality. It is useful for onboarding new projects to AgentPulse.

The scanner is **not** the primary product. It does not execute workflows and does not produce trace data. It produces static health reports.

## Navigation

```
/dashboard                                    — Overview (live runs + example proof data + quick nav)
/dashboard/runs                               — Proof Runs (real trace ingestion runs)
/dashboard/runs/:id                           — Run Detail (trace timeline, evals, tool calls, costs, artifacts)
/dashboard/workflows                          — Workflow Gallery (example workflows with proof data)
/dashboard/scanner                            — Repository Scanner (access-key gated, static audit)
/dashboard/reports                            — Scan History (saved scanner reports and diffs)
/dashboard/reports/:reportId/reconstruction   — Static Proof Reconstruction for a saved scan report
```

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

## Operating Modes

### Mode 1 — Proof Runs (`/dashboard/runs`)

Real trace ingestion from connected AI projects.

- External projects emit `TraceEvent` objects via `POST /api/traces/events`
- Events are validated with Zod schemas before storage
- Runs are persisted in a file-backed run store (`.agentpulse/runs/`)
- Run summaries derive cost, latency, model calls, tool calls, eval counts, and status
- Trace contract validation runs when a run is completed
- Dashboard shows real runs in a sortable list with detail pages

### Mode 2 — Repository Scanner (`/dashboard/scanner`)

Internal static audit runner, access-key gated.

- Runs static analysis against a GitHub repository or uploaded ZIP file
- Classifies AI system artifacts (agents, workflows, prompts, tools, evals, models)
- Detects secrets, scores the repository, produces a structured health report
- Requires `AGENTPULSE_ACCESS_KEY` set server-side
- Does **not** execute scanned code, install dependencies, or make live LLM calls

### Mode 3 — Static Proof Reconstruction (`/dashboard/reports/[reportId]/reconstruction`)

Zero-instrumentation path for connecting a project to the proof layer without code changes.

- Takes a scan report and reconstructs a best-effort WorkflowSpec + AI system graph
- Generates three suggested files: `agentpulse.workflow.suggested.json`, `ai-system.suggested.yaml`, `instrumentation-plan.suggested.md`
- Identifies missing links: agents without prompts/models/evals, unmapped prompts, unmapped evals
- Instrumentation plan explains how to add trace events if desired — always optional, never required
- Reconstruction confidence is `high` (explicit manifest), `medium` (workflow files or manifest agents), or `low` (scattered artifacts only)
- Does **not** write files to disk in the scanned project; does not execute any code; does not require any changes to the target repo
- Available from scanner result, scan history, and saved report detail pages

## Authentication Model

| Key                       | Used for                                          |
|---------------------------|---------------------------------------------------|
| `AGENTPULSE_ACCESS_KEY`   | Dashboard / scanner access (browser session)      |
| `AGENTPULSE_INGEST_KEY`   | External trace ingestion (from AI projects)       |
| Fallback                  | If `AGENTPULSE_INGEST_KEY` is unset, `AGENTPULSE_ACCESS_KEY` is accepted for local/dev simplicity |

This separation means external projects can have their own key without accessing the scanner or scan history. Both keys use the same HTTP header: `x-agentpulse-key`.

## Why Not a Runtime

AgentPulse records what AI workflows do, not what they should do. Running workflows from within AgentPulse would:

1. Require importing scanned or connected project code — a security boundary violation
2. Create execution dependencies that are hard to reproduce
3. Make the tool opinionated about how workflows are built

The correct model: your AI project runs itself and emits traces to AgentPulse. AgentPulse records and validates those traces. The AI project is the runtime; AgentPulse is the observer.

## Future Framework Path

1. ✅ Static proof UI — example workflows, runs, workflow inspector, trace timeline, eval display (Task 2)
2. ✅ Durable reports — scanner report persistence, diff, regression candidates (Task 4)
3. ✅ Real trace ingestion — AgentPulse client, file-backed run store, ingestion API, live dashboard (Task 5)
4. ✅ Static proof reconstruction — zero-instrumentation path, suggested WorkflowSpec, AI system graph, missing links, optional instrumentation guide (Task 6)
5. **Next** — Project integrations: Website Auditor, Campaign Sandbox, Content Trend Analyzer, Blog Agent (emit real trace events using the reconstruction plan as the starting point)
6. Eval assertion layer — stronger trace contracts, tool-call assertions, safety/output records
7. Workflow spec validator — YAML/JSON definitions, graph validation, node registry, permissions
8. Later: thin runtime only if justified by proof-layer usage

## Language

Use: agentic workflow observability, traceable AI runs, eval-backed reliability, tool-call inspection, model/provider visibility, workflow proof layer, run timeline, black-box recording.

Do not use: "AI magic", "autonomous everything", "all-in-one AI platform", "generic chatbot dashboard".

## Target Users

Raul first. The tool exists to make personal AI workflow projects inspectable and reliable. As the patterns stabilize, the same schema and proof layer can be extracted for other AI builders who want observability without building it themselves.

## Example Connected Projects

- **Website Auditor**: crawls pages, runs brand/UX/SEO audit agents, synthesizes a report.
- **Campaign Sandbox**: generates route options, simulates personas, scores strategies.
- **Content Trend Analyzer**: collects signals, classifies trends, extracts angles for content.
- **Blog Agent**: takes a topic, researches, drafts, and publishes a post.
