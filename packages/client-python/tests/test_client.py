"""
Unit tests for agentpulse_client
"""

import unittest
from unittest.mock import patch
from reeprov_client import ReeprovClient, ReeprovError
from agentpulse_client import AgentPulseClient, AgentPulseError


class TestReeprovClient(unittest.TestCase):
    def test_rejected_boundary_acknowledgement_is_not_success(self):
        client = ReeprovClient(ingest_key="synthetic-key", fail_open=False)
        with patch.object(client, "_post", return_value={"accepted": 0, "rejected": 1,
                                                       "errors": [{"message": "Evidence unavailable"}]}):
            with self.assertRaisesRegex(ReeprovError, "Evidence unavailable"):
                client.capture_boundary("run-1", {"boundaryType": "tool_call", "name": "lookup", "input": {}})

    def test_instantiation_defaults(self):
        client = ReeprovClient(
            url="http://127.0.0.1:3000",
            ingest_key="test_key",
            project_id="test_project",
        )
        self.assertTrue(client.is_enabled)

    def test_disabled_client_behavior(self):
        client = ReeprovClient(enabled=False, project_id="test_project")
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
        err = ReeprovError("Unauthorized", status=401, is_retryable=False)
        self.assertEqual(str(err), "Unauthorized")
        self.assertEqual(err.status, 401)
        self.assertFalse(err.is_retryable)

    def test_legacy_alias(self):
        self.assertIs(AgentPulseClient, ReeprovClient)
        self.assertIs(AgentPulseError, ReeprovError)
        legacy_client = AgentPulseClient(enabled=False, project_id="test_project")
        self.assertIsInstance(legacy_client, ReeprovClient)


if __name__ == "__main__":
    unittest.main()
