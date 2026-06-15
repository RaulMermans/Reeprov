# Deployment Checklist

AgentPulse is a private personal dashboard. Deploy it only with server-side secrets, read-only GitHub access, and API access-key protection.

## Local Validation

- Run `npm install` to validate `package-lock.json`.
- Run `npm run lint`.
- Run `npm run typecheck`.
- Run `npm run test`.
- Run `npm run build`.
- Run `npm run ci` before merge.

## CI Quality Gate

GitHub Actions runs CI on pull requests and pushes to `main`. The workflow installs dependencies with `npm ci`, then runs lint, typecheck, tests, and the production build.

Normal PR CI does not require `GITHUB_TOKEN`, `OPENAI_API_KEY`, or `AGENTPULSE_ACCESS_KEY`. Tests and build steps must use mock or static inputs only. CI must never execute scanned repository code or install scanned repository dependencies.

If a future scheduled scan workflow is added, it should use only a server-side read-only GitHub token and must preserve the same scanner constraint: repository contents are fetched as untrusted evidence and never executed.

## Vercel Environment Variables

| Variable                | Required          | Notes                                                                                         |
|-------------------------|-------------------|-----------------------------------------------------------------------------------------------|
| `DATABASE_URL`          | **Yes**           | Postgres connection string (Neon, Vercel Postgres, etc.). `getStores()` throws on startup in production if this is unset — there is no file-store fallback in production. |
| `AGENTPULSE_ACCESS_KEY` | **Yes**           | Long random string. Dashboard and scanner gate. Never expose to client.                       |
| `AGENTPULSE_INGEST_KEY` | **Yes**           | Separate from access key. Used by external AI projects (e.g. BlogAgent) to POST trace events. Must differ from `AGENTPULSE_ACCESS_KEY` in production. |
| `GITHUB_TOKEN`          | For scanner       | Fine-grained read-only token. `contents: read`, selected repos, 30–90 day expiration.        |
| `ENABLE_LLM_AUDITORS`   | No                | `false` (default). Do not enable until scanner is confirmed working.                          |
| `LLM_PROVIDER`          | Conditional       | `openai` or `anthropic`. Required only when LLM auditors enabled.                             |
| `OPENAI_API_KEY`        | Conditional       | Server-side only. Required when `LLM_PROVIDER=openai` and auditors enabled.                   |
| `ANTHROPIC_API_KEY`     | Conditional       | Server-side only. Required when `LLM_PROVIDER=anthropic` and auditors enabled.                |
| `AGENTPULSE_STORE_DIR`  | Local-only        | File-backed store directory for local dev without Postgres. Ignored once `DATABASE_URL` is set. Not valid in production. |

**Never use `NEXT_PUBLIC_` for any token, access key, or provider API key.**

### Durable Storage (Postgres)

Production persistence uses Postgres via `lib/db/`. `lib/db/getStores.ts` selects `pg*Store` implementations whenever `DATABASE_URL` is set, and throws a startup error if `NODE_ENV=production` and `DATABASE_URL` is unset — there is no silent fallback to file storage in production.

