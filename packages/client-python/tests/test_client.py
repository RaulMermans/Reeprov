"""
Unit tests for agentpulse_client
"""

import unittest
from agentpulse_client import AgentPulseClient, AgentPulseError


class TestAgentPulseClient(unittest.TestCase):
    def test_instantiation_defaults(self):
        client = AgentPulseClient(
            url="http://127.0.0.1:3000",
            ingest_key="test_key",
            project_id="test_project",
        )
        self.assertTrue(client.is_enabled)

    def test_disabled_client_behavior(self):
        client = AgentPulseClient(enabled=False, project_id="test_project")
        self.assertFalse(client.is_enabled)

        # start_run should return a noop id without network calls
        run_id = client.start_run(summary="Noop run")
        self.assertTrue(run_id.startswith("noop-") or "test_project" in run_id)

        # Telemetry methods should return cleanly
        client.model_call_completed(
            run_id=run_id,
            model="claude-sonnet-4-6",
            provider="anthropic",
            response={"ok": True},
        )
        client.tool_call_completed(
            run_id=run_id,
            tool_name="test_tool",
            arguments={"query": "test"},
        )
        client.complete_run(run_id=run_id)

    def test_error_instantiation(self):
        err = AgentPulseError("Unauthorized", status=401, is_retryable=False)
        self.assertEqual(str(err), "Unauthorized")
        self.assertEqual(err.status, 401)
        self.assertFalse(err.is_retryable)


if __name__ == "__main__":
    unittest.main()
