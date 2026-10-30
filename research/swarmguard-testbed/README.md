# SwarmGuard Research Testbed (Sprint P2)

Reusable, domain-independent multi-agent laboratory for later SwarmGuard research.

This directory is **research infrastructure**. It is not a Reeprov product feature, not a public SDK, and not SwarmGuard. SwarmGuard detection, attribution, and scoring are intentionally unimplemented.

## What it produces

Each run has two isolated records:

1. **Detector-visible:** a canonical Reeprov `RunArtifact` plus `exportRunEvidenceBundle` output (agents, model calls, tools, handoffs, artifacts, assertions, observed tests).
2. **Evaluator-only:** `ground-truth.json` with intervention labels, intended failure location, actual mutations, seed, and private scoring metadata.

Future detectors must read only (1).

Execution modes are labeled honestly:

| Mode | Meaning |
|---|---|
| `live_llm` | An outbound provider HTTP request completed and the model text was parsed. |
| `offline_fixture` | Recorded JSON turns. Reproducible. Never live. |
| `mocked` | Unit-test substitute. |

Credential presence does **not** make a run `live_llm`. Fixtures are never relabeled as live.

## Local prerequisites

- Node.js >= 20
- Repository dependencies: `npm install`
- Optional live providers: `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY`

The experimental controller does not use `ENABLE_LLM_AUDITORS`. That flag is for Reeprov's product auditors, not this testbed.

## Commands

Offline (default, no network, CI-safe):

```bash
npm run research:p2:offline -- --domain se
npm run research:p2:offline -- --domain investigation
npx tsx research/swarmguard-testbed/scripts/run.ts --domain se --mode offline_fixture --inject skipped_validation --target-agent coder
```

Live provider (actual model HTTP). Fails closed if keys are missing:

```bash
export OPENAI_API_KEY=...
npm run research:p2:live -- --domain se
# or
npx tsx research/swarmguard-testbed/scripts/run.ts --domain investigation --mode live_llm
```

Optional model override: `REEPROV_P2_MODEL` (default `gpt-4o-mini` or `claude-3-5-haiku-latest`).

Tests:

```bash
npx vitest run research/swarmguard-testbed
```

Live Vitest proof (not in default CI):

```bash
REEPROV_P2_LIVE_LLM=1 npx vitest run research/swarmguard-testbed/__tests__/live-guard.test.ts
```

## Expected artifacts

Runs write to `research/swarmguard-testbed/.output/<run_id>/` (gitignored):

- `artifact.json` — canonical RunArtifact (detector-visible)
- `evidence-bundle.json` — `exportRunEvidenceBundle` view
- `ground-truth.json` — evaluator-only
- `summary.json` — operator summary (mode, agents, control flag)

Canonical persistence also uses the Reeprov run store (`REEPROV_STORE_DIR` / `~/.reeprov/runs`).

## Cost and budget controls

Defaults (override via harness `budget`):

- max cost `$0.15` / run
- max tokens `12000`
- max model calls `12`
- max tokens per call `800`
- agent timeout `45s`
- run timeout `180s`
- bounded schema retries (`2`)

Live mode records provider usage, estimated USD, and latency on each model invocation.

## How to add another experimental domain

1. Implement `DomainModule` (`id`, `buildScenario`, `createWorkspace`, `registerTools`, prompts).
2. Add `research/swarmguard-testbed/fixtures/<domain-id>.json` with one valid `AgentTurn` per agent.
3. Register the module in `src/index.ts` `DOMAIN_MODULES`.
4. Do not change `src/harness.ts` for domain-specific names.

The controller is role-agnostic: any number of agents can be listed in `scenario.workflow`. Sequential routing is an example, not a contract assumption.

## Fault injection

Independent of domain. Control mode is `injection.enabled = false`.

| Type | Observable violation |
|---|---|
| `incorrect_assertion` | Agent claim diverges from observed evidence |
| `missing_evidence` | Handoff evidence refs stripped |
| `stale_evidence` | Earlier artifact version cited |
| `cross_run_evidence` | Foreign run-prefixed ref |
| `modified_handoff` | Handoff payload field changed |
| `skipped_validation` | Validation tool not executed |

Injection labels are not written into prompts, assertions, evidence bundles, or agent-visible metadata.

## Known limitations

- Live proof requires a configured provider key and an explicit `--mode live_llm`. Without that, live verification is **blocked**, not passed.
- Model-authored code is never executed. Software-engineering validation is a deterministic gold-case checker over a JSON mapping.
- No GitHub merges, deployments, or production writes.
- Anthropic and OpenAI are thin HTTP adapters; there is no new agent framework.
- P1's TypeScript SDK legacy error-alias unit test still lives outside default CI (`packages/**` excluded). See `docs/testing/p2-multi-agent-testbed.md`.
