# AgentPulse REST Integration

Use the AgentPulse ingest API directly from any language via HTTP.

## Environment variables

```env
AGENTPULSE_URL=https://<your-agentpulse-url>
AGENTPULSE_INGEST_KEY=<your-ingest-key>
```

## 1. Start a run

```bash
curl -s -X POST "$AGENTPULSE_URL/api/runs/start" \
  -H "Content-Type: application/json" \
  -H "x-agentpulse-key: $AGENTPULSE_INGEST_KEY" \
  -d '{
    "project_id": "my-project",
    "project_name": "My Project",
    "workflow_id": "my-workflow-v1",
    "summary": "Starting my workflow"
  }'
```

Response: `{ "run_id": "...", ... }`

## 2. Append trace events

```bash
curl -s -X POST "$AGENTPULSE_URL/api/traces/events" \
  -H "Content-Type: application/json" \
  -H "x-agentpulse-key: $AGENTPULSE_INGEST_KEY" \
  -d '{
    "events": [
      {
        "event_id": "<run_id>::model::1",
        "run_id": "<run_id>",
        "workflow_id": "my-workflow-v1",
        "node_id": "my-agent",
        "timestamp": "2025-01-01T00:00:01Z",
        "event_type": "model_call_completed",
        "status": "completed",
        "duration_ms": 1200,
        "cost_usd": 0.002,
        "output_summary": "Agent analysis complete",
        "metadata": {
          "model_provider": "anthropic",
          "model_name": "claude-sonnet-4-6",
          "input_tokens": 1000,
          "output_tokens": 250
        }
      }
    ]
  }'
```

## 3. Complete the run

```bash
curl -s -X POST "$AGENTPULSE_URL/api/runs/complete" \
  -H "Content-Type: application/json" \
  -H "x-agentpulse-key: $AGENTPULSE_INGEST_KEY" \
  -d '{
    "run_id": "<run_id>",
    "summary": "Workflow complete",
    "total_cost_usd": 0.002,
    "total_duration_ms": 3500
  }'
```

## 4. Fail a run

```bash
curl -s -X POST "$AGENTPULSE_URL/api/runs/fail" \
  -H "Content-Type: application/json" \
  -H "x-agentpulse-key: $AGENTPULSE_INGEST_KEY" \
  -d '{
    "run_id": "<run_id>",
    "error_summary": "Agent failed: timeout"
  }'
```

## Notes

- All ingest endpoints use `x-agentpulse-key: $AGENTPULSE_INGEST_KEY`.
- `AGENTPULSE_INGEST_KEY` is separate from `AGENTPULSE_ACCESS_KEY` (dashboard key).
- `event_id` must be unique per run. Use `<run_id>::<node>::<shortid>` format.
- Events for an unknown `run_id` are rejected — call `/api/runs/start` first.
- Duplicate `event_id` values are silently deduplicated (idempotent).
