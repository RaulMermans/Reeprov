# reeprov-client

> Official Python client SDK for [Reeprov](https://github.com/RaulMermans/Reeprov) — local-first debugging and reproducibility infrastructure for AI agents.

[![PyPI version](https://img.shields.io/pypi/v/reeprov-client.svg)](https://pypi.org/project/reeprov-client/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

---

## Installation

```bash
pip install reeprov-client
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
- **Fail-Open Posture:** By default, telemetry delivery failures print non-fatal warnings to stderr without crashing the host agent.
- **Fast-Fail on Auth:** 401/403 responses fail immediately without wasteful retries.
- **Bounded Exponential Backoff:** Transient 5xx server errors retry up to 2 times.

---

## License

Apache-2.0
