---
name: project-phase
description: Current phase, last known commit, and test count
metadata:
  type: project
---

Workflow graph UX polish complete (2026-06-24). 1120 tests passing across 48 test files.

Production smoke test: commit 1c98d77. Real BlogAgent run validated.
Production URL: https://agent-pulse-alpha.vercel.app

**State:**
- Progressive disclosure workflow graph implemented
- `runGraph.ts` `extraNodes` field: spec mode shows only spec nodes as primary; internal observed nodes go to `extraNodes` (accordion in RunWorkflowGraph)
- `groupRunIssues()` added to `runIntelligence.ts` — groups duplicate issues by stage+message
- IssuesPanel uses grouped issues with `×N` count badge
- "Promote to spec" label only shows when no workflow spec is active (`!workflow`)
- `RunWorkflowGraph` has exactly one mode badge (registered_spec OR inferred, never both)

**Key architecture:**
- `RunGraph.nodes` = primary (spec) nodes; `RunGraph.extraNodes` = extra internal observed nodes
- `groupRunIssues(issues)` → `GroupedRunIssue[]` with count + allIds
- BlogAgent emits latency as `metadata.latency_ms`, not `duration_ms`. Always use `deriveEventDurationMs()`.

[[feedback-instrument-events]]
