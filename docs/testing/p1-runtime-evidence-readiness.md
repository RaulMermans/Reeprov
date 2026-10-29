# Sprint P1 — Runtime & Evidence Readiness

Verified against the implementation on `sprint/p1-runtime-evidence-readiness`. SwarmGuard is not implemented.

## Readiness matrix

| Capability | Existing implementation | Evidence | Status | Required action taken |
|---|---|---|---|---|
| External execution capture | TypeScript/Python SDKs, HTTP ingest, CaptureSession | `packages/client-*`, `/api/runs/start`, `/api/traces/events` | verified | Promoted `agent_id` through ingest |
| Run identity | `runIdentitySchema` | `lib/core/contracts/identity.ts` | verified | Added `participating_agent_ids` |
| Agent identity across steps | optional `agent_id` on steps | CaptureSession + HTTP events | verified | Capture, SDK, and ingest now persist it |
| Event ordering | `step_index`, `sequence_index` | `integrity.ts`, `validateVerificationSequence` | verified | unchanged |
| Tool invocation/result | ToolInvocation + boundaries | capture adapters | verified | Stamp `agent_id` from the active step |
| Parent/child events | SDK `parent_event_id` was dropped by the server schema | HTTP ingest tests | verified | Schema now stores `parent_event_id` |
| Cross-agent handoffs | unused `subagent_call` boundary only | `handoff.ts`, CaptureSession.recordHandoff | verified | First-class `handoffs[]` |
| Claims vs observations | actor field only | `origin` / `authority` | verified | Agent-asserted passes are not proof |
| Evidence reference integrity | sequence duplicates only | `validateEvidenceIntegrity` | verified | Missing/cross-run/malformed refs stay unresolved |
| Persistence/retrieval | canonical file/Postgres store | persistence tests | verified | Two-agent reload test |
| Offline replay | STRICT_OFFLINE + substitution harness | existing replay tests + P1 tool substitution | verified | no live side effects |
| Export | canonical GET + project export | `exportRunEvidenceBundle` | verified | Bundle wraps RunArtifact |
| Live HTTP SDK ingest | `@reeprov/client` → running Studio | `examples/external-agents/two-agent-handoff/live-http.ts` | verified locally | Two-agent handoff persisted and reconstructed |
| Live provider LLM | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | same harness sets `live_model` | unverified | No provider keys in this environment |

## Reproduction

```bash
npx vitest run lib/core/contracts/__tests__/p1RuntimeEvidence.test.ts app/api/traces/events/route.test.ts
npx tsx examples/external-agents/two-agent-handoff/run.ts
```

HTTP ingest (running Studio required):

```bash
npm run dev
REEPROV_INGEST_KEY=... npx tsx examples/external-agents/two-agent-handoff/live-http.ts
```

## Evidence categories

- **Mocked unit test:** schema-only probes in `p1RuntimeEvidence.test.ts` (missing refs, unknown handoff).
- **Offline recorded capture:** CaptureSession two-agent harness (deterministic, no live model).
- **Live HTTP SDK integration:** `live-http.ts` against a running Reeprov process. Verified locally; reconstructed `participating_agent_ids`, resolved handoff, `lookup_incident_ticket` attributed to `triage-agent`, and parent/child event links.
- **Live provider model:** only when `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is set. Unverified here — those variables were unset. Blocker: export a provider key and re-run `live-http.ts` (it reports `live_model: true` only when a key is present). The current HTTP path still uses deterministic policy models.

Never treat the offline harness as a completed live-provider run.

The Sprint 13 single-agent example at `examples/external-agents/incident-triage/` remains the supported replay/fork reference. P1 adds multi-agent identity and claim/observation separation on top of that capture path.

## Remaining risks

- HTTP `eval_completed` events are stored as agent-asserted claims, not proof.
- Generic labels (`agent`, `actor`, `unknown`) are not promoted to `agent_id`.
- The TypeScript client's legacy error alias still reports `name: "ReeprovError"`. That SDK unit test lives outside default CI (`packages/**` is excluded from vitest).
