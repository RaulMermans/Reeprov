# Roadmap

## V0 — Static Proof UI

Current focus. AgentPulse proves the inspection layer using local example data only.

- Example workflows for Website Auditor, Campaign Sandbox, and Content Trend Analyzer
- Example runs, traces, and eval results
- Dashboard overview metrics
- Workflow gallery
- Workflow inspector
- Run detail pages
- Trace timeline
- Eval display
- Tool-call inspection
- Model/provider visibility

V0 intentionally does not add a workflow runtime, no-code builder, marketplace, database, external APIs, autonomous execution engine, deployment automation, or real LLM calls.

## V1 — Trace SDK

Projects emit AgentPulse-compatible traces without AgentPulse executing the project.

- Local/file-based ingestion
- Standard event schema
- `emitTraceEvent` and `validateTraceEvent` helpers
- Run summaries derived from traces and evals
- No network-dependent default CI tests

## V2 — Eval and Assertion Layer

The proof layer becomes stricter and more useful for regression discovery.

- Trace contract checks
- Tool-call assertions
- Output quality records
- Safety records
- Approval gate records
- Regression candidate generation

## V3 — Project Integrations

Connect real projects to the proof layer after local ingestion is stable.

- Website Auditor
- Campaign Sandbox
- Content Trend Analyzer
- Blog Agent

## V4 — Workflow Spec + Validator

Workflow specs become a durable contract for expected behavior.

- YAML/JSON workflow definitions
- Graph validation
- Node registry
- Permission checks
- Approval gate validation
- Spec-vs-trace comparison

## V5 — Thin Runtime Only If Justified Later

Runtime behavior remains out of scope unless the proof layer demonstrates a clear need.

- No autonomous execution engine by default
- No generic no-code agent builder
- No marketplace
- Any runtime must preserve read-only inspection as the core product value

---

## Scanner Roadmap History

The static repository scanner remains useful and should not be removed. It inspects repository files without executing them, redacts secrets, classifies AI system artifacts, builds scanner reports, and feeds the existing scanner dashboard components.

Future scanner work can continue after the proof UI is stable:

- Scan history for redacted reports
- Score trend chart per repository
- Finding diffs between scans
- Optional GitHub OAuth or GitHub App for private repo access
