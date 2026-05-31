"""
AgentPulse Python Client

Copy this file into your project and use it to emit trace events to AgentPulse.

Required environment variables:
  AGENTPULSE_URL        — base URL of your AgentPulse instance
  AGENTPULSE_INGEST_KEY — ingest key (NOT the dashboard access key)
  AGENTPULSE_PROJECT_ID — stable project identifier (e.g. "blog-agent")
  AGENTPULSE_PROJECT_NAME — human-readable project name (e.g. "Blog Agent")
  AGENTPULSE_WORKFLOW_ID — workflow being run (e.g. "blog-agent-v1")
  AGENTPULSE_ENABLED    — set to "true" to enable; any other value = no-op

No external dependencies required (uses stdlib urllib).
"""

import json
import os
import random
import string
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Optional


def _short_id() -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=8))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AgentPulseClient:
    """Thin client for emitting AgentPulse trace events."""

    def __init__(self) -> None:
        self._url = os.environ.get("AGENTPULSE_URL", "")
        self._ingest_key = os.environ.get("AGENTPULSE_INGEST_KEY", "")
        self._project_id = os.environ.get("AGENTPULSE_PROJECT_ID", "")
        self._project_name = os.environ.get("AGENTPULSE_PROJECT_NAME", "")
        self._workflow_id = os.environ.get("AGENTPULSE_WORKFLOW_ID", "")
        self._enabled = os.environ.get("AGENTPULSE_ENABLED", "").lower() == "true"

    @property
    def is_enabled(self) -> bool:
        return self._enabled

    def start_run(self, summary: str, run_id: Optional[str] = None) -> str:
        """Start a new run. Returns the run_id."""
        if not self._enabled:
            return f"noop-{_short_id()}"
        run_id = run_id or f"{self._project_id}-{_short_id()}"
        self._post("/api/runs/start", {
            "run_id": run_id,
            "project_id": self._project_id,
            "project_name": self._project_name,
            "workflow_id": self._workflow_id,
            "summary": summary,
        })
        return run_id

    def emit_trace_events(self, events: list[dict[str, Any]]) -> None:
        """Emit a list of raw trace events."""
        if not self._enabled or not events:
            return
        self._post("/api/traces/events", {"events": events})

    def emit_trace_event(self, event: dict[str, Any]) -> None:
        """Emit a single raw trace event."""
        self.emit_trace_events([event])

    def model_call_completed(
        self,
        run_id: str,
        *,
        node_id: str,
        model_provider: str,
        model_name: str,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
        duration_ms: Optional[int] = None,
        input_summary: Optional[str] = None,
        output_summary: Optional[str] = None,
    ) -> None:
        """Record a completed model call."""
        if not self._enabled:
            return
        event: dict[str, Any] = {
            "event_id": f"{run_id}::{node_id}::model::{_short_id()}",
            "run_id": run_id,
            "workflow_id": self._workflow_id,
            "node_id": node_id,
            "timestamp": _now(),
            "event_type": "model_call_completed",
            "status": "completed",
            "cost_usd": cost_usd,
            "metadata": {
                "model_provider": model_provider,
                "model_name": model_name,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
            },
        }
        if duration_ms is not None:
            event["duration_ms"] = duration_ms
        if input_summary:
            event["input_summary"] = input_summary
        if output_summary:
            event["output_summary"] = output_summary
        self.emit_trace_events([event])

    def tool_call_completed(
        self,
        run_id: str,
        *,
        node_id: str,
        tool_name: str,
        permission_class: str = "read_only",
        duration_ms: Optional[int] = None,
        cost_usd: Optional[float] = None,
        input_summary: Optional[str] = None,
        output_summary: Optional[str] = None,
    ) -> None:
        """Record a completed tool call."""
        if not self._enabled:
            return
        tool_call_id = f"{run_id}::tc::{_short_id()}"
        event: dict[str, Any] = {
            "event_id": f"{run_id}::{node_id}::tool::{_short_id()}",
            "run_id": run_id,
            "workflow_id": self._workflow_id,
            "node_id": node_id,
            "timestamp": _now(),
            "event_type": "tool_call_completed",
            "status": "completed",
            "metadata": {
                "tool_name": tool_name,
                "tool_call_id": tool_call_id,
                "permission_class": permission_class,
            },
        }
        if duration_ms is not None:
            event["duration_ms"] = duration_ms
        if cost_usd is not None:
            event["cost_usd"] = cost_usd
        if input_summary:
            event["input_summary"] = input_summary
        if output_summary:
            event["output_summary"] = output_summary
        self.emit_trace_events([event])

    def eval_completed(
        self,
        run_id: str,
        *,
        eval_id: str,
        eval_name: str,
        eval_type: str,
        passed: bool,
        score: float,
        severity: str = "info",
        node_id: Optional[str] = None,
        findings: Optional[list[str]] = None,
        recommendation: Optional[str] = None,
        output_summary: Optional[str] = None,
    ) -> None:
        """Record a completed eval."""
        if not self._enabled:
            return
        event: dict[str, Any] = {
            "event_id": f"{run_id}::eval::{eval_id}",
            "run_id": run_id,
            "workflow_id": self._workflow_id,
            "timestamp": _now(),
            "event_type": "eval_completed",
            "status": "completed",
            "metadata": {
                "eval_id": eval_id,
                "eval_name": eval_name,
                "eval_type": eval_type,
                "passed": passed,
                "score": score,
                "severity": severity,
                "findings": findings or [],
            },
        }
        if node_id:
            event["node_id"] = node_id
        if output_summary:
            event["output_summary"] = output_summary
        if recommendation:
            event["metadata"]["recommendation"] = recommendation
        self.emit_trace_events([event])

    def artifact_created(
        self,
        run_id: str,
        *,
        artifact_ref: str,
        artifact_type: str = "output",
        node_id: Optional[str] = None,
        output_summary: Optional[str] = None,
    ) -> None:
        """Record an artifact."""
        if not self._enabled:
            return
        event: dict[str, Any] = {
            "event_id": f"{run_id}::artifact::{artifact_ref}",
            "run_id": run_id,
            "workflow_id": self._workflow_id,
            "timestamp": _now(),
            "event_type": "artifact_created",
            "status": "completed",
            "metadata": {
                "artifact_ref": artifact_ref,
                "artifact_type": artifact_type,
            },
        }
        if node_id:
            event["node_id"] = node_id
        if output_summary:
            event["output_summary"] = output_summary
        self.emit_trace_events([event])

    def complete_run(
        self,
        run_id: str,
        *,
        summary: Optional[str] = None,
        total_cost_usd: Optional[float] = None,
        total_duration_ms: Optional[int] = None,
        artifact_refs: Optional[list[str]] = None,
    ) -> None:
        """Mark a run as completed."""
        if not self._enabled:
            return
        body: dict[str, Any] = {"run_id": run_id}
        if summary:
            body["summary"] = summary
        if total_cost_usd is not None:
            body["total_cost_usd"] = total_cost_usd
        if total_duration_ms is not None:
            body["total_duration_ms"] = total_duration_ms
        if artifact_refs:
            body["artifact_refs"] = artifact_refs
        self._post("/api/runs/complete", body)

    def fail_run(self, run_id: str, *, error_summary: str) -> None:
        """Mark a run as failed."""
        if not self._enabled:
            return
        self._post("/api/runs/fail", {"run_id": run_id, "error_summary": error_summary})

    # ── Internal ──────────────────────────────────────────────────────────────

    def _post(self, path: str, body: dict[str, Any]) -> None:
        url = f"{self._url}{path}"
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "x-agentpulse-key": self._ingest_key,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status >= 400:
                    raise RuntimeError(f"AgentPulse {resp.status}: {path}")
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"AgentPulse request failed: {e.code} {path}") from e
