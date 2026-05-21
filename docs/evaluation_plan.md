# Evaluation Plan

## EvalResult Types

| type | Description |
|---|---|
| `schema_validity` | The output conforms to the declared output schema. |
| `tool_call_assertion` | The correct tools were called with the expected arguments. |
| `output_quality` | The output meets quality criteria (relevance, coherence, completeness). |
| `safety` | The output does not contain harmful, prohibited, or policy-violating content. |
| `source_grounding` | Claims in the output are grounded in provided sources. |
| `trace_contract` | The trace events conform to the declared workflow spec and structural rules. |
| `approval_gate` | A human approval step was required and correctly invoked. |
| `model_benchmark` | The model meets a performance threshold on a defined benchmark. |

## Severity Levels

| severity | Meaning for run status |
|---|---|
| `info` | Informational note. Does not affect run status. |
| `warning` | Something worth noting. Does not fail the run. |
| `fail` | The eval failed. The run is marked as `degraded`. |
| `critical` | The eval failed in a critical way. The run is blocked from `completed` status. |

A run is marked `completed` only if no `critical` evals failed. A run is marked `degraded` if any `fail`-severity evals failed but no `critical` evals failed. A run with `info` or `warning`-only failures is still `completed`.

## How Critical Safety Evals Block Success

When a `safety` eval (or any eval with severity `critical`) has `passed: false`, the run cannot be marked `completed`. The `classifyFailure` function returns `{ failureType: "eval_failure", severity: "critical" }`. This is the strictest failure mode and overrides all other failure classification.

## How Failing Evals Mark a Run as Degraded

When a `fail`-severity eval has `passed: false` and no `critical` eval is failing, `classifyFailure` returns `{ failureType: "eval_failure", severity: "degraded" }`. The run record status is set to `degraded` rather than `failed` or `completed`.

## Trace Contract Assertions

`assertTraceContract` checks the following structural rules against a set of trace events:

- `run_started_required`: Every `run_id` must have a `run_started` event.
- `failed_run_error_required`: A `run_failed` event must be accompanied by at least one `error` event for the same `run_id`.
- `tool_call_completion_required`: Every `tool_call_started` event must have a matching `tool_call_completed` or `tool_call_failed` with the same `run_id` and `node_id`.
- `eval_pass_fail_required`: Every `eval_completed` event must have `metadata.passed` defined as a boolean.
- `artifact_run_id_required`: Every `artifact_created` event must have a `run_id`.

Violations are returned as `ContractViolation` objects with a `rule` identifier and a human-readable `message`. A contract result with zero violations has `passed: true`.

## Attaching Evals to Nodes

Evals are linked to nodes via `eval_refs` in the workflow spec. For example, an `evaluator` node with `eval_refs: ["source_grounding", "schema_validity"]` declares that those evals should run and produce results after that node executes. `EvalResult` objects reference the node via `node_id`.

This allows the dashboard to show which evals belong to which part of the workflow, and allows the proof layer to validate that declared evals actually ran.

## Regression Test Promotion

When a run fails an eval at `fail` or `critical` severity, the failing behavior can be promoted to a regression test case. This means:

1. The `EvalResult` is stored as a named test case.
2. Future runs are expected to pass that same eval.
3. If a future run fails the same eval again, it is a regression.

In v1, promotion is manual — the user marks a failing eval as a regression case. In a future phase, AgentPulse will detect when a previously passing eval starts failing and flag it automatically.
