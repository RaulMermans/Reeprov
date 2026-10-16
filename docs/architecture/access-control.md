# Architecture: Centralized Access Control

Reeprov implements a unified, mode-aware authorization framework in `lib/auth/accessControl.ts` centered around `authorizeRequest(request, options)`.

## Capabilities

The system classifies operations into five granular capabilities:

1. `HEALTH_PUBLIC`: Public health and liveness checks (`/api/health`, `/api/auth/session`, etc.). No credentials required.
2. `INGEST`: High-throughput ingestion of runs, traces, boundaries, and status updates. Requires a valid project-scoped ingest key (`ap_live_...`) or deployment ingest key.
3. `DASHBOARD_READ`: Read access to projects, runs, checkpoints, lineage, comparisons, evals, and baselines.
4. `DASHBOARD_WRITE`: Mutations to projects, evals, experiments, baselines, and fork operations.
5. `ADMIN`: Administrative operations such as schema migrations (`/api/admin/migrate`) and demo seeding (`/api/demo`).

## Ingest Isolation Boundary

Ingest credentials are strictly isolated from dashboard read/write credentials:

- Ingest keys starting with `ap_live_` are explicitly rejected when presented to `DASHBOARD_READ`, `DASHBOARD_WRITE`, or `ADMIN` endpoints with HTTP `403 Forbidden` (`ingest_key_disallowed`).
- Scoped ingest keys tied to Project A are rejected with HTTP `403 Forbidden` (`forbidden_project_scope`) if used to emit traces for Project B.

## Constant-Time Comparison

All sensitive token comparisons utilize `crypto.timingSafeEqual` to eliminate timing-attack side channels.
