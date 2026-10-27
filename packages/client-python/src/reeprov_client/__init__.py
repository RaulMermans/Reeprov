"""
Reeprov Python Client SDK

Official pure-Python client for Reeprov — local-first debugging
and reproducibility for AI agents.
"""

from .client import (
    ReeprovClient,
    ReeprovError,
    ReeprovIngestError,
    AgentPulseClient,
    AgentPulseError,
    SDK_NAME,
    SDK_VERSION,
)
from .canonical import canonical_json, canonical_sha256

__version__ = "0.2.0b1"
__all__ = [
    "ReeprovClient",
    "ReeprovError",
    "ReeprovIngestError",
    "SDK_NAME",
    "SDK_VERSION",
    "canonical_json",
    "canonical_sha256",
    "AgentPulseClient",
    "AgentPulseError",
    "__version__",
]
