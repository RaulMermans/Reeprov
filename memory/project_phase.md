---
name: project-phase
description: Current phase and commit status for AgentPulse
metadata:
  type: project
---

Commit 8 (dashboard semantics + report readability) is complete as of 2026-05-14.

**Why:** Real-world scans showed "Unknown AI project" for repos that use AI SDKs (e.g. website-auditor). Overlapping recommendations and vague project types made reports feel like engineering dumps rather than audit reports.

**State:**
- 148 tests pass (32 new tests for Commit 8)
- Lint, tsc, build all pass
- `ai_application` project type added — repos with AI SDK imports, AI API env names, or AI function patterns but no explicit manifest
- `projectTypeDescription()` added to format utils
- `lib/reports/recommendations.ts` — project-type-aware, de-duplicated recommendations
- `lib/reports/findingSummary.ts` — severity/category/secret-context counts
- `lib/reports/scoreExplanations.ts` — positives, penalties, related finding count per category
- Dashboard: score rows expand with positives/penalties; project card shows type description; finding table has summary bar + category badge + context label; detected sections adapt to project type
- Markdown export: project type description inline, Score Explanations section, Findings Summary section
- `NEXT_PUBLIC_AGENTPULSE_VERSION` env var supported (defaults to "local")
- CLAUDE.md invariants updated for ai_application, recommendation de-dup, report semantics

**Next commit:** Commit 9 — Scan history (persist redacted reports, score trend chart, finding diff). Or Tool Auditor behind feature flag if scanner/report quality feels stable enough for real LLM auditing.

**How to apply:** When planning next work, start from Commit 9 scope. Reports now read as interpreted audit outputs, not raw finding dumps.
