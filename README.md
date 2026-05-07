# AgentPulse

AgentPulse is a private Vercel dashboard for auditing personal GitHub AI-agent repositories. It scans repository files through a server-side GitHub token, builds a static manifest, redacts secret-like values, detects agent architecture signals, and returns a health report with findings and recommended fixes.

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
   ```
4. Use a read-only GitHub token that can access the repositories you want to audit.
5. Run `npm run dev`.
6. Open `http://localhost:3000/dashboard` and enter the access key when prompted.

Without `GITHUB_TOKEN`, the dashboard and API routes return mock data.

## Environment Variables

- `GITHUB_TOKEN`: server-side read-only GitHub token. Never prefix this with `NEXT_PUBLIC_`.
- `AGENTPULSE_ACCESS_KEY`: server-side dashboard/API access key. Never prefix this with `NEXT_PUBLIC_`.

The dashboard stores the access key in `sessionStorage` only and sends it to protected API routes with the `x-agentpulse-key` header.

If `AGENTPULSE_ACCESS_KEY` is missing in a deployed environment, the private tool is not properly configured. Do not deploy the dashboard publicly without API protection.

## Security Posture

- Repository code is never executed.
- Repository dependencies are never installed.
- GitHub token access stays server-side.
- `/api/repos` and `/api/scan` require `x-agentpulse-key`.
- Private deployments must configure `AGENTPULSE_ACCESS_KEY`; do not rely on obscurity or public environment variables.
- `.env`, `.env.local`, private keys, generated folders, dependency folders, large files, and binary files are ignored.
- Secret-like strings are redacted before reports and before any future LLM auditor input.
- Repository contents are treated as untrusted evidence and may contain prompt injection.

## Private Deployment

- Configure `GITHUB_TOKEN` and `AGENTPULSE_ACCESS_KEY` as Vercel environment variables.
- Enable Vercel Deployment Protection if it is available for the project.
- Keep the GitHub token read-only and scoped only to the repositories AgentPulse needs.
- Do not deploy publicly without the access-key API protection in place.

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
