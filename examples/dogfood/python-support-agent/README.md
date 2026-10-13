# Python Support Agent Dogfood Example

A standalone Python AI support agent workflow instrumented with AgentPulse using the stdlib-only `agentpulse_client.py` integration client.

## What This Demonstrates

- **Zero External Dependencies**: Uses only standard Python library modules (`urllib`, `json`, `os`). No `pip install` required.
- **Run Lifecycle Instrumentation**: Demonstrates `start_run`, `model_call_completed`, `tool_call_completed`, `capture_boundary`, and `complete_run`.
- **Local-First Trace Capture**: Emits traces directly to an AgentPulse instance running locally or in self-hosted mode.

## Files

- `agent.py` — Standalone Python script executing an agent session.
- `agentpulse_client.py` — Copy of the standard Python client from `examples/integrations/python/agentpulse_client.py`.

## Running the Example

### 1. Ensure AgentPulse is running

```bash
npm run dev
# Running on http://127.0.0.1:3000
```

### 2. Configure Environment (Optional)

By default, `agent.py` connects to `http://127.0.0.1:3000`. You can configure environment variables to point to a specific instance:

```bash
export AGENTPULSE_URL="http://127.0.0.1:3000"
export AGENTPULSE_INGEST_KEY="ap_live_your_project_key"
export AGENTPULSE_PROJECT_ID="python-support-agent"
export AGENTPULSE_ENABLED="true"
```

### 3. Run the Agent

```bash
python3 agent.py
```

The script will emit model call events, tool execution records, and replay boundaries, then complete the run. View the results immediately in the AgentPulse Studio dashboard at:

`http://127.0.0.1:3000/dashboard/runs`
