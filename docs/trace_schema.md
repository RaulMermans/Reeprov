# Trace Schema

A `TraceEvent` is the fundamental unit of observability in AgentPulse. Every event a workflow emits becomes a trace event.

## Event Types

| event_type | When it fires |
|---|---|
| `run_started` | The workflow run begins. |
| `run_completed` | The workflow run finishes successfully. |
| `run_failed` | The workflow run terminates with an error. |
| `node_started` | A workflow node begins executing. |
| `node_completed` | A workflow node finishes successfully. |
| `node_failed` | A workflow node terminates with an error. |
| `model_call_started` | A model API call is about to be made. |
| `model_call_completed` | A model API call returns successfully. |
| `tool_call_started` | A tool invocation begins. |
| `tool_call_completed` | A tool invocation finishes successfully. |
| `tool_call_failed` | A tool invocation fails. |
| `eval_started` | An evaluator node begins. |
| `eval_completed` | An evaluator node finishes. |
| `approval_requested` | A human approval is required to continue. |
| `approval_granted` | A human approves continuation. |
| `approval_rejected` | A human rejects the action. |
| `artifact_created` | A final output artifact is produced. |
| `retry_started` | A node retries after a failure. |
| `error` | An error occurred (may not halt the run). |

## Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `event_id` | string | yes | Unique ID for this event. |
| `run_id` | string | yes | ID of the workflow run this event belongs to. |
| `workflow_id` | string | yes | ID of the workflow spec being executed. |
| `node_id` | string | no | ID of the node that emitted this event. |
| `timestamp` | string | yes | ISO 8601 timestamp. |
| `event_type` | string | yes | One of the values listed above. |
| `status` | string | no | One of: started, completed, failed, pending, skipped. |
| `duration_ms` | number | no | Duration of this step in milliseconds. |
| `cost_usd` | number | no | Cost of this step in USD (for model calls). |
| `input_summary` | string | no | Short human-readable summary of input (redacted). |
| `output_summary` | string | no | Short human-readable summary of output (redacted). |
| `metadata` | object | no | Freeform key-value pairs for additional context. |

## Using metadata

The `metadata` field carries structured context that does not fit into top-level fields.

Common uses:

- `tool_call_id`: string — links a `tool_call_started` event to its matching `tool_call_completed` or `tool_call_failed` event.
- `tool_name`: string — the name of the tool invoked (on tool events).
- `permission_class`: string — the permission class of the tool (on tool events).
- `passed`: boolean — required on `eval_completed` events. Indicates whether the eval passed.
- `eval_name`: string — the name of the eval that ran (on eval events).
- `model_provider`: string — the provider used for a model call.
- `model_name`: string — the model name used for a model call.

## Example: model_call_completed

```json
{
  "event_id": "evt-mc-003",
  "run_id": "wa-run-001",
  "workflow_id": "website-auditor-v1",
  "node_id": "brand-audit-agent",
  "timestamp": "2025-05-20T09:00:12.500Z",
  "event_type": "model_call_completed",
  "status": "completed",
  "duration_ms": 3200,
  "cost_usd": 0.018,
  "input_summary": "Brand audit instructions + 12 page snapshots",
  "output_summary": "Brand compliance score 87/100, 3 violations found",
  "metadata": {
    "model_provider": "anthropic",
    "model_name": "claude-3-5-sonnet-20241022",
    "tokens_input": 4200,
    "tokens_output": 820
  }
}
```

## Pairing tool_call_started with tool_call_completed

Use `metadata.tool_call_id` on both the start and completion/failure event when available. This is required for nodes that may call the same tool multiple times. For legacy examples without `tool_call_id`, the proof layer falls back to `run_id` + `node_id` + `metadata.tool_name`.

The proof layer checks that every `tool_call_started` event has a matching `tool_call_completed` or `tool_call_failed` event.

## Trace Contract Rules

- Every trace must include `run_started`.
- Successful traces must include `run_completed`.
- Failed traces must include `run_failed`.
- Failed traces must include at least one `error` event.
- A trace cannot include both `run_completed` and `run_failed` unless metadata explicitly marks the run degraded or partial.
- `eval_completed` must include `metadata.passed` as a boolean.
- `artifact_created` must include `run_id`.
- `tool_call_started` must have a matching `tool_call_completed` or `tool_call_failed`.

Status interpretation:

- If `run_failed` exists, classify the run as failed.
- If a critical eval failure exists, classify the run as failed.
- If a fail-severity eval exists, classify the run as degraded unless project conventions define failure.
- If only warning/info eval failures exist, classify the run as degraded or warning.

## Example Data Flow

Task 2 validates every JSON file under `examples/workflows`, `examples/traces`, `examples/evals`, and `examples/runs` against the schema. The dashboard loads this local proof data through `lib/proof-layer/examples.ts`; it does not call external APIs or execute workflows.

## eval_completed Requirements

Every `eval_completed` event must include `metadata.passed` as a boolean. Without it, the proof layer raises an `eval_pass_fail_required` violation. The `metadata` may also include `eval_name`, `score` (0.0–1.0), and `findings` for additional context.

```json
{
  "event_id": "evt-ev-002",
  "run_id": "wa-run-001",
  "workflow_id": "website-auditor-v1",
  "node_id": "evidence-evaluator",
  "timestamp": "2025-05-20T09:00:38.000Z",
  "event_type": "eval_completed",
  "status": "completed",
  "metadata": {
    "passed": true,
    "eval_name": "source_grounding",
    "score": 0.91
  }
}
```
