# Deployment Checklist

AgentPulse is a private personal dashboard. Deploy it only with server-side secrets, read-only GitHub access, and API access-key protection.

## Local Validation

- Run `npm install` to validate `package-lock.json`.
- Run `npm run lint`.
- Run `npx tsc --noEmit`.
- Run `npm run test`.
- Run `npm run build`.

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

## LLM Auditor Feature Flag

- Keep `ENABLE_LLM_AUDITORS=false` for the first staging deploy.
- Set `LLM_PROVIDER=openai` when enabling the first Prompt Auditor.
- Add `OPENAI_API_KEY` only when `ENABLE_LLM_AUDITORS=true`.
- Confirm the dashboard reports `Static only` when disabled.
- Confirm the dashboard reports `Static + LLM Prompt Auditor` only when the prompt audit actually runs.

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
6. Confirm `.env*` files are ignored.
7. Confirm no secrets appear in the browser devtools response.
8. If `ENABLE_LLM_AUDITORS=false`, confirm no LLM call is made.
9. If `ENABLE_LLM_AUDITORS=true` and API key exists, confirm Prompt Auditor runs only on prompt evidence.

## Rollback Advice

- First rollback step: set `ENABLE_LLM_AUDITORS=false` and redeploy or restart.
- If repository access is wrong, rotate or replace `GITHUB_TOKEN`.
- If access-key exposure is suspected, replace `AGENTPULSE_ACCESS_KEY`.
- If deployment posture is wrong, pause the Vercel deployment or enable Deployment Protection before further scans.
