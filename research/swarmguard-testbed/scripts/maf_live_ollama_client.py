"""Research-owned live chat client for the H2-B MAF observer.

Uses Microsoft Agent Framework's official ``OllamaChatClient``. This module does
not replace upstream agents or tools. It only records the local HTTP chat
completion that ``OllamaChatClient`` already performs and refuses to label a
call ``live_llm`` unless that HTTP response completed.
"""

from __future__ import annotations

import shutil
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import httpx
from agent_framework import ChatResponse, Content, Message, ResponseStream
from agent_framework_ollama import OllamaChatClient
from ollama import AsyncClient

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


def redact_text(value: str) -> str:
    """Redact credential-shaped and email-shaped substrings. Leave ordinary text intact."""
    import re

    redacted = re.sub(
        r"(?i)\b(sk-[a-z0-9_\-]{8,}|ghp_[a-z0-9]{8,}|github_pat_[a-z0-9_]{8,}|xox[baprs]-[a-z0-9\-]+|AKIA[0-9A-Z]{16})\b",
        "[REDACTED_SECRET]",
        value,
    )
    redacted = re.sub(
        r"(?i)\b(api[_-]?key|authorization|bearer|token|password|secret)\b\s*[:=]\s*\S+",
        r"\1=[REDACTED_SECRET]",
        redacted,
    )
    redacted = re.sub(
        r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b",
        "[REDACTED_EMAIL]",
        redacted,
    )
    return redacted


def _infer_agent_name(messages: Sequence[Message], options: Mapping[str, Any]) -> str:
    opt_instr = str(options.get("instructions") or "")
    sys_texts = (
        opt_instr
        + " "
        + " ".join((m.text or "") for m in messages if getattr(m, "role", "") == "system")
    ).lower()
    if "frontline support triage" in sys_texts:
        return "triage_agent"
    if "order and shipping inquiries" in sys_texts:
        return "order_agent"
    if "process refund requests" in sys_texts:
        return "refund_agent"
    if "product return requests" in sys_texts:
        return "return_agent"
    return str(options.get("agent_name") or "unknown_agent")


def _serialize_messages(messages: Sequence[Message]) -> list[dict[str, Any]]:
    serialized: list[dict[str, Any]] = []
    for msg in messages:
        contents_summary: list[dict[str, Any]] = []
        for content in getattr(msg, "contents", []) or []:
            content_type = getattr(content, "type", "unknown")
            entry: dict[str, Any] = {"type": content_type}
            if content_type == "text":
                entry["text"] = redact_text(str(getattr(content, "text", "") or ""))
            elif content_type == "function_call":
                entry["name"] = getattr(content, "name", "")
                entry["call_id"] = getattr(content, "call_id", "")
                entry["arguments"] = getattr(content, "arguments", None)
            elif content_type == "function_result":
                entry["call_id"] = getattr(content, "call_id", "")
                entry["result"] = redact_text(str(getattr(content, "result", "")))
            contents_summary.append(entry)
        text = getattr(msg, "text", None)
        serialized.append(
            {
                "role": str(getattr(msg, "role", "")),
                "author_name": getattr(msg, "author_name", None),
                "text": redact_text(text) if isinstance(text, str) else text,
                "contents": contents_summary,
            }
        )
    return serialized


def _usage_record(response: ChatResponse) -> dict[str, Any]:
    details = getattr(response, "usage_details", None)
    if isinstance(details, Mapping):
        prompt = details.get("input_token_count")
        completion = details.get("output_token_count")
    else:
        prompt = getattr(details, "input_token_count", None) if details is not None else None
        completion = getattr(details, "output_token_count", None) if details is not None else None
    if isinstance(prompt, int) and isinstance(completion, int):
        return {
            "usage_status": "provider_reported",
            "prompt_tokens": prompt,
            "completion_tokens": completion,
            "total_tokens": prompt + completion,
            "source": "ollama.prompt_eval_count+eval_count",
        }
    return {"usage_status": "unavailable"}


def _loopback_chat_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.hostname in LOOPBACK_HOSTS and parsed.path == "/api/chat"


