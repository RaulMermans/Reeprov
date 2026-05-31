# AgentPulse Python Integration

Copy `agentpulse_client.py` into your project and wrap your AI workflow.

## Setup

1. Copy `agentpulse_client.py` into your project.
2. Set environment variables:

```env
AGENTPULSE_URL=https://<your-agentpulse-url>
AGENTPULSE_INGEST_KEY=<your-ingest-key>
AGENTPULSE_PROJECT_ID=my-project
AGENTPULSE_PROJECT_NAME="My Project"
AGENTPULSE_WORKFLOW_ID=my-workflow-v1
AGENTPULSE_ENABLED=true
```

3. Wrap your workflow:

```python
from agentpulse_client import AgentPulseClient

pulse = AgentPulseClient()

run_id = pulse.start_run(summary="Starting my workflow")

# ... do work ...

pulse.model_call_completed(
    run_id=run_id,
    node_id="my-agent",
    model_provider="anthropic",
    model_name="claude-sonnet-4-6",
    input_tokens=1000,
    output_tokens=250,
    cost_usd=0.002,
    output_summary="Agent completed analysis",
)

pulse.complete_run(run_id, summary="Workflow complete")
```

## Notes

- Setting `AGENTPULSE_ENABLED=false` (or omitting it) makes all methods no-ops — safe for local dev.
- `AGENTPULSE_INGEST_KEY` is the ingest key, not the dashboard access key.
- No external dependencies — uses stdlib `urllib`.
