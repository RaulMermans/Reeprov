# Python Support Agent Dogfood Example

A standalone Python AI support agent workflow instrumented with Reeprov using the stdlib-only `reeprov_client.py` integration client (or official `reeprov-client`).

## What This Demonstrates

- **Zero External Dependencies**: Uses only standard Python library modules (`urllib`, `json`, `os`). No `pip install` required.
- **Run Lifecycle Instrumentation**: Demonstrates `start_run`, `model_call_completed`, `tool_call_completed`, `capture_boundary`, and `complete_run`.
- **Local-First Trace Capture**: Emits traces directly to a Reeprov instance running locally or in self-hosted mode.

## Files

- `agent.py` — Standalone Python script executing an agent session.
- `reeprov_client.py` — Copy of the standard Python client from `examples/integrations/python/reeprov_client.py`.

## Running the Example

### 1. Ensure Reeprov is running

```bash
npm run dev
# Running on http://127.0.0.1:3000
```

### 2. Configure Environment (Optional)

By default, `agent.py` connects to `http://127.0.0.1:3000`. You can configure environment variables to point to a specific instance:

```bash
export REEPROV_URL="http://127.0.0.1:3000"
export REEPROV_INGEST_KEY="ree_live_your_project_key"
export REEPROV_PROJECT_ID="python-support-agent"
export REEPROV_ENABLED="true"
```

### 3. Run the Agent

```bash
python3 agent.py
```

The script will emit model call events, tool execution records, and replay boundaries, then complete the run. View the results immediately in the Reeprov Studio dashboard at:

`http://127.0.0.1:3000/dashboard/runs`
