"""
AgentPulse Python Client SDK (Legacy Compatibility Layer)

This module re-exports ReeprovClient and ReeprovError for backwards compatibility.
New code should import from reeprov_client directly:
  from reeprov_client import ReeprovClient
"""

from reeprov_client import (
    ReeprovClient,
    ReeprovError,
    AgentPulseClient,
    AgentPulseError,
    __version__,
)

__all__ = [
    "ReeprovClient",
    "ReeprovError",
    "AgentPulseClient",
    "AgentPulseError",
    "__version__",
]
