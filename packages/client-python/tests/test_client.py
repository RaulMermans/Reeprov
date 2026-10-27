"""
Unit tests for agentpulse_client
"""

import unittest
from unittest.mock import patch
import json
from reeprov_client import ReeprovClient, ReeprovError, ReeprovIngestError, canonical_sha256
from agentpulse_client import AgentPulseClient, AgentPulseError


class TestReeprovClient(unittest.TestCase):
    def test_rejected_boundary_acknowledgement_is_not_success(self):
        client = ReeprovClient(ingest_key="synthetic-key", fail_open=False)
        with patch.object(client, "_post", return_value=(200, {"accepted": 0, "rejected": 1,
                                                             "errors": [{"message": "Evidence unavailable"}]})):
            with self.assertRaisesRegex(ReeprovError, "Evidence unavailable"):
                client.capture_boundary("run-1", {"boundaryType": "tool_call", "name": "lookup", "input": {}})

    def test_missing_records_are_not_counted_as_stored(self):
        client = ReeprovClient(ingest_key="synthetic-key", fail_open=True)
        with patch.object(client, "_post", return_value=(200, {"accepted": 0, "rejected": 0})):
            ack = client.capture_boundary("run-1", {"boundaryType": "tool_call", "name": "lookup", "input": {}})
        self.assertFalse(ack["ok"])
        with patch.object(client, "_post", return_value=None):
            self.assertEqual(client.capture_boundary("run-1", {"boundaryType": "tool_call", "name": "x"})["delivery"], "unreachable")

    def test_boundaries_are_keyed_and_sequenced_per_run(self):
        client = ReeprovClient(ingest_key="synthetic-key", fail_open=False)
        sent = []

        def fake_post(path, body):
            record = body["boundaries"][0]
            sent.append(record)
            return 200, {"accepted": 1, "rejected": 0, "results": [
                {"index": 0, "status": "ACCEPTED", "sequence_index": record["sequenceIndex"]}]}

        with patch.object(client, "_post", side_effect=fake_post):
            client.capture_tool_call("run-a", tool_name="t1", arguments={})
            client.capture_tool_call("run-a", tool_name="t2", arguments={})
            client.capture_tool_call("run-b", tool_name="t1", arguments={})
        self.assertEqual([(r["boundaryId"], r["sequenceIndex"]) for r in sent],
                         [("bnd:run-a:0", 0), ("bnd:run-a:1", 1), ("bnd:run-b:0", 0)])
        self.assertEqual(client.confirmed_boundary_cursor("run-a"), 2)

    def test_observation_and_registration_are_distinct(self):
        client = ReeprovClient(ingest_key="synthetic-key", fail_open=False)
        calls = []

        def fake_post(path, body):
            calls.append((path, body))
            return 201, {"status": "OBSERVATION_RECORDED" if body["kind"] == "observe" else "REGISTERED"}

        with patch.object(client, "_post", side_effect=fake_post):
            self.assertEqual(client.checkpoint_saved("r", "c0", {"a": 1})["status"], "OBSERVATION_RECORDED")
            ack = client.register_checkpoint("r", checkpoint_id="c1", step_id="s", resume_step_index=1,
                                              state={"a": 1}, adapter_id="host", adapter_version="1.0.0")
        self.assertEqual(ack["status"], "REGISTERED")
        self.assertEqual(calls[0][0], "/api/runs/r/checkpoints")
        self.assertNotIn("boundaries", calls[0][1])
        self.assertEqual(calls[1][1]["state_hash"], canonical_sha256({"a": 1}))
        self.assertEqual(calls[1][1]["boundary_cursor"], 0)

    def test_rejected_checkpoint_raises_when_fail_closed(self):
        client = ReeprovClient(ingest_key="synthetic-key", fail_open=False)
        with patch.object(client, "_post", return_value=(422, {"status": "REJECTED", "code": "CHECKPOINT_STATE_HASH_MISMATCH"})):
            with self.assertRaises(ReeprovIngestError):
                client.register_checkpoint("r", checkpoint_id="c", step_id="s", resume_step_index=0,
                                           state={}, adapter_id="h", adapter_version="1")

    def test_canonical_hash_matches_server_fixture(self):
        # Fixture produced by the server's hashPayload (tests/s13/sdkParity.test.ts).
        value = {"b": 1.0, "a": [None, True, "é", 0.1, 1e21, -0.0], "z": {"y": 2, "x": "line\n"}}
        self.assertEqual(canonical_sha256(value),
                         "sha256:" + __import__("hashlib").sha256(
                             '{"a":[null,true,"é",0.1,1e+21,0],"b":1,"z":{"x":"line\\n","y":2}}'.encode()).hexdigest())

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