class RecordingOllamaChatClient(OllamaChatClient):
    """Official Ollama client plus a research-side record of each completed HTTP call."""

    def __init__(
        self,
        *,
        model_call_sink: list[dict[str, Any]],
        http_event_sink: list[dict[str, Any]],
        active_agent_setter: Callable[[str], None],
        model: str,
        host: str,
        request_bounds: Mapping[str, Any],
        timeout_seconds: float,
    ) -> None:
        self._http_events = http_event_sink

        async def _on_response(response: httpx.Response) -> None:
            # httpx awaits response hooks. A synchronous hook returning None is
            # itself awaited and aborts a completed HTTP response.
            request = response.request
            self._http_events.append(
                {
                    "method": request.method,
                    "url": str(request.url),
                    "status_code": response.status_code,
                    "http_version": response.http_version,
                }
            )

        ollama_client = AsyncClient(
            host=host,
            timeout=httpx.Timeout(timeout_seconds, connect=10.0),
            event_hooks={"response": [_on_response]},
        )
        super().__init__(model=model, host=host, client=ollama_client)
        self._sink = model_call_sink
        self._set_active_agent = active_agent_setter
        self._bounds = dict(request_bounds)
        self._call_seq = 0

    def _inner_get_response(
        self,
        *,
        messages: Sequence[Message],
        stream: bool,
        options: Mapping[str, Any],
        **kwargs: Any,
    ) -> Awaitable[ChatResponse] | ResponseStream[Any, ChatResponse]:
        if stream:
            raise RuntimeError("H2-B live capture expects a non-streaming Ollama chat call.")
        agent_name = _infer_agent_name(messages, options)
        self._set_active_agent(agent_name)
        bounded = dict(options)
        # The workflow passes Agent Framework options that Ollama's chat() method
        # rejects. The official client already drops tool_choice; this drops the
        # other unsupported key it currently forwards.
        bounded.pop("allow_multiple_tool_calls", None)
        bounded.update(self._bounds)
        inner = super()._inner_get_response(messages=messages, stream=False, options=bounded, **kwargs)
        serialized_in = _serialize_messages(messages)
        started_at = datetime.now(timezone.utc).isoformat()
        t0 = time.perf_counter()
        http_cursor = len(self._http_events)

        async def _get() -> ChatResponse:
            self._call_seq += 1
            error_message: str | None = None
            response: ChatResponse | None = None
            try:
                response = await inner  # type: ignore[misc]
                return response
            except Exception as exc:
                error_message = str(exc)
                raise
            finally:
                duration_ms = round((time.perf_counter() - t0) * 1000, 3)
                new_http = [
                    event
                    for event in self._http_events[http_cursor:]
                    if event.get("method") == "POST" and _loopback_chat_url(str(event.get("url", "")))
                ]
                http_event = new_http[-1] if new_http else None
                completed = bool(http_event and http_event.get("status_code") == 200 and error_message is None and response is not None)
                contents = list(getattr(response, "messages", [Message(role="assistant", contents=[])])[0].contents) if response and response.messages else []
                output_text = response.text if response is not None and response.text else None
                if isinstance(output_text, str):
                    output_text = redact_text(output_text)
                reported_model = str(getattr(response, "model", None) or self.model or "")
                usage = _usage_record(response) if response is not None else {"usage_status": "unavailable"}
                tool_names = [
                    str(getattr(content, "name", ""))
                    for content in contents
                    if getattr(content, "type", "") == "function_call"
                ]
                self._sink.append(
                    {
                        "response_id": f"maf_ollama_resp_{self._call_seq}",
                        "agent_id": agent_name,
                        "provider": "ollama",
                        "model": reported_model if completed else str(self.model or reported_model),
                        "requested_model": str(self.model or ""),
                        "execution_mode": "live_llm" if completed else "mocked",
                        "provider_http_completed": completed,
                        "started_at": started_at,
                        "duration_ms": duration_ms,
                        "input_messages": serialized_in,
                        "output_text": output_text,
                        "output_contents": [
                            {
                                "type": getattr(content, "type", ""),
                                "text": redact_text(str(getattr(content, "text", "")))
                                if getattr(content, "text", None)
                                else None,
                                "name": getattr(content, "name", None),
                                "call_id": getattr(content, "call_id", None),
                                "arguments": getattr(content, "arguments", None),
                            }
                            for content in contents
                            if getattr(content, "type", "") != "usage"
                        ],
                        "http": http_event,
                        "usage": usage,
                        "decision_metadata": {
                            "decision": "live_model_response" if completed else "live_model_request_failed",
                            "assertion_claim": output_text if output_text and output_text.strip() else None,
                            "tool_names_requested": tool_names,
                            "error": error_message,
                        },
                        "finish_reason": str(getattr(response, "finish_reason", "") or "") if response is not None else None,
                    }
                )

        return _get()


async def probe_ollama_runtime(host: str) -> dict[str, Any]:
    """Read the local daemon's own process table. Does not infer GPU use from RAM."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        version = await client.get(f"{host.rstrip('/')}/api/version")
        version.raise_for_status()
        ps = await client.get(f"{host.rstrip('/')}/api/ps")
        ps.raise_for_status()
    loaded = ps.json().get("models") or []
    summarized = []
    for item in loaded:
        size_vram = item.get("size_vram")
        summarized.append(
            {
                "name": item.get("name") or item.get("model"),
                "digest": item.get("digest"),
                "size": item.get("size"),
                "size_vram": size_vram,
                "processor_field": item.get("details", {}).get("family") if isinstance(item.get("details"), dict) else None,
                "details": item.get("details"),
                "vram_bytes_reported": size_vram,
                "hardware_acceleration": "not_confirmed",
            }
        )
    dri = __import__("pathlib").Path("/dev/dri")
    return {
        "version": version.json(),
        "loaded_models": summarized,
        "gpu_probe": {
            "nvidia_smi": shutil.which("nvidia-smi") is not None,
            "rocm_smi": shutil.which("rocm-smi") is not None,
            "dev_dri": dri.exists(),
            "vram_field_interpretation": (
                "Ollama size_vram is recorded as reported. It is not treated as proof of a GPU "
                "when nvidia-smi, rocm-smi, and /dev/dri are absent."
            ),
        },
    }
