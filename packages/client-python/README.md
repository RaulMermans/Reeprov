# agentpulse-client

> Official Python client SDK for [AgentPulse](https://github.com/raulm/AgentPulse) — the local-first debugging and reproducibility layer for AI agents.

[![PyPI version](https://img.shields.io/pypi/v/agentpulse-client.svg)](https://pypi.org/project/agentpulse-client/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

---

## Installation

```bash
pip install agentpulse-client
```

Requires Python `>=3.10`. Zero third-party dependencies required (built using standard library `urllib`).

---

## Quick Start

```python
import os
from agentpulse_client import AgentPulseClient

# Initialize client
pulse = AgentPulseClient(
    url=os.environ.get("AGENTPULSE_URL", "http://127.0.0.1:3000"),
    ingest_key=os.environ.get("AGENTPULSE_INGEST_KEY", "ap_live_..."),
    project_id="customer-support",
    workflow_id="triage-v1",
)

# 1. Start execution run
run_id = pulse.start_run(summary="Triage customer inquiry #5812")

# 2. Record model calls & token usage
pulse.model_call_completed(
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
pulse.tool_call_completed(
    run_id=run_id,
    tool_name="pagerduty.trigger_incident",
    arguments={"severity": "critical", "service": "payments"},
    output={"incident_id": "INC-9901"},
    permission_class="external_side_effect",
)

# 4. Complete the run
pulse.complete_run(run_id=run_id, summary="Urgent outage escalated successfully.")
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `AGENTPULSE_URL` | Base URL of the AgentPulse instance (e.g. `http://127.0.0.1:3000`) |
| `AGENTPULSE_INGEST_KEY` | Project-scoped ingest key (`ap_live_...`) |
| `AGENTPULSE_PROJECT_ID` | Default project identifier |
| `AGENTPULSE_WORKFLOW_ID` | Default workflow identifier |
| `AGENTPULSE_FAIL_OPEN` | Set to `"false"` to raise exceptions on telemetry errors (default: `"true"`) |
| `AGENTPULSE_ENABLED` | Set to `"false"` to disable telemetry entirely |

---

## Reliability & Failure Isolation

- **Zero Third-Party Dependencies:** Pure Python standard library implementation (`urllib.request`).
- **Fail-Open Posture:** By default, telemetry delivery failures print non-fatal warnings to stderr without crashing the host agent.
- **Fast-Fail on Auth:** 401/403 responses fail immediately without wasteful retries.
- **Bounded Exponential Backoff:** Transient 5xx server errors retry up to 2 times.

---

## License

Apache-2.0
