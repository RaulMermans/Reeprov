# Sprint 13 acceptance results

All values are synthetic. Raw artifacts (screenshots, video, replay/fork JSON, logs, packed SDKs) are in the gitignored `s13-evidence/` folder of the working tree. They contain no keys or credentials: the local key file is excluded from every report and from the Docker build context.

## Gates

| Gate | Result |
| --- | --- |
| `npm run ci` (rename + private-path audits, lint, typecheck, tests, production build) | **Passed**: 129 files, 1,949 tests (baseline at `14d09c1`: 125 files, 1,921) |
| S13 acceptance matrix `tests/s13/externalReplayFork.test.ts` | 23 passed (hermetic; SDK → real route handlers via in-process fetch) |
| SDK parity `tests/s13/sdkParity.test.ts` | server ≡ TypeScript ≡ Python canonical hashes; SDK version constants ≡ manifests |
| Python SDK unit tests | 10 passed |
| TypeScript SDK package | (pre-bump build tested as `0.2.0-dev`) `tsc` build + `npm pack` (13 files, 15.9 kB); installed offline into a fresh external project |
| Python SDK package | `python -m build` wheel + sdist; installed into a fresh venv; live run `s13-python-compat-002` (2 checkpoints `REGISTERED`, 1 observation, all acks `ok`) |
| Concurrent ingestion over HTTP | 80 concurrent records from 2 clients → 80 acked, **80 stored**, 80 unique sequences; 10-record retry storm → 10 `DUPLICATE`, 0 stored |
| Local production server (`next start`, `personal_local`) | external capture, replay, fork, evals, compare, regression; restart persistence verified |
| Docker (`self_hosted`, Colima) | build ok; health 200; unauthenticated read 401; capture → `VERIFIED` replay → resumed fork; **after `docker restart`** checkpoint still `RESTORABLE`, replay and fork run present |
| Privacy | synthetic credential absent from every persisted store file; `STRUCTURE_ONLY` persists no content; local keys absent from diff and reports; pattern scan of the diff clean (gitleaks not installed) |
| `npm audit --omit=dev` | 0 advisories |
| IRIS dogfood suite | passes within `npm run ci` (2 assertions updated for the acknowledgement contract) |
| Playwright (Chromium 156) | full 9-step sequence below; 11 screenshots and 1 WebM video |

## External run IDs (local production server)

| Step | ID | Result |
| --- | --- | --- |
| Baseline live run | `s13-baseline-inc2041-001` | SEV3, `defer_to_ticket_queue`; 1 real ticket written to the agent outbox |
| Strict replay | `replay_host_1793114894743_ce1vmh` | `MATCHED / VERIFIED`, 5/5 substituted, 7 host steps, output and `after_evidence` state hash matched, ticket not re-created |
| Changed input (`/incident_id` → INC-9999) | `replay_host_1793114907368_pydlio` | `DIVERGED`, `INPUT_HASH_MISMATCH` at sequence 0 |
| Redacted input run | `s13-redacted-inc2041-001` | credential redacted at capture |
| — strict | `replay_host_1793114907933_0gy2bj` | `UNSUPPORTED`, `INPUT_UNVERIFIABLE` |
| — partial | `replay_host_1793114908276_8ncc5k` | `MATCHED / PARTIALLY_VERIFIED` |
| Resumed fork (policy v2) | `fork_s13-baseline-inc2041-001_mvqubo64` | `COMPLETED`; executed steps [4, 5, 6]; prefix re-executed 0; `page_oncall` `BLOCKED_SIMULATED`; SEV1; no page written |
| Baseline eval | `evrun_incident-triage-domain_s13-baseline-inc2041-001_1793114948555` | `FAILED` 1/5 (severity, evidence, deferral and paging fail; side-effect check passes) |
| Candidate eval | `evrun_incident-triage-domain_fork_s13-baseline-inc2041-001_mvqubo64_1793114948580` | `PASSED` 5/5 |
| Comparison + claim | `cmp_2fc442715efd4938` | first divergence `create_ticket → page_oncall` (boundary-cited); state diff only `consider_customer_impact` and `version` (controlled mutations); claim `IMPROVEMENT_VERIFIED` |
| Regression case | `case_run_s13-baseline-inc2041-001_1793114948647` | dataset `s13-incident-triage-regressions` |
| Checkpoint `after_evidence` | — | `STATE_VALID_HOST_UNVERIFIED` before the fork → `RESTORABLE` (verified by `RESUMED_FORK`) after |

