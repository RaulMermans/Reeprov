# Security

AgentPulse is designed as a private read-only scanner for personal repositories.

## No Code Execution

Scanned repository code is never executed. AgentPulse does not run scripts, import scanned modules, invoke tools from scanned repos, or install scanned dependencies.

## Read-Only GitHub Access

GitHub access uses `GITHUB_TOKEN` on the server. Use a read-only token with the minimum repository permissions needed.

## Token Handling

Never expose `GITHUB_TOKEN` to client components or browser JavaScript. Do not create `NEXT_PUBLIC_` variables for secrets.

## Secret Redaction

The scanner redacts OpenAI keys, GitHub tokens, Anthropic keys, database URLs, private key blocks, and generic API key, secret, token, and password assignments.

## Prompt Injection

Repository files are untrusted. They may contain instructions that attempt to change scanner behavior or future LLM auditor behavior. AgentPulse treats file contents only as evidence and never follows instructions from scanned files.

## Raw Repo Retention

The scaffold does not persist raw repository content. Future scan history should store redacted reports by default and should avoid storing raw file contents unless an explicit retention policy is added.
