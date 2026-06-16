---
name: project-phase
description: Current phase, last known commit, and test count
metadata:
  type: project
---

Production QA pass on real BlogAgent run complete (2026-06-16).
Run ID: 910b2ce1-be0b-49e6-9dd1-eb1cc1b6976a

Last deployed commit: 7df8d81 — Add production health checks and durable-storage deployment docs
Production URL: https://agent-pulse-alpha.vercel.app

Test count after QA fixes: 1071 passing across 46 test files.

Storage: Postgres on Vercel (`driver: postgres`, 8 runs in production, all 7 tables present, missingTables=[]).

**State:**
- Tasks 11 + 12 complete (Integration Kit + Postgres durable storage)
- Run-intelligence dashboard tested against real BlogAgent data (102 trace events, 37 nodes, 4 evals)
- 4 defects fixed in this session (see commit history)

**Key fixes applied in QA session:**
- `app/dashboard/runs/[runId]/page.tsx` — eval score in criticalFindings panel now uses `formatPercent()` not raw number
- `app/dashboard/runs/[runId]/page.tsx` — model call latency now shown in raw trace view via `deriveEventDurationMs`
- `components/proof-layer/ToolCallsPanel.tsx` — tool durations now use `deriveEventDurationMs` (reads `metadata.latency_ms` fallback)
- `lib/runs/runIntelligence.ts:buildWorkflowMap` — BlogAgent canonical map no longer appends internal implementation nodes (was 37 nodes → now clean 10-node pipeline map)

**How to apply:** Next work builds on the validated run-intelligence dashboard. BlogAgent emits latency as `metadata.latency_ms`, not `duration_ms`. Always use `deriveEventDurationMs()` for display.

[[feedback-instrument-events]]
