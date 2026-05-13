# AgentPulse

AgentPulse is a private Vercel dashboard for auditing personal GitHub AI-agent and AI-workflow repositories. It scans repository files through a server-side GitHub token, builds a static manifest, redacts secret-like values, detects agent and workflow architecture signals, and returns a health report with findings and recommended fixes.

AgentPulse supports both agent-based and workflow-based AI project layouts. It detects `workflow.yaml`, `workflows.yaml`, `workflow.json`, and similar manifests as first-class structured inventory, alongside `agents.yaml` and agent configs. Repositories can be scanned from the GitHub API or from a GitHub-generated ZIP archive.

AgentPulse is not a public SaaS, not multi-user, not an execution sandbox, and not allowed to install or run code from scanned repositories.

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local`.
   ```bash
   cp .env.example .env.local
   ```
3. Set the local environment values:
   ```bash
   GITHUB_TOKEN=...
   AGENTPULSE_ACCESS_KEY=...
   ENABLE_LLM_AUDITORS=false
   LLM_PROVIDER=openai
   ```
4. Use a read-only GitHub token that can access the repositories you want to audit.
5. Run `npm run dev`.
6. Open `http://localhost:3000/dashboard` and enter the access key when prompted.

Without `GITHUB_TOKEN`, the dashboard and API routes return mock data for GitHub scans. ZIP upload scans still require `AGENTPULSE_ACCESS_KEY`.

## Scan Modes

- GitHub repository: select or enter `owner/repo`; AgentPulse fetches files with the server-side read-only token.
- ZIP upload: upload a `.zip` downloaded from GitHub; AgentPulse parses it in memory, strips the top-level GitHub folder, normalizes file paths, and runs the same static scanner and report pipeline.

Direct ZIP upload is limited to 4 MB on Vercel so requests stay below serverless function body limits. Larger repositories should use GitHub repository scanning, which avoids the direct upload body limit.

Post-upload ZIP extraction limits are 50 MB uncompressed, 500 files, 1 MB per analyzed text file, and 240 characters per path. Uploaded ZIPs are parsed in memory and are never persisted. Uploaded code is never executed, uploaded dependencies are never installed, ZIP entries are treated as untrusted input, and path traversal is blocked.

Future larger-ZIP options are client-side ZIP extraction, Vercel Blob client upload with temporary scan/delete, or a local CLI scanner.

## Environment Variables

- `GITHUB_TOKEN`: server-side read-only GitHub token. Never prefix this with `NEXT_PUBLIC_`.
- `AGENTPULSE_ACCESS_KEY`: server-side dashboard/API access key. Never prefix this with `NEXT_PUBLIC_`.
- `ENABLE_LLM_AUDITORS`: server-side feature flag for LLM auditors. Defaults to `false`.
- `LLM_PROVIDER`: server-side provider selector. `openai` is implemented first; Anthropic is documented for future support.
- `OPENAI_API_KEY`: server-side only. Required only when `ENABLE_LLM_AUDITORS=true` and `LLM_PROVIDER=openai`.
- `ANTHROPIC_API_KEY`: server-side only. Reserved for future Anthropic support.

The dashboard stores the access key in `sessionStorage` only and sends it to protected API routes with the `x-agentpulse-key` header.

If `AGENTPULSE_ACCESS_KEY` is missing in a deployed environment, the private tool is not properly configured. Do not deploy the dashboard publicly without API protection.

## Security Posture

- Repository code is never executed.
- Repository dependencies are never installed.
- GitHub token access stays server-side.
- `/api/repos`, `/api/scan`, and `/api/scan-zip` require `x-agentpulse-key`.
- Private deployments must configure `AGENTPULSE_ACCESS_KEY`; do not rely on obscurity or public environment variables.
- `.env`, `.env.local`, private keys, generated folders, dependency folders, large files, and binary files are ignored.
- Secret-like strings are redacted before reports and before any future LLM auditor input.
- Repository contents are treated as untrusted evidence and may contain prompt injection.
- ZIP entries are untrusted input and are checked for path traversal before scanning.

## Private Vercel Deployment

Required Vercel environment variables:

- `GITHUB_TOKEN`
- `AGENTPULSE_ACCESS_KEY`
- `ENABLE_LLM_AUDITORS`
- `LLM_PROVIDER`
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` only if LLM auditors are enabled

Recommended Vercel settings:

- Enable Vercel Deployment Protection if available.
- Use a fine-grained GitHub token.
- Token permissions: contents read-only.
- Token repository access: selected repos only.
- Token expiration: 30-90 days.
- Do not expose any token with `NEXT_PUBLIC_`.

Deployment validation:

- `npm run lint`
- `npx tsc --noEmit`
- `npm run test`
- `npm run build`

Post-deploy checks:

- `/api/repos` without `x-agentpulse-key` returns 401.
- `/api/scan` without `x-agentpulse-key` returns 401.
- Dashboard does not expose secrets in page source.
- First scan should be done on a low-risk sample repo.

## MVP Scope

- Next.js App Router dashboard.
- Server-side GitHub repository listing and scanning routes.
- Static file classification.
- Secret redaction.
- Placeholder auditor interfaces.
- Score calculation and report schema validation.

## Roadmap

- Improve repository file fetching controls and paging.
- Expand static agent, tool, workflow, and eval detectors.
- Add real LLM auditor implementations behind strict redaction and structured output.
- Add dashboard filtering, scan diffing, and scan history.
- Consider optional GitHub App or CI integration later.
