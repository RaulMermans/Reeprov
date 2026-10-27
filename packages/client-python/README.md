# reeprov-client

> Official Python client SDK for [Reeprov](https://github.com/RaulMermans/Reeprov) — local-first debugging and reproducibility infrastructure for AI agents.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

---

## Installation

The package is not yet available on PyPI. From the Reeprov repository checkout:

```bash
pip install ./packages/client-python
```

Requires Python `>=3.10`. Zero third-party dependencies required (built strictly using standard library `urllib`).

---

## Quick Start

```python
import os
from reeprov_client import ReeprovClient

# Initialize client
reeprov = ReeprovClient(
    url=os.environ.get("REEPROV_URL", "http://127.0.0.1:3000"),
    ingest_key=os.environ.get("REEPROV_INGEST_KEY", "ree_live_..."),
    project_id="customer-support",
    workflow_id="triage-v1",
)

# 1. Start execution run
run_id = reeprov.start_run(summary="Triage customer inquiry #5812")

# 2. Record model calls & token usage
reeprov.model_call_completed(
    run_id=run_id,
    model="claude-sonnet-4-6",
    provider="anthropic",
    prompt="Classify urgency: System outage reported.",
    response={"category": "P0_OUTAGE", "escalate": True},
    input_tokens=150,
    output_tokens=32,
    cost_usd=0.0008,
)

# 3. Record tool invocations
reeprov.tool_call_completed(
    run_id=run_id,
    tool_name="pagerduty.trigger_incident",
    arguments={"severity": "critical", "service": "payments"},
    output={"incident_id": "INC-9901"},
    permission_class="external_side_effect",
)

# 4. Complete the run
reeprov.complete_run(run_id=run_id, summary="Urgent outage escalated successfully.")
```

---

## Environment Variables

The client can automatically configure itself from standard environment variables (with legacy `REEPROV_*` fallbacks during migration):

| Variable | Description |
|---|---|
| `REEPROV_URL` | Base URL of the Reeprov instance (e.g. `http://127.0.0.1:3000`) |
| `REEPROV_INGEST_KEY` | Project-scoped ingest key (`ree_live_...`) |
| `REEPROV_PROJECT_ID` | Default project identifier |
| `REEPROV_WORKFLOW_ID` | Default workflow identifier |
| `REEPROV_FAIL_OPEN` | Set to `"false"` to raise exceptions on telemetry errors (default: `"true"`) |
| `REEPROV_ENABLED` | Set to `"false"` to disable telemetry entirely |

---

## Reliability & Failure Isolation

- **Zero Third-Party Dependencies:** Pure Python standard library implementation (`urllib.request`).
- **Fail-Open Posture:** By default, delivery failures print warnings to stderr without crashing the host agent. They are still reported in the returned acknowledgement (`ok` is `False`).
- **Fast-Fail on Auth:** 401/403 responses fail immediately without wasteful retries.
- **Bounded Exponential Backoff:** Transient 5xx server errors retry up to 2 times.

## Acknowledgements and checkpoints

Ingest methods return an acknowledgement dict: `ok` is `True` only when every record was confirmed. With `fail_open=False`, an unconfirmed record raises `ReeprovIngestError`. Boundaries carry a stable client `boundaryId` and a per-run sequence, so retries are idempotent.

```python
client.checkpoint_observed(run_id, "reached_review")         # observation only, never restorable
client.register_checkpoint(run_id, checkpoint_id="after_lookup", step_id="lookup",
                           resume_step_index=1, state={"ticket": "T-1"},
                           adapter_id="my-agent", adapter_version="1.0.0")  # restorable-checkpoint capture
```

`checkpoint_saved` is a deprecated alias of `checkpoint_observed`. `start_run(..., content_mode="STRUCTURE_ONLY")` selects the capture policy; `complete_run(..., output=...)` records the final output.

The Reeprov host replay/fork runner executes JavaScript/TypeScript host adapters only. Python agents can capture boundaries and register checkpoints, but host replay of Python code returns `UNSUPPORTED_HOST_LANGUAGE`.

---

## License

Apache-2.0
