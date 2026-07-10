# AgentPulse Integration Guide

AgentPulse observes workflows that run elsewhere. An integration is the stable project identity and telemetry connection used to group runs, events, and optional WorkflowSpecs. AgentPulse does not execute or edit the connected workflow.

## Quickstart

1. Open `/dashboard/integrations`, choose **Add integration**, and enter stable project and workflow IDs.
2. Set these values only in the external project's server environment:

```dotenv
AGENTPULSE_URL=https://agentpulse.example.com
AGENTPULSE_INGEST_KEY=<secret-from-your-agentpulse-deployment>
AGENTPULSE_PROJECT_ID=customer-support-triage
AGENTPULSE_PROJECT_NAME="Customer Support Triage"
AGENTPULSE_WORKFLOW_ID=support-triage-v2
AGENTPULSE_ENABLED=true
```

The ingest key is a server secret. Do not place it in `NEXT_PUBLIC_*`, browser code, logs, source control, screenshots, or event metadata. The UI deliberately shows placeholders rather than the key.

All ingest calls use `Content-Type: application/json` and `x-agentpulse-key: $AGENTPULSE_INGEST_KEY`.

## Send a minimal run

```bash
RUN_ID="quickstart-$(date +%s)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

curl --fail-with-body -X POST "$AGENTPULSE_URL/api/runs/start" \
  -H "Content-Type: application/json" \
  -H "x-agentpulse-key: $AGENTPULSE_INGEST_KEY" \
  -d "{\"run_id\":\"$RUN_ID\",\"project_id\":\"customer-support-triage\",\"project_name\":\"Customer Support Triage\",\"workflow_id\":\"support-triage-v2\",\"summary\":\"Safe integration smoke test\"}"

curl --fail-with-body -X POST "$AGENTPULSE_URL/api/traces/events" \
  -H "Content-Type: application/json" \
  -H "x-agentpulse-key: $AGENTPULSE_INGEST_KEY" \
  -d "{\"events\":[{\"event_id\":\"$RUN_ID::triage::completed\",\"run_id\":\"$RUN_ID\",\"workflow_id\":\"support-triage-v2\",\"node_id\":\"triage\",\"timestamp\":\"$NOW\",\"event_type\":\"node_completed\",\"status\":\"completed\",\"output_summary\":\"Synthetic ticket classified\"}]}"

curl --fail-with-body -X POST "$AGENTPULSE_URL/api/runs/complete" \
  -H "Content-Type: application/json" \
  -H "x-agentpulse-key: $AGENTPULSE_INGEST_KEY" \
  -d "{\"run_id\":\"$RUN_ID\",\"summary\":\"Smoke test completed\"}"
```

Open `/dashboard/runs`, locate `$RUN_ID`, and open it. The Visual Execution Canvas should show the observed `triage` stage. The integration page should change from **waiting for first event** to **live**. The **Send test event** action is a dashboard-authenticated, server-side alternative that never sends the ingest key to the browser.

## Full example and clients

- `examples/integrations/fixtures/customer-support-triage-run.json` is a complete, schema-validated inferred-mode run with six observed stages, a model call, read-only tool failure, recovery, eval, artifact, and warning.
- `examples/integrations/typescript/agentpulseClient.ts` and `examples/integrations/python/agentpulse_client.py` are zero-dependency copy-in clients.
- `examples/integrations/rest/README.md` contains endpoint-by-endpoint curl examples.

Start the run before sending its events. Send one or more trace events in an `events` array, then complete or fail the run. `event_id` is the idempotency key within a run; re-sending the same ID is safe.

## Supported events

Run: `run_started`, `run_completed`, `run_failed`. Stages: `node_started`, `node_completed`, `node_failed`. Models: `model_call_started`, `model_call_completed`. Tools, skills, and CLI calls each support `*_started`, `*_completed`, and `*_failed`. Quality and governance: `eval_started`, `eval_completed`, `approval_requested`, `approval_granted`, `approval_rejected`. Evidence and recovery: `artifact_created`, `retry_started`, `agent_note_recorded`, `error`.

Every event requires `event_id`, `run_id`, `workflow_id`, an ISO-8601 `timestamp`, and a supported `event_type`. Stage-level evidence should include a stable `node_id`. Use `input_summary` and `output_summary` for concise, redacted descriptions. `metadata` must be a JSON object.

For model events, useful metadata includes `model_provider`, `model_name`, `input_tokens`, and `output_tokens`. Tool events should include `tool_call_id`, `tool_name`, and `permission_class`. Eval metadata uses `eval_id`, `eval_name`, `eval_type`, `passed`, `severity`, `score`, `findings`, and an optional `recommendation`. Artifacts use `artifact_ref` and `artifact_type`. Skills and CLI calls use descriptive names and safe summaries; never send commands containing credentials. Represent issues with `error` or failed events and recovery attempts with `retry_started` plus a later successful/degraded stage event.

## WorkflowSpec or inferred mode

A registered WorkflowSpec is a declared contract: it supplies semantic node types, expected order, edges, tools, evals, and gates. Promote or register a spec whose `workflow_id` matches the run. See `docs/workflow_spec.md` for the current schema.

Without a matching registered spec, AgentPulse uses inferred mode. It groups events by `node_id`, orders stages from observed timestamps, and infers lanes from metadata such as `lane`, `agent`, `role`, `stage_group`, or `owner`. Inferred runs are fully inspectable; they simply cannot show declared-but-unobserved nodes.

## Common errors

| Symptom | Meaning and fix |
| --- | --- |
| `401 unauthorized` | Header missing or ingest key invalid. Send `x-agentpulse-key`; do not use a client-exposed value. |
| `project_id is required` | The start-run body is missing the stable project ID. |
| `run_id is required` | Complete/fail request is missing the ID returned or supplied at start. |
| `Run ... not found` | Events arrived before `POST /api/runs/start`, or the ID differs. |
| `Body must include an "events" array` | Wrap event objects in `{ "events": [...] }`. |
| Rejected event / schema validation | Check required strings, supported `event_type`/`status`, numeric fields, and that `metadata` is an object. |
| Unknown event type | Use one of the supported values above; event names are exact. |
| Timestamp looks wrong | Send a valid UTC ISO-8601 timestamp, for example `2026-07-10T09:00:00.000Z`. |
| Run never appears | Check the response body, deployment logs, storage health, base URL, and that start-run returned `201`. |

The event endpoint returns `{ accepted, rejected, errors }`. Inspect `rejected` even when the HTTP response is `200`, because a mixed batch can accept valid events and reject invalid ones.

## Privacy boundary

Send operational summaries, counts, classifications, references, and timings—not raw prompts, full model outputs, customer messages, credentials, cookies, private keys, access tokens, personal data, or proprietary document bodies. Prefer opaque IDs or one-way references. Artifact telemetry should contain a safe reference and type, not the artifact contents. `agent_note_recorded` is only renderable when metadata explicitly marks `visibility: "user_safe"`; it must never contain hidden chain-of-thought.
