# KARMA POLICE — H2 Reproduction Instructions

This directory (`research/swarmguard-testbed/results/h2/`) contains the sanitized, machine-readable research evidence package for **KARMA POLICE — H2: Independent Evaluation & External Agent Validation**.

- **Frozen Detector Commit SHA:** `5a4bcb59afa37e110b641b35db99c9a6b453137a`
- **Evaluator Scorer Protocol:** `reeprov.swarmguard_testbed.evaluation.v2`
- **Primary Sealed Pack Version:** `h2.post_freeze.sealed.v1`
- **Pre-Scoring Sealed Pack SHA-256:** `5f380067a7e8b67985579f90b7c47d2ebfd03e269bed8dd39f3ad96b678a1132`

> [!IMPORTANT]
> To preserve oracle isolation in public Git history, private oracle labels (`oracle_labels`, `actual_modification`) are never committed to this directory. Evaluators holding the isolated sealed pack file can re-execute the full pipeline and verify that the SHA-256 integrity hash matches `5f380067a7e8b67985579f90b7c47d2ebfd03e269bed8dd39f3ad96b678a1132` before scoring.

---

## 1. Verify Detector Freeze & Pre-Evaluation Negation Gate

Confirm that neither `src/karmaPolice/` nor `src/baselines/` has changed since the pre-evaluation freeze commit `5a4bcb59afa37e110b641b35db99c9a6b453137a`, and run the fixture-independent negation/denial/universal-inversion regression suite:

```bash
# Verify zero post-freeze detector or baseline diff
git diff 5a4bcb59afa37e110b641b35db99c9a6b453137a -- \
  research/swarmguard-testbed/src/karmaPolice \
  research/swarmguard-testbed/src/baselines

# Run the Karma Police unit & pre-evaluation negation gate tests
npx vitest run research/swarmguard-testbed/__tests__/karmaPolice.test.ts

# Run the H2 artifact & freeze integrity suite
npx vitest run research/swarmguard-testbed/__tests__/h2-results-integrity.test.ts
```

---

## 2. Reproduce the Post-Freeze Matched Evaluation (`h2.post_freeze.sealed.v1`)

With the isolated evaluator pack stored outside the repository at `<ISOLATED_SEALED_PACK_JSON>` (SHA-256 `5f380067a7e8b67985579f90b7c47d2ebfd03e269bed8dd39f3ad96b678a1132`) and an isolated temporary storage directory `<ISOLATED_STORE_DIR>`:

```bash
REEPROV_P3_ALLOW_HELDOUT=1 \
REEPROV_P3_SEALED_EVALUATION_PATH="<ISOLATED_SEALED_PACK_JSON>" \
npx tsx research/swarmguard-testbed/scripts/run-h2-evaluation.ts \
  --store-dir "<ISOLATED_STORE_DIR>" \
  --export-dir research/swarmguard-testbed/results/h2 \
  --include-published-benchmark
```

What this command executes deterministically:
1. Verifies the SHA-256 hash of `<ISOLATED_SEALED_PACK_JSON>` prior to scoring.
2. Executes all 16 post-freeze cases (`h2-se-01`..`h2-se-08`, `h2-inv-01`..`h2-inv-08`) in `offline_fixture` mode, writing detector-visible canonical `RunArtifact` bundles to `<ISOLATED_STORE_DIR>/detector/` and oracle truth exclusively to `<ISOLATED_STORE_DIR>/evaluator/`.
3. Loads each run exclusively via `createDetectorAccess(storeDir)`, verifies zero ground-truth leaks via `findGroundTruthLeaks`, runs `baseline.per_agent.v1`, `baseline.pooled_event.v1`, and `karma_police.cross_agent.v1`, and commits hashed prediction artifacts to `predictions/*.predictions.json` **before** reading any oracle record.
4. Scores committed predictions with `evaluation.v2` (`research/swarmguard-testbed/src/evaluate.ts`) and writes `manifest.json`, `monitors.json`, `metrics-summary.json`, `confusion-matrices.json`, `evaluations/*.evaluation.json`, and (when `--include-published-benchmark` is passed) `published-benchmark-reference.json`.

---

## 3. Reproduce the Non-Blind Published Benchmark Reference Alone (`p3.benchmark.v1.1`)

