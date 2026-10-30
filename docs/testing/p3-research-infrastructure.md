# Sprint P3 — Test evidence

## Reproduction

```bash
npx vitest run research/swarmguard-testbed
npx tsx research/swarmguard-testbed/scripts/run.ts list
npx tsx research/swarmguard-testbed/scripts/run.ts run --case se-d01 --mode offline_fixture
npx tsx research/swarmguard-testbed/scripts/run.ts freeze
REEPROV_P3_ALLOW_HELDOUT=1 npx vitest run research/swarmguard-testbed/__tests__/oracle-audit.test.ts
```

Live (optional, not default CI):

```bash
OPENAI_API_KEY=... npm run research:p3:live -- --domain se
REEPROV_P2_LIVE_LLM=1 npx vitest run research/swarmguard-testbed/__tests__/live-guard.test.ts
```

## Evidence categories

| Check | Kind |
|---|---|
| Unit schemas, injection targeting, budgets | Mocked |
| Observability matrix, isolation, baselines, evaluation fixtures, benchmark catalog | Offline fixtures / deterministic |
| Domain e2e through CaptureSession | Offline fixtures |
| Live provider HTTP | Only when a key is set **and** `live_llm` completes. Otherwise **blocked** |

## Injection observability matrix (expected after P3 capture fixes)

| Injection | Applied | Canonical export | Ground truth | Distinguishable from control |
|---|---|---|---|---|
| `incorrect_assertion` | yes | `evidence.verification_events[].details.claim` | yes | yes |
| `missing_evidence` | yes | `handoffs[].evidence_refs = []` | yes | yes |
| `stale_evidence` | yes (needs previous artifact) | `handoffs[].artifact_refs` | yes | yes |
| `cross_run_evidence` | yes | foreign ref + integrity `CROSS_RUN` | yes | yes |
| `modified_handoff` | yes | `handoffs[].payload` when capture status is `captured` | yes | yes |
| `skipped_validation` | yes | absence of validation tool | yes | yes |
| `modified_handoff` + STRUCTURE_ONLY | yes | payload omitted | `invalid_not_observable` | n/a |