Docker: baseline `s13-docker-baseline-001`, replay `replay_host_1793116147739_r33q42` (`VERIFIED`), fork `fork_s13-docker-baseline-001_mvqv22r6` (SEV1).

## Visual acceptance (Playwright)

Recorded run `s13-walkthrough-1793115975786` (video `s13-walkthrough-1793115975786.webm`). Every step was driven against real results. The agent, CLI replay and CLI fork ran as separate processes between browser steps.

1. Independent agent run arrives: `01-run-arrived.png`.
2. Boundary evidence is inspectable; badge `RECORDED`: `02-recorded-evidence.png`.
3–4. CLI strict replay `replay_host_1793115981333_dbf93k`, then Replays tab: `MATCHED`, `VERIFIED`, "Host code re-executed", per-call `FULL` verification, side effect "recorded result substituted; not executed"; badge `REPLAYED`: `03-replayed-verified.png`.
5. Checkpoint `after_evidence` selected; assessment "State valid · host unverified"; the developer-side command is shown instead of a server button: `04-checkpoint-selected.png`.
6. CLI fork `fork_s13-walkthrough-1793115975786_mvquyju2`; lineage lists it as `FORKED`; assessment becomes "Restorable (host verified)": `05-fork-lineage.png`; the child shows `FORKED` with stages Classify → Act → Report: `06-forked-child.png`.
7. Compare with the claim gate: `IMPROVEMENT_VERIFIED`; first meaningful divergence `create_ticket → page_oncall`: `07-compare-improvement-claim.png`.
8. Eval Studio: baseline `FAILED` 20% with per-assertion findings; candidate `PASSED`: `08a`, `08b`.
9. Regression case saved through the Studio form (`case_run_s13-walkthrough-1793115975786_1793115990576`, HTTP 201): `09a` (the Curated Tests tab does not list cases) and `09b` (the case appears under Evaluate → Datasets).

The dataset view also contains cases from three earlier recording attempts against the same store. Those attempts exposed UI defects that were fixed before this final recording: the Studio unlock bug, misleading badges and counts, and the fork comparison pairing.

## Regression cases covered by tests

Identical input replay · changed input divergence · redacted input partial verification · duplicate boundaries · concurrent boundary ingestion · retried events after a lost acknowledgement · failed and missing acknowledgements · checkpoint observation only · valid checkpoint creation · missing snapshot · corrupted state hash (in transit and at rest) · incompatible host adapter · unsupported resume point · no server-side fabricated fork · genuine resumed fork · blocked network I/O and blocked side effect · parent/child lineage and upload validation · baseline fails the domain eval · candidate passes · no false improvement claim (independent rerun, unchanged fork, partially verified replay, identical evals) · privacy-preserving persistence and `STRUCTURE_ONLY` · execution-state labels · `personal_local` unlock with an access key.

## Reproduce

1. `npm ci && npm run build`. Start with a fresh `REEPROV_HOME`, synthetic `REEPROV_INGEST_KEY` and `REEPROV_ACCESS_KEY`: `npx next start -p 3013 -H 127.0.0.1`.
2. Pack the SDK: `cd packages/client-typescript && npx tsc -p . && npm pack`. Create an empty project outside the repo with `examples/external-agents/incident-triage/{adapter,agent,run-live}.mjs` and depend on the tarball.
3. `REEPROV_URL=http://127.0.0.1:3013 REEPROV_INGEST_KEY=… node run-live.mjs`
4. `REEPROV_ACCESS_KEY=… npx reeprov host-replay --server http://127.0.0.1:3013 --run <id> --adapter <project>/adapter.mjs --upload`
5. `… host-fork --checkpoint after_evidence --mutations mutations.json --upload`, using the two `state_patch` mutations listed in the sprint report.
6. Register `examples/external-agents/incident-triage/eval-suite.json` (`POST /api/evals/suites`). Evaluate both runs (`POST /api/evals/runs`), then `POST /api/runs/compare` with both evaluation run IDs and the replay ID.
