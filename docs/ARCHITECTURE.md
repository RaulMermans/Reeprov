# Architecture

AgentPulse is structured in six layers. Each layer has a single responsibility.

## Layer 1: Workflow Spec

A declarative description of what a workflow is supposed to do. Defined in JSON using the `WorkflowSpec` schema. Specifies nodes (trigger, llm, tool, evaluator, approval, artifact, etc.), edges between nodes, architecture type, permission classes, and eval references. The spec is the source of truth for what the workflow intends — it is not a runtime configuration.

## Layer 2: Trace Events

Runtime events emitted by connected projects as the workflow executes. Each `TraceEvent` has an `event_type` (e.g. `run_started`, `model_call_completed`, `tool_call_failed`), a `run_id`, a `workflow_id`, an optional `node_id`, a timestamp, and optional cost and duration fields. Trace events are the raw evidence of what actually happened.

## Layer 3: Proof Layer

Validation and assertion functions that run against collected trace events. The proof layer checks that a run conforms to the declared workflow spec and to structural trace contracts. It produces a `ContractResult` with a list of violations. The proof layer is deterministic — it does not call any model.

## Layer 4: Eval Results

Pass/fail assertions on trace output, ingested as `EvalResult` records. Each eval is linked to a `run_id` and optionally a `node_id`. Evals have a type (output_quality, safety, schema_validity, etc.) and a severity (info, warning, fail, critical). Critical safety evals that fail block a run from being marked as completed. Failing evals at "fail" severity mark a run as degraded.

## Layer 5: Run Record

A summary of the full execution. `RunRecord` aggregates total duration, total cost, model call count, tool call count, eval pass/fail counts, approval status, and artifact references. It is derived from trace events and eval results. Status is one of: running, completed, failed, degraded, pending.

## Layer 6: Dashboard

An inspection UI that presents run records, trace timelines, eval results, and workflow spec overlays. The dashboard is read-only in v1. It does not initiate runs, does not modify workflows, and does not call models.

## How Connected Projects Send Trace Events

Connected projects (Website Auditor, Campaign Sandbox, etc.) emit `TraceEvent` objects to AgentPulse during or after a run. In v1, this is done by calling `emitTraceEvent` from the proof layer directly in the same process (in-memory). In v2, a lightweight HTTP endpoint will receive events from external processes.

Each event includes a `run_id` and `workflow_id` that bind it to a specific run and workflow spec. Events for the same run are collected and then passed to `assertTraceContract` for validation.

## How the Proof Layer Validates Traces

1. Collect all `TraceEvent` objects for a `run_id`.
2. Call `assertTraceContract(traceEvents)` to check structural rules.
3. Call `classifyFailure(traceEvents, evalResults)` to determine failure type and severity.
4. Call `summarizeRun(traceEvents, evalResults)` to produce a `RunSummary`.

The proof layer never executes workflow code. It only inspects event records.

## What Is NOT in Scope for v1

- AgentPulse does not run workflows.
- AgentPulse does not make live model calls.
- AgentPulse does not install or execute code from connected projects.
- AgentPulse does not persist run data to a database (in-memory only in v1).
- AgentPulse does not send trace events to external services.
