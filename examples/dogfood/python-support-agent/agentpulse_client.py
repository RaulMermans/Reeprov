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
import sys
import time
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

    def __init__(
        self,
        *,
        url: Optional[str] = None,
        ingest_key: Optional[str] = None,
        project_id: Optional[str] = None,
        project_name: Optional[str] = None,
        workflow_id: Optional[str] = None,
        enabled: Optional[bool] = None,
        timeout: int = 10,
        max_retries: int = 2,
        fail_open: bool = True,
    ) -> None:
        self._url = url or os.environ.get("AGENTPULSE_URL", "")
        self._ingest_key = ingest_key or os.environ.get("AGENTPULSE_INGEST_KEY", "")
        self._project_id = project_id or os.environ.get("AGENTPULSE_PROJECT_ID", "")
        self._project_name = project_name or os.environ.get("AGENTPULSE_PROJECT_NAME", "")
        self._workflow_id = workflow_id or os.environ.get("AGENTPULSE_WORKFLOW_ID", "")
        if enabled is not None:
            self._enabled = enabled
        else:
            self._enabled = os.environ.get("AGENTPULSE_ENABLED", "").lower() == "true"
        self._timeout = timeout
        self._max_retries = max_retries
        self._fail_open = fail_open if os.environ.get("AGENTPULSE_FAIL_OPEN") != "false" else False

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

    # ── Replay-Grade Boundary Capture ──────────────────────────────────────────

    def capture_boundary(self, run_id: str, boundary: dict[str, Any]) -> None:
        """Emit a replay-grade execution boundary to AgentPulse."""
        if not self._enabled:
            return
        payload = {
            "boundaries": [
                {
                    "runId": run_id,
                    "startedAt": _now(),
                    **boundary,
                }
            ]
        }
        try:
            self._post("/api/traces/boundaries", payload)
        except Exception as e:
            # Non-fatal capture isolation
            print(f"[AgentPulse] Non-fatal boundary capture error: {e}")

    def capture_model_call(
        self,
        run_id: str,
        *,
        model: str,
        provider: str,
        response: Any,
        prompt: Optional[str] = None,
        messages: Optional[list[dict[str, Any]]] = None,
        step_id: Optional[str] = None,
        node_id: Optional[str] = None,
        duration_ms: Optional[int] = None,
    ) -> None:
        """Capture a model invocation boundary."""
        self.capture_boundary(run_id, {
            "boundaryType": "model_call",
            "name": f"{provider}/{model}",
            "stepId": step_id,
            "nodeId": node_id,
            "durationMs": duration_ms,
            "input": {
                "model": model,
                "provider": provider,
                "prompt": prompt,
                "messages": messages,
            },
            "output": response,
            "declaredSideEffectClass": "read_only",
        })

    def capture_tool_call(
        self,
        run_id: str,
        *,
        tool_name: str,
        arguments: Any,
        output: Optional[Any] = None,
        error: Optional[str] = None,
        permission_class: str = "read_only",
        step_id: Optional[str] = None,
        node_id: Optional[str] = None,
        duration_ms: Optional[int] = None,
    ) -> None:
        """Capture a tool invocation boundary."""
        self.capture_boundary(run_id, {
            "boundaryType": "tool_call",
            "name": tool_name,
            "stepId": step_id,
            "nodeId": node_id,
            "durationMs": duration_ms,
            "input": arguments,
            "output": output,
            "error": {"message": error} if error else None,
            "declaredSideEffectClass": permission_class,
        })

    def capture_retrieval(
        self,
        run_id: str,
        *,
        service_name: str,
        query: str,
        results: list[dict[str, Any]],
        step_id: Optional[str] = None,
        node_id: Optional[str] = None,
        duration_ms: Optional[int] = None,
    ) -> None:
        """Capture a retrieval operation boundary."""
        self.capture_boundary(run_id, {
            "boundaryType": "retrieval_service",
            "name": f"{service_name}:search",
            "stepId": step_id,
            "nodeId": node_id,
            "durationMs": duration_ms,
            "input": {"query": query},
            "output": {"results": results},
            "declaredSideEffectClass": "read_only",
        })

    def capture_memory_operation(
        self,
        run_id: str,
        *,
        provider: str,
        operation_type: str,
        category: str = "episodic",
        key: Optional[str] = None,
        value: Optional[Any] = None,
        step_id: Optional[str] = None,
        node_id: Optional[str] = None,
    ) -> None:
        """Capture a memory operation boundary."""
        is_read = operation_type in ("read", "retrieval")
        self.capture_boundary(run_id, {
            "boundaryType": "memory_read" if is_read else "memory_write",
            "name": f"{provider}:{operation_type}",
            "stepId": step_id,
            "nodeId": node_id,
            "input": {"key": key, "value": value, "operationType": operation_type},
            "output": {"status": "recorded"},
            "declaredSideEffectClass": "read_only" if is_read else "external_side_effect",
        })

    # ── Internal ──────────────────────────────────────────────────────────────

    def _post(self, path: str, body: dict[str, Any]) -> None:
        url = f"{self._url}{path}"
        data = json.dumps(body).encode("utf-8")
        last_error: Optional[Exception] = None

        for attempt in range(self._max_retries + 1):
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
                with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                    if resp.status < 400:
                        return
                    last_error = RuntimeError(f"AgentPulse {resp.status}: {path}")
            except urllib.error.HTTPError as e:
                # Non-retryable: 401, 403, or 4xx client errors
                if e.code in (401, 403) or (400 <= e.code < 500):
                    err = RuntimeError(f"AgentPulse request failed: {e.code} {path}")
                    if self._fail_open:
                        print(f"[AgentPulse] Non-retryable error ({e.code}): {path}", file=sys.stderr)
                        return
                    raise err from e
                # Server 5xx: transient error, retry
                last_error = e
                if attempt < self._max_retries:
                    time.sleep(0.05 * (2 ** attempt))
                    continue
            except Exception as e:
                last_error = e
                if attempt < self._max_retries:
                    time.sleep(0.05 * (2 ** attempt))
                    continue

        if self._fail_open:
            print(f"[AgentPulse] Telemetry request to {path} failed: {last_error}", file=sys.stderr)
            return
        raise last_error or RuntimeError(f"AgentPulse request failed: {path}")
