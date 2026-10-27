"""
Canonical JSON + SHA-256, byte-compatible with the Reeprov server
(lib/core/capture/hashing.ts) and the TypeScript SDK.

Compatibility notes: integral floats serialize like JavaScript (1.0 -> "1");
NaN/Infinity -> null; dict keys are sorted by code point, which matches the
server for keys without astral (non-BMP) characters.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any


def _number(value: float | int) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if not math.isfinite(value):
        return "null"
    if value == 0:
        return "0"
    if value.is_integer() and abs(value) < 1e21:
        return str(int(value))
    text = repr(value)
    if "e" in text:
        mantissa, exponent = text.split("e")
        sign = "-" if exponent.startswith("-") else "+"
        text = f"{mantissa}e{sign}{int(exponent.lstrip('+-'))}"
    return text


def canonical_json(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return _number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, (set, frozenset)):
        return canonical_json(list(value))
    if isinstance(value, dict):
        parts = [
            f"{json.dumps(str(key), ensure_ascii=False)}:{canonical_json(val)}"
            for key, val in sorted(value.items(), key=lambda kv: str(kv[0]))
        ]
        return "{" + ",".join(parts) + "}"
    return json.dumps(str(value), ensure_ascii=False)


def canonical_sha256(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()
