# Reproducibility Supplement — KARMA POLICE (H3-final)

Scope: what can and cannot be reproduced from public files for claims in `KARMA_POLICE_Final_Paper.pdf`. This document does not regenerate historical labels or traces.

## Anchors

| Item | Value |
|---|---|
| Frozen detector/baselines | `5a4bcb59afa37e110b641b35db99c9a6b453137a` |
| H2 sealed pack commitment | `5f380067a7e8b67985579f90b7c47d2ebfd03e269bed8dd39f3ad96b678a1132` |
| Pinned Microsoft Agent Framework | `82f03c81aba5c5e4b1b36589027470bc5d094422` |
| H2-C public SHA-256 list | `research/h2c-live-error-propagation/public/SHA256SUMS` |
| H2-C raw observations (local only) | SHA-256 `bae87bb1a083dc644b136d278a3969fd62cbf0b663b6c94386024fe4c8d8aa61` |
| Model | Ollama `qwen2.5:7b`, digest `845dbda0ea48ed749caafd9e6037047aa19acfcfd82e704d7ca97d631a0b697e` |
| H2-C generation bounds | temperature 0, seed 8841, `num_ctx` 3072, `num_predict` 192, `num_thread` 8 |
| Packages | `agent-framework-core==1.24.0`, `agent-framework-orchestrations==1.4.1`, `agent-framework-ollama==1.0.0b261030` |

## Reproducible from public files

```bash
npx tsx docs/research/h3-final/scripts/verify-h3-final.ts
npx vitest run research/swarmguard-testbed/__tests__/h2-results-integrity.test.ts research/h2c-live-error-propagation/__tests__/
git diff 5a4bcb59afa37e110b641b35db99c9a6b453137a -- research/swarmguard-testbed/src/karmaPolice research/swarmguard-testbed/src/baselines
```

The verifier checks:

1. Zero diff of frozen detector and baselines against `5a4bcb59`.
2. SHA-256 of the 16 H2 prediction files; confusion-matrix conservation; Table 1 numerators/denominators; 14 provenance anomalies across **8** of 16 scenarios.
3. Deterministic re-execution of all three monitors on committed H2 offline MAF artifacts.
4. SHA-256 of H2-C public artifacts against `SHA256SUMS`.
5. Recomputed H2-C aggregates: 12/22, 12/22, 8/22; contradiction recall 0/2, 0/2, 2/2; KARMA POLICE precision 2/16; tokens 11,524.
6. Monitor re-execution parity on the eight H2-C canonical run artifacts.
7. If `research/h2c-live-error-propagation/.output/all-observations.json` is present locally, its hash must equal `bae87bb1…aa61`.

## Artifact classes

| Class | Status |
|---|---|
| Reproducible code (frozen monitors, evaluation, H2-C adapter) | Public |
| Committed canonical traces / predictions / evaluations | Public under `results/h2/` and `h2c-live-error-propagation/public/` |
| Public sanitized H2-C artifacts | Public; hashes in `SHA256SUMS` |
| H2-C raw observations | Locally retained, gitignored; hash confirmed on the authoring machine; **not** in the repository |
| H2 sealed pack and raw oracle labels | **Missing** from this machine and from the repository |
| H2-B raw cloud KVM files | **Not recovered**; not reconstructed |
| Narrative Markdown summaries | Public; subordinate to committed JSON when they disagree |

## Commands used for H2-C (requires local Ollama)

```bash
python research/h2c-live-error-propagation/scripts/h2c_orchestrator.py \
  --maf-repo /path/to/agent-framework \
  --commit-sha 82f03c81aba5c5e4b1b36589027470bc5d094422 \
  --manifest research/h2c-live-error-propagation/scenarios/manifest.v1.json \
  --phase p0 \
  --output /tmp/h2c-observations.json

npx tsx research/h2c-live-error-propagation/scripts/run-h2c-evaluation.ts \
  --raw-observations /tmp/h2c-observations.json \
  --store-dir /tmp/h2c-store \
  --export-dir /tmp/h2c-export
```

Do not point `--export-dir` at `research/swarmguard-testbed/results/h2/`. Repeating live inference will not bit-match historical completions even at temperature 0.

## Reporting discrepancy (H2 provenance scenarios)

`docs/research/karma-police-h2-results.md` Table 2 footer says 14 anomalies across **7** cases. Committed prediction files and `metrics-summary.json` give 14 anomalies across **8** scenarios (`h2-se-03`, `h2-se-05`, `h2-se-06`, `h2-se-08`, `h2-inv-04`, `h2-inv-05`, `h2-inv-06`, `h2-inv-08`). The H2 Markdown was not edited. The paper uses **8**, matching the artifacts.

## Validation limits

- H2 is post-freeze, not third-party blind.
- H2-C uses a sequential controller, not `HandoffBuilder`.
- H2-B raw evidence is unavailable.
- Original sealed H2 pack is unavailable; scoring from raw oracle labels cannot be repeated from public files.
