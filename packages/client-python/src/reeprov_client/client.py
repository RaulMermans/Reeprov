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

from .canonical import canonical_sha256

SDK_NAME = "reeprov-client"
SDK_VERSION = "0.1.0b1"  # keep equal to __version__ / pyproject


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


class ReeprovIngestError(ReeprovError):
    """Raised (when fail_open is False) if Reeprov did not confirm every record."""

    def __init__(self, message: str, ack: dict[str, Any]):
        super().__init__(message, ack.get("http_status"), False)
        self.ack = ack


def _disabled_ack() -> dict[str, Any]:
    return {"ok": True, "delivery": "disabled", "accepted": 0, "duplicates": 0,
            "rejected": 0, "results": [], "errors": []}


def _describe(body: Any) -> str:
    if isinstance(body, dict):
        return str(body.get("message") or body.get("code") or "no detail")
    return "no detail"


def _to_ack(res: Optional[tuple[int, Any]], record_count: int) -> dict[str, Any]:
    """Converts an HTTP response into an acknowledgement. Missing records are never treated as stored."""
    if res is None:
        return {"ok": False, "delivery": "unreachable", "accepted": 0, "duplicates": 0,
                "rejected": record_count, "results": [],
                "errors": ["Reeprov unreachable; records were not confirmed."]}
    status, body = res
    if status in (401, 403) or not isinstance(body, dict) or not isinstance(body.get("rejected"), int):
        return {"ok": False, "delivery": "acknowledged", "http_status": status, "accepted": 0,
                "duplicates": 0, "rejected": record_count, "results": [],
                "errors": [f"HTTP {status}: {_describe(body)}"]}
    confirmed = int(body.get("accepted", 0)) + int(body.get("duplicates", 0)) + int(body.get("observations", 0))
    unaccounted = max(0, record_count - confirmed - body["rejected"])
    rejected = body["rejected"] + unaccounted
    errors = [str(e.get("message", "unknown reason")) for e in body.get("errors", []) if isinstance(e, dict)]
    if unaccounted:
        errors.append(f"{unaccounted} record(s) were not acknowledged by the server.")
    return {"ok": rejected == 0, "delivery": "acknowledged", "http_status": status,
            "accepted": int(body.get("accepted", 0)), "duplicates": int(body.get("duplicates", 0)),
            "rejected": rejected, "results": list(body.get("results", [])), "errors": errors}


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
        # Client-assigned boundary sequences and server-confirmed sequences per run.
        self._next_sequence: dict[str, int] = {}
        self._confirmed: dict[str, set[int]] = {}

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
        content_mode: Optional[str] = None,
    ) -> str:
        """Start a run (idempotent for a client-supplied run_id). Returns the run_id.

        content_mode: "STRUCTURE_ONLY" | "SAFE_CONTENT" | "FULL_CONTENT" (default SAFE_CONTENT).
        """
        if not self._enabled:
            return run_id or f"noop-{_short_id()}"

        active_run_id = run_id or f"{self._project_id}-{_short_id()}"
        body: dict[str, Any] = {
            "run_id": active_run_id,
            "project_id": project_id or self._project_id,
            "project_name": project_name or self._project_name,
            "workflow_id": workflow_id or self._workflow_id,
            "summary": summary,
            "sdk": {"name": SDK_NAME, "version": SDK_VERSION},
        }
        if content_mode:
            body["capture_policy"] = {"content_mode": content_mode}
        if metadata:
            body["metadata"] = metadata

        res = self._post("/api/runs/start", body)
        if res is not None and 200 <= res[0] < 300 and isinstance(res[1], dict):
            return str(res[1].get("run_id", active_run_id))
        message = (f"Reeprov did not confirm run start "
                   f"({'unreachable' if res is None else f'HTTP {res[0]}: {_describe(res[1])}'}).")
        if self._fail_open:
            print(f"[Reeprov] {message} Evidence for run {active_run_id} may be incomplete.", file=sys.stderr)
            return active_run_id
        raise ReeprovError(message, None if res is None else res[0], res is None)

    def complete_run(
        self,
        run_id: str,
        *,
        summary: Optional[str] = None,
        total_cost_usd: Optional[float] = None,
        total_duration_ms: Optional[int] = None,
        artifact_refs: Optional[list[str]] = None,
        output: Any = None,
    ) -> dict[str, Any]:
        """Mark a run as completed. `output` is stored as outcome evidence under the run's content mode."""
        if not self._enabled:
            return _disabled_ack()
        body: dict[str, Any] = {"run_id": run_id}
        if summary:
            body["summary"] = summary
        if total_cost_usd is not None:
            body["total_cost_usd"] = total_cost_usd
        if total_duration_ms is not None:
            body["total_duration_ms"] = total_duration_ms
        if artifact_refs:
            body["artifact_refs"] = artifact_refs
        if output is not None:
            body["output"] = output
        return self._lifecycle("/api/runs/complete", body, "run completion")

    def fail_run(self, run_id: str, *, error_summary: str) -> dict[str, Any]:
        """Mark a run as failed."""
        if not self._enabled:
            return _disabled_ack()
        return self._lifecycle("/api/runs/fail", {"run_id": run_id, "error_summary": error_summary}, "run failure")

    def _lifecycle(self, path: str, body: dict[str, Any], kind: str) -> dict[str, Any]:
        res = self._post(path, body)
        ok = res is not None and 200 <= res[0] < 300
        ack = {"ok": ok, "delivery": "unreachable" if res is None else "acknowledged",
               "http_status": None if res is None else res[0], "accepted": 1 if ok else 0,
               "duplicates": 0, "rejected": 0 if ok else 1, "results": [],
               "errors": [] if ok else ["unreachable" if res is None else f"HTTP {res[0]}: {_describe(res[1])}"]}
        return self._settle(kind, ack)

    # ── Trace Events ───────────────────────────────────────────────────────────

    def emit_trace_event(self, event: dict[str, Any]) -> dict[str, Any]:
        """Emit a single trace event. Returns the acknowledgement."""
        return self.emit_trace_events([event])

    def emit_trace_events(self, events: list[dict[str, Any]]) -> dict[str, Any]:
        """Emit multiple trace events in batch. Returns the acknowledgement."""
        if not self._enabled or not events:
            return _disabled_ack()
        return self._settle("trace event", _to_ack(self._post("/api/traces/events", {"events": events}), len(events)))

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
    ) -> dict[str, Any]:
        """Record model execution event and boundary."""
        if not self._enabled:
            return _disabled_ack()
        now = _now()
        event_meta: dict[str, Any] = {
            "model": model,
            "provider": provider,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        }
        if metadata:
            event_meta.update(metadata)

        event_ack = self.emit_trace_event({
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

        boundary_ack = self.capture_boundary(run_id, {
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
        return _merge_acks(event_ack, boundary_ack)

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
    ) -> dict[str, Any]:
        """Record tool execution event and boundary."""
        if not self._enabled:
            return _disabled_ack()
        now = _now()
        event_meta: dict[str, Any] = {
            "tool_name": tool_name,
            "permission_class": permission_class,
        }
        if metadata:
            event_meta.update(metadata)

        event_ack = self.emit_trace_event({
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

        boundary_ack = self.capture_boundary(run_id, {
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
        return _merge_acks(event_ack, boundary_ack)

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
    ) -> dict[str, Any]:
        """Record an evaluation outcome event."""
        if not self._enabled:
            return _disabled_ack()
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
        return self.emit_trace_event(event)

    def artifact_created(
        self,
        run_id: str,
        artifact_ref: str,
        artifact_type: str,
        *,
        output_summary: Optional[str] = None,
        node_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """Record creation of an execution artifact."""
        if not self._enabled:
            return _disabled_ack()
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
        return self.emit_trace_events([event])

    # ── Checkpoints ───────────────────────────────────────────────────────────

    def checkpoint_observed(
        self,
        run_id: str,
        checkpoint_id: str,
        state: Any = None,
        *,
        node_id: Optional[str] = None,
        step_id: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Checkpoint observation: records that a checkpoint was reached. Never restorable, never a boundary."""
        if not self._enabled:
            return {"ok": True, "delivery": "disabled", "status": "NOT_SENT"}
        return self._checkpoint_request(run_id, {
            "kind": "observe", "checkpoint_id": checkpoint_id, "step_id": step_id,
            "node_id": node_id, "state": state, "metadata": metadata,
        })

    def checkpoint_saved(self, run_id: str, checkpoint_id: str, state: Any, **kwargs: Any) -> dict[str, Any]:
        """Deprecated: records an observation only. Use checkpoint_observed() or register_checkpoint()."""
        return self.checkpoint_observed(run_id, checkpoint_id, state, **kwargs)

    def register_checkpoint(
        self,
        run_id: str,
        *,
        checkpoint_id: str,
        step_id: str,
        resume_step_index: int,
        state: dict[str, Any],
        adapter_id: str,
        adapter_version: str,
        step_index: Optional[int] = None,
        resume_step_id: Optional[str] = None,
        position: str = "AFTER_STEP",
        boundary_cursor: Optional[int] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Restorable-checkpoint capture.

        Sends the state snapshot with its canonical hash, the boundary cursor and
        the resume adapter identity. Reeprov validates the snapshot and advertises
        the checkpoint as restorable only after a compatible host resume is verified.
        """
        if not self._enabled:
            return {"ok": True, "delivery": "disabled", "status": "NOT_SENT"}
        return self._checkpoint_request(run_id, {
            "kind": "register",
            "checkpoint_id": checkpoint_id,
            "step_id": step_id,
            "step_index": step_index,
            "position": position,
            "resume_step_index": resume_step_index,
            "resume_step_id": resume_step_id,
            "boundary_cursor": self.confirmed_boundary_cursor(run_id) if boundary_cursor is None else boundary_cursor,
            "state": state,
            "state_hash": canonical_sha256(state),
            "adapter": {"adapter_id": adapter_id, "adapter_version": adapter_version},
            "metadata": metadata,
        })

    def confirmed_boundary_cursor(self, run_id: str) -> int:
        """Number of contiguous boundaries (from sequence 0) the server confirmed for a run."""
        confirmed = self._confirmed.get(run_id, set())
        cursor = 0
        while cursor in confirmed:
            cursor += 1
        return cursor

    def _checkpoint_request(self, run_id: str, body: dict[str, Any]) -> dict[str, Any]:
        clean = {k: v for k, v in body.items() if v is not None}
        res = self._post(f"/api/runs/{urllib.parse.quote(run_id, safe='')}/checkpoints", clean)
        data = res[1] if res is not None and isinstance(res[1], dict) else {}
        status = data.get("status", "REJECTED")
        ack = {
            "ok": res is not None and status != "REJECTED",
            "delivery": "unreachable" if res is None else "acknowledged",
            "http_status": None if res is None else res[0],
            "status": status,
            "code": data.get("code") or (None if res is not None else "UNREACHABLE"),
            "message": data.get("message"),
            "assessment": data.get("assessment"),
        }
        if not ack["ok"]:
            message = f"Reeprov rejected checkpoint {body.get('checkpoint_id')}: {ack['code'] or 'REJECTED'} {ack['message'] or ''}".strip()
            if self._fail_open:
                print(f"[Reeprov] {message}", file=sys.stderr)
            else:
                raise ReeprovIngestError(message, ack)
        return ack

    # ── Replay-Grade Boundary Capture ──────────────────────────────────────────

    def capture_boundary(self, run_id: str, boundary: dict[str, Any]) -> dict[str, Any]:
        """Emit one boundary with a stable client id and per-run sequence (idempotent on retry)."""
        if not self._enabled:
            return _disabled_ack()
        sequence = boundary.get("sequenceIndex")
        if sequence is None:
            sequence = self._next_sequence.get(run_id, 0)
            self._next_sequence[run_id] = sequence + 1
        else:
            self._next_sequence[run_id] = max(self._next_sequence.get(run_id, 0), int(sequence) + 1)
        record = {"runId": run_id, "startedAt": _now(), **{k: v for k, v in boundary.items() if v is not None}}
        record["sequenceIndex"] = sequence
        record.setdefault("boundaryId", f"bnd:{run_id}:{sequence}")

        ack = _to_ack(self._post("/api/traces/boundaries", {"boundaries": [record]}), 1)
        confirmed = self._confirmed.setdefault(run_id, set())
        for result in ack["results"]:
            if result.get("status") in ("ACCEPTED", "DUPLICATE") and isinstance(result.get("sequence_index"), int):
                confirmed.add(result["sequence_index"])
        return self._settle("boundary", ack)

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
    ) -> dict[str, Any]:
        """Capture a model invocation boundary."""
        return self.capture_boundary(run_id, {
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
    ) -> dict[str, Any]:
        """Capture a tool invocation boundary."""
        return self.capture_boundary(run_id, {
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
    ) -> dict[str, Any]:
        """Capture a retrieval operation boundary."""
        return self.capture_boundary(run_id, {
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
    ) -> dict[str, Any]:
        """Capture a memory operation boundary."""
        is_read = operation_type in ("read", "retrieval")
        return self.capture_boundary(run_id, {
            "boundaryType": "memory_read" if is_read else "memory_write",
            "name": f"{provider}:{operation_type}",
            "stepId": step_id,
            "nodeId": node_id,
            "input": {"key": key, "value": value, "operationType": operation_type},
            "output": {"status": "recorded"},
            "declaredSideEffectClass": "read_only" if is_read else "external_side_effect",
        })

    # ── Internal Transport ─────────────────────────────────────────────────────

    def _settle(self, kind: str, ack: dict[str, Any]) -> dict[str, Any]:
        if ack["ok"]:
            return ack
        message = f"Reeprov did not confirm {ack['rejected']} {kind} record(s): {'; '.join(ack['errors']) or 'unknown reason'}"
        if self._fail_open:
            print(f"[Reeprov] {message}", file=sys.stderr)
            return ack
        raise ReeprovIngestError(message, ack)

    def _post(self, path: str, body: dict[str, Any]) -> Optional[tuple[int, Any]]:
        """POST JSON. Returns (status, parsed body) for any response below 500.

        Network errors and 5xx are retried (safe: records are keyed). Returns
        None when the server could not be reached.
        """
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
                    return resp.status, _parse_json(resp.headers.get("Content-Type", ""), resp.read())
            except urllib.error.HTTPError as e:
                if e.code < 500:
                    return e.code, _parse_json(e.headers.get("Content-Type", "") if e.headers else "", e.read())
                last_error = ReeprovError(f"Reeprov server error {e.code}: {path}", e.code, True)
            except Exception as e:  # network error, timeout
                last_error = e

            if attempt < self._max_retries:
                time.sleep(0.05 * (2 ** attempt))

        print(f"[Reeprov] Request to {path} failed after retries: {last_error}", file=sys.stderr)
        return None


def _parse_json(content_type: str, raw: bytes) -> Any:
    if "application/json" not in content_type:
        return {}
    try:
        return json.loads(raw.decode("utf-8"))
    except ValueError:
        return {}


def _merge_acks(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": a["ok"] and b["ok"],
        "delivery": a["delivery"] if a["delivery"] != "acknowledged" else b["delivery"],
        "http_status": b.get("http_status") or a.get("http_status"),
        "accepted": a["accepted"] + b["accepted"],
        "duplicates": a["duplicates"] + b["duplicates"],
        "rejected": a["rejected"] + b["rejected"],
        "results": a["results"] + b["results"],
        "errors": a["errors"] + b["errors"],
    }


AgentPulseClient = ReeprovClient
