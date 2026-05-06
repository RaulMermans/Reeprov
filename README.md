# AgentPulse

AgentPulse is a private Vercel dashboard for auditing personal GitHub AI-agent repositories. It scans repository files through a server-side GitHub token, builds a static manifest, redacts secret-like values, detects agent architecture signals, and returns a health report with findings and recommended fixes.

AgentPulse is not a public SaaS, not multi-user, not an execution sandbox, and not allowed to install or run code from scanned repositories.

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Set `GITHUB_TOKEN` to a read-only GitHub token that can access the repositories you want to audit.
4. Run `npm run dev`.
5. Open `http://localhost:3000/dashboard`.

Without `GITHUB_TOKEN`, the dashboard and API routes return mock data.

## Environment Variables

- `GITHUB_TOKEN`: server-side read-only GitHub token. Never prefix this with `NEXT_PUBLIC_`.

## Security Posture

- Repository code is never executed.
- Repository dependencies are never installed.
- GitHub token access stays server-side.
- `.env`, `.env.local`, private keys, generated folders, dependency folders, large files, and binary files are ignored.
- Secret-like strings are redacted before reports and before any future LLM auditor input.
- Repository contents are treated as untrusted evidence and may contain prompt injection.

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
