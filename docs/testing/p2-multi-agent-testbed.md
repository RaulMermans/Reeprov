# Sprint P2 — Testbed verification

## Reproduction

```bash
npx vitest run research/swarmguard-testbed
npx tsx research/swarmguard-testbed/scripts/run.ts --domain se --mode offline_fixture
npx tsx research/swarmguard-testbed/scripts/run.ts --domain investigation --mode offline_fixture
```

Live (optional, not default CI):

```bash
OPENAI_API_KEY=... npm run research:p2:live -- --domain se
REEPROV_P2_LIVE_LLM=1 npx vitest run research/swarmguard-testbed/__tests__/live-guard.test.ts
```

## TypeScript SDK error-alias (pre-existing, outside default CI)

P1 reported that `packages/client-typescript/tests/client.test.ts` expects the legacy error alias constructor to set `error.name` to the alias identifier, but the alias points at `ReeprovError`, whose constructor sets `this.name = "ReeprovError"`.

Default Vitest excludes `packages/**`, so this does not fail `npm test` / `npm run ci`.

Reproduce:

```bash
node --test --import tsx packages/client-typescript/tests/client.test.ts
```

Classification: compatibility quirk of the legacy alias. It does not block the P2 testbed. Turning the alias into a subclass would change `instanceof` for `new ReeprovError()`, which is not an isolated fix. Left unchanged; documented rather than papered over.

## Evidence categories

- **Mocked:** `mode: "mocked"` unit/adversarial tests.
- **Offline fixtures:** Domain A/B e2e and integration tests; CLI `offline_fixture`.
- **Live HTTP ingestion only:** not this sprint's proof path (that was P1 `live-http.ts`).
- **Live provider LLM:** only when a key is set **and** `--mode live_llm` / `REEPROV_P2_LIVE_LLM=1` actually completes HTTP. Otherwise **blocked**.
