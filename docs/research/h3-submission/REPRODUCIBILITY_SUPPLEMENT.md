# Reproducibility Supplement — KARMA POLICE (H3)

Scope: what can and cannot be reproduced from the public repository for the claims in `karma-police-apart-2026.pdf`. Nothing here regenerates, edits, or reconstructs evaluation cases, predictions, or labels.

## Anchors

| Item | Value |
|---|---|
| Frozen detector/baselines commit | `5a4bcb59afa37e110b641b35db99c9a6b453137a` |
| H2 results commit | `f44855ab0965109fdefde13d63115021266ba932` |
| H2 sealed pack commitment (SHA-256) | `5f380067a7e8b67985579f90b7c47d2ebfd03e269bed8dd39f3ad96b678a1132` |
| Pinned Microsoft Agent Framework | `82f03c81aba5c5e4b1b36589027470bc5d094422` |

## Reproducible from public files

Run from the repository root:

```bash
npx tsx docs/research/h3-submission/scripts/verify-h3-reproducibility.ts
npx vitest run research/swarmguard-testbed/__tests__/h2-results-integrity.test.ts
git diff 5a4bcb59afa37e110b641b35db99c9a6b453137a -- research/swarmguard-testbed/src/karmaPolice research/swarmguard-testbed/src/baselines   # must be empty
```

The verification script checks:

1. Zero diff of the frozen detector and baselines against the freeze commit.
2. SHA-256 of each of the 16 committed prediction files against the hashes recorded in the evaluation files and manifest.
3. Conservation of aggregate and per-domain confusion matrices (cell sums equal gold counts; aggregates equal sums of per-scenario matrices).
4. Aggregate and per-domain metrics used in Tables 1 and 2 recomputed from committed confusion matrices and evaluations. Per-scenario values in Table B1 were extracted from the committed per-scenario evaluation files (not by this script).
5. Provenance-anomaly count: 14 anomalies across 8 of 16 scenarios. (H2 prose in `docs/research/karma-police-h2-results.md` says 7 scenarios; the committed predictions give 8, and the paper uses 8. The H2 document was not edited.)
6. Live deterministic re-execution of all three monitors on the committed Microsoft Agent Framework run artifacts (`maf-cs-control-01`, `maf-cs-tamper-01`) and agreement with the committed predictions.

Also public and re-runnable: the 19 pre-freeze negation/polarity/universal regression tests, the development partition, the non-blind `p3.benchmark.v1.1` benchmark (85 claims), and the external-validation artifacts.

CI note: `h2-results-integrity.test.ts` diffs against the freeze SHA, so CI must check out full history. `.github/workflows/ci.yml` now sets `fetch-depth: 0`; the test and the zero-diff requirement are unchanged.

## Not reproducible from public files

- The original sealed evaluation pack (traces, scenario definitions, oracle labels) is **not in the repository** and was not found on the authoring machine. Therefore Stage 1–2 (generating raw traces) and raw-label inspection cannot be independently re-run, and scoring from raw oracle labels cannot be repeated. The committed predictions, per-scenario evaluations, confusion matrices, and hashes are verifiable, but the oracle labels themselves are only visible through those aggregates.
- `h2-results-integrity.test.ts` forbids `oracle_labels` / `actual_modification` content inside `results/h2/`, so labels could not be added there without changing the gate.
- No cases were regenerated. A regenerated pack would not match the commitment hash and would not be the evaluated experiment.

## Option for full reproduction (needs the author)

If the author still holds the original pack bytes, a public post-evaluation release is possible: all scenarios are synthetic and non-sensitive. Before releasing, verify that the SHA-256 of the bytes equals the commitment above (`run-h2-evaluation.ts` performs this check before scoring). Disclose that releasing retires `h2.post_freeze.sealed.v1` as a private test for future detector versions. This was **not** done; it requires the author's decision and the original bytes.

## Caveats

- Evaluation is post-freeze, not third-party blind; scenarios and detector share an author.
- External validation uses an experimenter-authored offline chat client; no live provider HTTP call occurred.
- Latency numbers in committed summaries are single-machine measurements and are not used in paper claims.
