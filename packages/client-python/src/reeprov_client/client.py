"""
Reeprov Python Client

Zero-dependency HTTP client for Reeprov.
Communicates strictly over standard HTTP APIs using Python stdlib.
"""

from __future__ import annotations

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


class ReeprovError(Exception):
    """Exception raised for unrecoverable errors when fail_open is False."""

    def __init__(self, message: str, status: Optional[int] = None, is_retryable: bool = False):
        super().__init__(message)
        self.status = status
        self.is_retryable = is_retryable


AgentPulseError = ReeprovError


class ReeprovClient:
    """Thin, zero-dependency client for emitting Reeprov trace events and execution boundaries."""

    def __init__(
        self,
        *,
        url: Optional[str] = None,
        endpoint: Optional[str] = None,
        ingest_key: Optional[str] = None,
        api_key: Optional[str] = None,
        project_id: Optional[str] = None,
        project_name: Optional[str] = None,
        workflow_id: Optional[str] = None,
        enabled: Optional[bool] = None,
        timeout: int = 10,
        max_retries: int = 2,
        fail_open: bool = True,
    ) -> None:
        raw_url = (
            url
            or endpoint
            or os.environ.get("REEPROV_URL")
            or os.environ.get("AGENTPULSE_URL", "http://127.0.0.1:3000")
        )
        self._url = raw_url.rstrip("/")
        self._ingest_key = (
            ingest_key
            or api_key
            or os.environ.get("REEPROV_INGEST_KEY")
            or os.environ.get("AGENTPULSE_INGEST_KEY", "")
        )
        self._project_id = (
            project_id
            or os.environ.get("REEPROV_PROJECT_ID")
            or os.environ.get("AGENTPULSE_PROJECT_ID", "default-project")
        )
        self._project_name = (
            project_name
            or os.environ.get("REEPROV_PROJECT_NAME")
            or os.environ.get("AGENTPULSE_PROJECT_NAME", "Default Project")
        )
        self._workflow_id = (
            workflow_id
            or os.environ.get("REEPROV_WORKFLOW_ID")
            or os.environ.get("AGENTPULSE_WORKFLOW_ID", "default-workflow")
        )

        if enabled is not None:
            self._enabled = enabled
        else:
            env_enabled = os.environ.get("REEPROV_ENABLED") or os.environ.get("AGENTPULSE_ENABLED")
            if env_enabled is not None:
                self._enabled = env_enabled.lower() == "true"
            else:
                self._enabled = bool(self._ingest_key)

        self._timeout = timeout
        self._max_retries = max_retries
        fail_open_env = os.environ.get("REEPROV_FAIL_OPEN") or os.environ.get("AGENTPULSE_FAIL_OPEN")
        self._fail_open = fail_open if fail_open_env != "false" else False

    @property
    def is_enabled(self) -> bool:
        return self._enabled

    # ── Run Lifecycle ──────────────────────────────────────────────────────────

    def start_run(
        self,
        summary: str,
        *,
        run_id: Optional[str] = None,
        project_id: Optional[str] = None,
        project_name: Optional[str] = None,
        workflow_id: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> str:
        """Start a new run. Returns the generated or confirmed run_id."""
        if not self._enabled:
            return run_id or f"noop-{_short_id()}"

        active_run_id = run_id or f"{self._project_id}-{_short_id()}"
        body: dict[str, Any] = {
            "run_id": active_run_id,
            "project_id": project_id or self._project_id,
            "project_name": project_name or self._project_name,
            "workflow_id": workflow_id or self._workflow_id,
            "summary": summary,
        }
        if metadata:
            body["metadata"] = metadata

        res = self._post("/api/runs/start", body)
        if isinstance(res, dict) and "run_id" in res:
            return str(res["run_id"])
        return active_run_id

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

    # ── Trace Events ───────────────────────────────────────────────────────────

    def emit_trace_event(self, event: dict[str, Any]) -> None:
        """Emit a single trace event."""
        self.emit_trace_events([event])

    def emit_trace_events(self, events: list[dict[str, Any]]) -> None:
        """Emit multiple trace events in batch."""
        if not self._enabled or not events:
            return
        self._check_ingest_result("trace events", self._post("/api/traces/events", {"events": events}))

    # ── Semantic Helper Methods ────────────────────────────────────────────────

    def model_call_completed(
        self,
        run_id: str,
        *,
        model: str,
        provider: str,
        response: Any,
        prompt: Optional[str] = None,
        messages: Optional[list[dict[str, Any]]] = None,
        node_id: Optional[str] = None,
        step_id: Optional[str] = None,
        duration_ms: Optional[int] = None,
        cost_usd: Optional[float] = None,
        input_tokens: Optional[int] = None,
        output_tokens: Optional[int] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        """Record model execution event and boundary."""
        if not self._enabled:
            return
        now = _now()
        event_meta: dict[str, Any] = {
            "model": model,
            "provider": provider,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        }
        if metadata:
            event_meta.update(metadata)

        self.emit_trace_event({
            "event_id": f"evt-{_short_id()}",
            "run_id": run_id,
            "workflow_id": self._workflow_id,
            "timestamp": now,
            "event_type": "model_call_completed",
            "status": "completed",
            "node_id": node_id,
            "cost_usd": cost_usd,
            "duration_ms": duration_ms,
            "input_summary": prompt[:500] if prompt else None,
            "metadata": event_meta,
        })

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
            "metadata": metadata,
        })

    def tool_call_completed(
        self,
        run_id: str,
        *,
        tool_name: str,
        arguments: Any,
        output: Optional[Any] = None,
        error: Optional[str] = None,
        permission_class: str = "read_only",
        node_id: Optional[str] = None,
        step_id: Optional[str] = None,
        duration_ms: Optional[int] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        """Record tool execution event and boundary."""
        if not self._enabled:
            return
        now = _now()
        event_meta: dict[str, Any] = {
            "tool_name": tool_name,
            "permission_class": permission_class,
        }
        if metadata:
            event_meta.update(metadata)

        self.emit_trace_event({
            "event_id": f"evt-{_short_id()}",
            "run_id": run_id,
            "workflow_id": self._workflow_id,
            "timestamp": now,
            "event_type": "tool_call_completed",
            "status": "failed" if error else "completed",
            "node_id": node_id,
            "duration_ms": duration_ms,
            "error_message": error,
            "metadata": event_meta,
        })

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
            "metadata": metadata,
        })

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
        """Record an evaluation outcome event."""
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
                "recommendation": recommendation,
            },
        }
        if node_id:
            event["node_id"] = node_id
        if output_summary:
            event["output_summary"] = output_summary
        self.emit_trace_event(event)

    def artifact_created(
        self,
        run_id: str,
        artifact_ref: str,
        artifact_type: str,
        *,
        output_summary: Optional[str] = None,
        node_id: Optional[str] = None,
    ) -> None:
        """Record creation of an execution artifact."""
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

    def checkpoint_saved(
        self,
        run_id: str,
        checkpoint_id: str,
        state: Any,
        *,
        node_id: Optional[str] = None,
        step_id: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        """Record a checkpoint event; this does not create a restorable snapshot."""
        if not self._enabled:
            return
        self.capture_boundary(run_id, {
            "boundaryType": "checkpoint",
            "name": f"checkpoint:{checkpoint_id}",
            "stepId": step_id,
            "nodeId": node_id,
            "output": state,
            "declaredSideEffectClass": "read_only",
            "metadata": {"checkpoint_id": checkpoint_id, **(metadata or {})},
        })

    # ── Replay-Grade Boundary Capture ──────────────────────────────────────────

    def capture_boundary(self, run_id: str, boundary: dict[str, Any]) -> None:
        """Emit a replay-grade execution boundary to Reeprov."""
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
            self._check_ingest_result("boundary", self._post("/api/traces/boundaries", payload))
        except Exception as e:
            if self._fail_open:
                print(f"[Reeprov] Non-fatal boundary capture error: {e}", file=sys.stderr)
            else:
                raise

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
        metadata: Optional[dict[str, Any]] = None,
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
            "metadata": metadata,
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
        metadata: Optional[dict[str, Any]] = None,
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
            "metadata": metadata,
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

    # ── Internal Transport ─────────────────────────────────────────────────────

    def _check_ingest_result(self, kind: str, result: Any) -> None:
        if not isinstance(result, dict) or not isinstance(result.get("rejected"), int) or result["rejected"] == 0:
            return
        reasons = "; ".join(str(error.get("message", "unknown reason")) for error in result.get("errors", []))
        error = ReeprovError(f"Reeprov rejected {result['rejected']} {kind} record(s): {reasons or 'unknown reason'}", 422, False)
        if self._fail_open:
            print(f"[Reeprov] {error}", file=sys.stderr)
        else:
            raise error

    def _post(self, path: str, body: dict[str, Any]) -> Any:
        url = f"{self._url}{path}"
        data = json.dumps(body).encode("utf-8")
        last_error: Optional[Exception] = None

        for attempt in range(self._max_retries + 1):
            req = urllib.request.Request(
                url,
                data=data,
                headers={
                    "Content-Type": "application/json",
                    "x-reeprov-key": self._ingest_key,
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                    if resp.status < 400:
                        content_type = resp.headers.get("Content-Type", "")
                        if "application/json" in content_type:
                            return json.loads(resp.read().decode("utf-8"))
                        return {}
                    last_error = ReeprovError(f"Reeprov API Error {resp.status}: {path}", resp.status, True)
            except urllib.error.HTTPError as e:
                # 401/403 or 4xx: fast-fail non-retryable client errors
                if e.code in (401, 403) or (400 <= e.code < 500):
                    err = ReeprovError(f"Reeprov request failed: {e.code} {path}", e.code, False)
                    if self._fail_open:
                        print(f"[Reeprov] Non-retryable error ({e.code}): {path}", file=sys.stderr)
                        return {}
                    raise err from e
                # 5xx server error: transient, retry
                last_error = ReeprovError(f"Reeprov server error {e.code}: {path}", e.code, True)
            except Exception as e:
                last_error = e

            if attempt < self._max_retries:
                time.sleep(0.05 * (2 ** attempt))

        if self._fail_open:
            print(f"[Reeprov] Telemetry request to {path} failed: {last_error}", file=sys.stderr)
            return {}
        raise last_error or ReeprovError(f"Reeprov request failed: {path}")


AgentPulseClient = ReeprovClient
