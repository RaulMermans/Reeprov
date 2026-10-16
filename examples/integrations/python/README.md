# Reeprov Python Integration

Copy `reeprov_client.py` into your project (or install `pip install reeprov-client`) and wrap your AI workflow.

## Setup

1. Copy `reeprov_client.py` into your project or install `reeprov-client`.
2. Set environment variables:

```env
REEPROV_URL=http://127.0.0.1:3000
REEPROV_INGEST_KEY=<your-ingest-key>
REEPROV_PROJECT_ID=my-project
REEPROV_PROJECT_NAME="My Project"
REEPROV_WORKFLOW_ID=my-workflow-v1
REEPROV_ENABLED=true
```

3. Wrap your workflow:

```python
from reeprov_client import ReeprovClient

reeprov = ReeprovClient()

run_id = reeprov.start_run(summary="Starting my workflow")

# ... do work ...

reeprov.model_call_completed(
    run_id=run_id,
    node_id="my-agent",
    model_provider="anthropic",
    model_name="claude-sonnet-4-6",
    input_tokens=1000,
    output_tokens=250,
    cost_usd=0.002,
    output_summary="Agent completed analysis",
)

reeprov.complete_run(run_id, summary="Workflow complete")
```

## Notes

- Setting `REEPROV_ENABLED=false` (or omitting it) makes all methods no-ops — safe for local dev.
- `REEPROV_INGEST_KEY` is the ingest key, not the dashboard access key.
- No external dependencies — uses stdlib `urllib`.
- Legacy `REEPROV_*` environment variables remain supported with deprecation warnings.
