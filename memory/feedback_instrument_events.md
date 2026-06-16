---
name: feedback-instrument-events
description: BlogAgent stores latency as metadata.latency_ms, not the top-level duration_ms field — always use deriveEventDurationMs() for display
metadata:
  type: feedback
---

Use `deriveEventDurationMs(event)` (from `lib/runs/runIntelligence`) whenever displaying duration for a tool call or model call event. Never read `event.duration_ms` directly for display.

**Why:** BlogAgent (and likely other connected projects) emit latency as `metadata.latency_ms`, not the top-level `duration_ms` field. `deriveEventDurationMs` checks both with the right fallback order.

**How to apply:** Any new component that shows tool/model latency must use `deriveEventDurationMs`. The existing `ToolCallsPanel` was patched in this session.
