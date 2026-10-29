# Two-Agent Handoff Example

Minimal external-agent demonstration for Sprint P1. One run contains two distinct agent identities, an observed tool result, and an explicit handoff.

This is not SwarmGuard and not a research laboratory. It proves that Reeprov can capture, persist, reconstruct, replay, and export a multi-agent execution.

## Agents

- `triage-agent` classifies an incident and looks up a ticket.
- `resolver-agent` receives the handoff and emits a resolution claim.

The resolver's "validation succeeded" statement is an **agent assertion**. The ticket lookup result is **observed evidence**. Reeprov stores both and does not treat the claim as proof.

## Commands

Offline recorded capture (no Studio process, no live model):

```bash
npx tsx examples/external-agents/two-agent-handoff/run.ts
```

HTTP ingest into a running Reeprov instance:

```bash
npm run dev
export REEPROV_INGEST_KEY=ree_live_...
npx tsx examples/external-agents/two-agent-handoff/live-http.ts
```

Real model calls are used only when `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is set. Without those keys the HTTP path is still a live SDK integration; it is not a live-provider run.

## Tests

```bash
npx vitest run lib/core/contracts/__tests__/p1RuntimeEvidence.test.ts app/api/traces/events/route.test.ts
```