- Tables are prefixed `ap_`: `ap_integrations`, `ap_runs`, `ap_trace_events`, `ap_tool_calls`, `ap_eval_results`, `ap_reports`, `ap_workflow_specs`.
- Schema migration (`lib/db/migrate.ts`) is idempotent (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`) and safe to run on every cold start.
- `ensureSchema()` runs automatically before every Postgres store call (via a wrapping proxy in `getStores.ts`), so a fresh database self-migrates on first request.

**Manual migration:**
- Local: `npm run db:migrate` (runs `lib/db/migrate.ts#ensureSchema` against `DATABASE_URL`).
- Deployed: `POST /api/admin/migrate` with header `x-agentpulse-key: $AGENTPULSE_ACCESS_KEY`. Returns `{ ok: true, ...storageHealth }`.

### Local dev without Postgres

If `DATABASE_URL` is unset locally, AgentPulse falls back to file-backed stores under `AGENTPULSE_STORE_DIR` (default `.agentpulse/` in cwd). This path is for local development and tests only — production always requires `DATABASE_URL`.

### Health Checks

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /api/health` | None | Lightweight liveness check, no database access. Returns `{ ok, environment, version, time }`. Safe for uptime monitors. |
| `GET /api/storage/health` | `x-agentpulse-key` | Storage diagnostics: `{ driver, databaseUrlPresent, tablesPresent, missingTables, runCount, environment, version }`. In production this should report `driver: "postgres"`, all 7 `ap_%` tables in `tablesPresent`, and `missingTables: []`. |
| `POST /api/admin/migrate` | `x-agentpulse-key` | Runs `ensureSchema()` then returns `{ ok: true, ...storageHealth }`. Use after provisioning a new database or to confirm migrations applied. |

`environment` is derived from Vercel's `VERCEL_ENV` (`production` / `preview` / `development`), falling back to `NODE_ENV`. `version` is the short Vercel git commit SHA (`VERCEL_GIT_COMMIT_SHA`), falling back to the `package.json` version.

## GitHub Token Scope

- Use a fine-grained token.
- Grant contents read-only permission.
- Restrict repository access to selected repos only.
- Prefer a 30-90 day expiration.
- Rotate the token immediately if a scan reports a committed token.

## Access Key Setup

- Generate a long random value for `AGENTPULSE_ACCESS_KEY`.
- Store it only as a server-side Vercel environment variable.
- Enter it in the dashboard when prompted.
- Confirm `/api/repos` and `/api/scan` reject requests without `x-agentpulse-key`.

## ZIP Uploads on Vercel

Direct ZIP upload is limited to 4 MB on Vercel so `/api/scan-zip` stays below serverless function request body limits. Use GitHub repository scanning for larger repositories.

Uploaded ZIPs are parsed in memory, never persisted, and treated as untrusted input. AgentPulse never executes uploaded code, never installs uploaded dependencies, and blocks path traversal before scanning entries.

ZIP extraction has a hard safety limit of 2,000 total entries and 50 MB uncompressed content. Candidate text files are prioritized and capped at 800 scanned files; archives with more candidates still scan, but the report warns that lower-priority files were skipped. GitHub scanning is preferred for complete scans of larger repositories.

## LLM Auditor Feature Flag

The first Vercel deployment must use `ENABLE_LLM_AUDITORS=false`. Do not enable the Prompt Auditor until the static scan is confirmed working in production.

Staged rollout:
1. Deploy with `ENABLE_LLM_AUDITORS=false`. Confirm `/api/scan` returns results and the dashboard shows `Static only`.
2. Scan at least one repo in production and verify findings are correct with no secrets leaking in responses.
3. Only then set `ENABLE_LLM_AUDITORS=true` and add `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY` for the Anthropic provider).
4. Set `LLM_PROVIDER=openai` (or `anthropic`) to match the key provided.
5. Confirm the dashboard reports `Static + LLM Prompt Auditor` only when the prompt audit actually runs.
6. Roll back to `ENABLE_LLM_AUDITORS=false` immediately if LLM calls produce unexpected output or costs.

## Webpack Build Workaround

The `build` script uses `next build --webpack` instead of the default Turbopack bundler. This is required because Turbopack attempts to read from a local filesystem cache that times out in some environments (ETIMEDOUT on `.next/cache/webpack/*.pack`).

The webpack build succeeded despite a cache restore timeout on the first run — subsequent builds use a warm cache and are faster. Do not remove the `--webpack` flag or switch to `next build` without testing in the target environment first.

Vercel builds run in a clean environment each time, so the cache restore timeout is expected on every cold deploy. The webpack build still completes successfully.

## Private Deployment Checklist

- Enable Vercel Deployment Protection if available.
- Confirm all secrets are server-side environment variables.
- Confirm no secret variable uses `NEXT_PUBLIC_`.
- Confirm GitHub token access is read-only and selected-repo only.
- Deploy to a private staging environment before any broader exposure.

## Post-Deploy Smoke Tests

### Scanner
1. Visit `/dashboard`.
2. Enter access key.
3. Confirm `/api/repos` loads or returns mock repos if no GitHub token.
4. Call `/api/repos` without header and confirm 401.
5. Scan a sample repo.
6. Upload a ZIP under 4 MB and confirm it scans.
7. Upload a ZIP with more than 500 files but fewer than 800 candidate text files and confirm it scans without a file-count error.
8. Select a ZIP over 4 MB and confirm the dashboard recommends GitHub scanning before upload.
9. Confirm `.env*` files are ignored.
10. Confirm no secrets appear in the browser devtools response.
11. If `ENABLE_LLM_AUDITORS=false`, confirm no LLM call is made.
12. If `ENABLE_LLM_AUDITORS=true` and API key exists, confirm Prompt Auditor runs only on prompt evidence.

### Trace Ingestion
13. Run the seed script locally: `npm run seed:traces`.
14. Open `http://localhost:3000/dashboard/runs` and confirm the seeded Campaign Sandbox run appears.
15. Open the run detail page and confirm the trace timeline, model calls, eval results, and artifact are visible.
16. Confirm the run status badge shows `degraded` (the seed run has one failing eval by design).
17. Call `POST /api/runs/start` without a key and confirm 401.
18. Call `POST /api/traces/events` without a key and confirm 401.
19. Call `POST /api/traces/events` with a malformed event body and confirm 400 with an error message.
20. Call `POST /api/traces/events` with a duplicate `event_id` and confirm 200 with `{ appended: false }`.
21. Call `GET /api/runs` with the ingest key and confirm runs are listed.
22. If `AGENTPULSE_STORE_DIR=/tmp/agentpulse` on Vercel, confirm run data appears after ingestion.
   Note: data will be lost on redeployment or if a different function instance handles the request.

### Key Separation Check
23. Confirm `AGENTPULSE_ACCESS_KEY` ≠ `AGENTPULSE_INGEST_KEY` in production.
24. Call `POST /api/runs/start` with the access key and confirm it is accepted (fallback for local only).
   In production, only the ingest key should be shared with external projects.

## Rollback Advice

- First rollback step: set `ENABLE_LLM_AUDITORS=false` and redeploy or restart.
- If repository access is wrong, rotate or replace `GITHUB_TOKEN`.
- If access-key exposure is suspected, replace `AGENTPULSE_ACCESS_KEY`.
- If deployment posture is wrong, pause the Vercel deployment or enable Deployment Protection before further scans.