To inspect development-partition diagnostics without an external sealed pack:

```bash
npx tsx research/swarmguard-testbed/scripts/run-karma-police.ts
```

---

## 4. Reproduce the External Microsoft Agent Framework Validation

The external validation exercises the unmodified upstream **Microsoft Agent Framework** (`https://github.com/microsoft/agent-framework`) `customer_support_handoff` multi-agent workflow (`python/samples/03-workflows/orchestrations/handoff_simple.py`) at pinned commit `82f03c81aba5c5e4b1b36589027470bc5d094422`.

```bash
# 1. Clone and check out pinned upstream Microsoft Agent Framework outside the repo
git clone https://github.com/microsoft/agent-framework.git /tmp/upstream-maf
git -C /tmp/upstream-maf checkout 82f03c81aba5c5e4b1b36589027470bc5d094422

# 2. Create an isolated Python 3.11+ virtual environment and install core + orchestrations
python3 -m venv /tmp/maf-venv
/tmp/maf-venv/bin/pip install \
  -e /tmp/upstream-maf/python/packages/core \
  -e /tmp/upstream-maf/python/packages/orchestrations

# 3. Run the read-only Python middleware observer across control and handoff-mutation episodes
/tmp/maf-venv/bin/python research/swarmguard-testbed/scripts/maf-external-observer.py \
  --maf-repo /tmp/upstream-maf \
  --output /tmp/h2-external/maf-raw-observations.json

# 4. Convert raw observations into canonical REEPROV RunArtifacts, run all 3 frozen monitors,
#    and score with evaluation.v2
npx tsx research/swarmguard-testbed/scripts/run-external-maf-validation.ts \
  --raw-observations /tmp/h2-external/maf-raw-observations.json \
  --store-dir /tmp/h2-external/store \
  --export-dir research/swarmguard-testbed/results/h2/external-validation
```

Execution mode disclosure: this workflow executes in `offline` mode (`transport_label: "offline_mocked_chat_client"`, `provider_http_completed: false`, `is_live_llm: false`). Live Azure Foundry HTTP execution was not performed because `FOUNDRY_PROJECT_ENDPOINT` / `AzureCliCredential` and the `.NET` `powerfx` runtime required by the declarative YAML sample were absent in the evaluation environment.

---

## 5. Directory Manifest

| Path | Schema `format` | Purpose |
|---|---|---|
| `manifest.json` | `reeprov.h2.evaluation_manifest.v1` | Sealed pack SHA-256, freeze commit SHA, per-case run IDs, capture counts, prediction hashes |
| `monitors.json` | `reeprov.h2.monitors.v1` | Frozen versions, commit SHAs, scopes, and measured token/cost usage for all 3 monitors |
| `metrics-summary.json` | `reeprov.h2.metrics_summary.v1` | Aggregate, per-domain, and per-case `evaluation.v2` metrics + separate provenance-anomaly summary |
| `confusion-matrices.json` | `reeprov.h2.confusion_matrices.v1` | Overall and per-domain 3×5 confusion matrices (`supported`, `contradicted`, `unverified`, `missing`) |
| `examples.json` | `reeprov.h2.trace_linked_examples.v1` | Trace-linked agreements, disagreements, provenance anomalies, and failure cases |
| `published-benchmark-reference.json` | `reeprov.h2.published_benchmark_reference.v1` | Non-blind regression reference on in-tree `p3.benchmark.v1.1` (16 cases, 85 claims) |
| `predictions/*.predictions.json` | `reeprov.h2.case_predictions.v1` | Committed per-claim predictions and Karma Police companion provenance findings for all 16 cases |
| `evaluations/*.evaluation.json` | `reeprov.h2.case_evaluation.v1` | Sanitized `evaluation.v2` per-case scoring outputs (without raw oracle dumps) |
| `external-validation/provenance.json` | `reeprov.h2.external_validation_provenance.v1` | Upstream commit SHA, file hashes, declarative blockers, execution mode, and episode summaries |
| `external-validation/maf-cs-*.json` | `reeprov.run_artifact.v1` / `evaluation.v2` | Canonical `RunArtifact`, committed predictions, and `evaluation.v2` reports for external MAF episodes |

---

## 6. Repository-Wide CI Verification

```bash
npm run ci
```
