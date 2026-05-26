---
name: project-phase
description: Current phase and commit status for AgentPulse
metadata:
  type: project
---

Task 7 (Global Dashboard Access + Overview IA Polish) is complete as of 2026-05-26.

**Why:** Dashboard felt like a partially gated demo — only the scanner had an access gate. All /dashboard/* routes now share a single global access gate backed by AGENTPULSE_ACCESS_KEY.

**State:**
- 709 tests pass (60 new tests for Task 7)
- Lint, tsc, build all pass

**Key changes:**
- `POST /api/auth/validate` — shared key validation endpoint
- `lib/auth/dashboardAuthContext.tsx` — React context with `isUnlocked`, `lock()`, `onUnauthorized()`
- `components/dashboard/DashboardShell.tsx` — global access gate at layout level
- `app/dashboard/layout.tsx` — now just `<DashboardShell>{children}</DashboardShell>`
- `components/layout/NavBar.tsx` — accepts `onLock` prop, shows "Lock dashboard" button
- `components/dashboard/DashboardClient.tsx` — removed isolated scanner gate, uses `useDashboardAuth()` for 401 handling
- `app/dashboard/page.tsx` — Overview redesigned with product mode cards (Live Proof Runs, Static Repository Intelligence, Workflow Registry, Saved Proof Reports)
- `components/proof-layer/WorkflowGallery.tsx` — overflow/truncation fixes
- `docs/ARCHITECTURE.md` — Global Dashboard Access Gate section added
- `docs/ROADMAP.md` — Task 7 entry added
- `docs/product_direction.md` — created with operating modes documentation
- `README.md` — Access Model and Operating Modes sections added

**How to apply:** When planning next work, the dashboard is fully gated. The scanner no longer has its own isolated access model. AGENTPULSE_INGEST_KEY remains separate for runtime trace ingestion.
