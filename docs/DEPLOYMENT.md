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

- `GITHUB_TOKEN`: server-side fine-grained GitHub token.
- `AGENTPULSE_ACCESS_KEY`: server-side long random private key for `x-agentpulse-key`.
- `ENABLE_LLM_AUDITORS`: default `false`.
- `LLM_PROVIDER`: `openai` for the first implemented provider.
- `OPENAI_API_KEY`: server-side only, required only when LLM auditors are enabled.
- `ANTHROPIC_API_KEY`: server-side only, reserved for future provider support.

Never use `NEXT_PUBLIC_` for tokens, access keys, or provider API keys.

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

## Rollback Advice

- First rollback step: set `ENABLE_LLM_AUDITORS=false` and redeploy or restart.
- If repository access is wrong, rotate or replace `GITHUB_TOKEN`.
- If access-key exposure is suspected, replace `AGENTPULSE_ACCESS_KEY`.
- If deployment posture is wrong, pause the Vercel deployment or enable Deployment Protection before further scans.
