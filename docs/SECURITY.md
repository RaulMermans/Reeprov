# Security

AgentPulse is designed as a private read-only scanner for personal repositories.

## No Code Execution

Scanned repository code is never executed. AgentPulse does not run scripts, import scanned modules, invoke tools from scanned repos, or install scanned dependencies.

## Read-Only GitHub Access

GitHub access uses `GITHUB_TOKEN` on the server. Use a read-only token with the minimum repository permissions needed.

## Dashboard Access Key

Private deployments must set `AGENTPULSE_ACCESS_KEY` on the server. The dashboard asks for this value, stores it in `sessionStorage` only, and sends it to `/api/repos` and `/api/scan` as the `x-agentpulse-key` header. The key is never read from `localStorage`.

`AGENTPULSE_ACCESS_KEY` is an MVP gate for a private personal dashboard, not a full identity system. In deployed environments, a missing access key means the private tool is not properly configured.

## API Header

Protected API calls must include:

```text
x-agentpulse-key: <AGENTPULSE_ACCESS_KEY>
```

The header is checked server-side before repository listing or scanning starts. `/dashboard`, `/api/repos`, and `/api/scan` must remain protected before private deployment.

## Browser Storage

The dashboard stores the entered access key in `sessionStorage`. This avoids persisting the key across browser restarts and keeps it out of `localStorage`.

This is acceptable for a personal MVP because the app is private, single-user, and should also sit behind deployment-level protection. It is not ideal long-term because browser JavaScript can still read `sessionStorage` during the active session. A future version should replace the shared access key with GitHub OAuth restricted to the repository owner.

## Token Handling

Never expose `GITHUB_TOKEN`, `AGENTPULSE_ACCESS_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` to client components or browser JavaScript. Do not create `NEXT_PUBLIC_` variables for secrets.

Before deploying, confirm `/dashboard`, `/api/repos`, and `/api/scan` are protected by the private access-key flow and deployment-level access controls appropriate for the Vercel project. Enable Vercel Deployment Protection if it is available.

## Vercel Environment Variables

Configure deployment secrets only in Vercel environment variables. Required values are `GITHUB_TOKEN`, `AGENTPULSE_ACCESS_KEY`, `ENABLE_LLM_AUDITORS`, and `LLM_PROVIDER`. Provider API keys are required only when LLM auditors are enabled.

Use a fine-grained GitHub token with contents read-only permission, selected repository access, and a 30-90 day expiration. Keep Vercel Deployment Protection enabled when available so the private dashboard is not reachable as a public site.

## Secret Redaction

The scanner redacts OpenAI keys, GitHub tokens, Anthropic keys, database URLs, private key blocks, and generic API key, secret, token, and password assignments.

Raw `.env*` files are not scanned. Every `.env*` file is ignored except `.env.example`, and ignored environment files should still produce metadata and risk findings when present.

## Prompt Injection

Repository files are untrusted input. They may contain instructions that attempt to change scanner behavior or future LLM auditor behavior. AgentPulse treats file contents only as evidence and never follows instructions from scanned files.

AgentPulse must not execute scanned repository code, install scanned repository dependencies, or invoke tools found in scanned repositories.

## LLM Auditor Privacy Rules

LLM auditors are disabled by default with `ENABLE_LLM_AUDITORS=false`. The static scanner remains the trust layer and always runs before any LLM auditor.

AgentPulse must not send a raw repository dump to any LLM. The Prompt Auditor may receive only selected prompt evidence after static classification and secret redaction. Eligible evidence is limited to prompt files and relevant agent configs that reference prompt paths, with strict file and character caps.

Ignored files, `.env*` files, lockfiles, binaries, full source code, package-lock content, and raw secret-like values must not be sent to the model. Repository evidence remains untrusted, and the Prompt Auditor prompt instructs the model to analyze evidence only.

## Raw Repo Retention

The scaffold does not persist raw repository content. Future scan history should store redacted reports by default and should avoid storing raw file contents unless an explicit retention policy is added.
