# Sprint 12 acceptance results

Status: **BLOCKED** while required gates remain incomplete.

| Gate | Result |
| --- | --- |
| Starting remote main | `3dcb3a4bd2224c74bc514d0d43aac5a9d536bb89`; isolated worktree created because original checkout was dirty. |
| Focused replay, privacy, fork, boundary tests | 56 passed in four files after boundary repair. HTTP privacy tests: 13 passed. SDK acknowledgement tests: 3 passed. |
| Full `npm run ci` | Passed on the final code: 125 files, 1,921 tests, lint, typecheck, rename/path audits, and Next.js 16.4.1 production build. |
| New targeted test count | 22 new tests. The requested 30–50 test matrix remains incomplete. Existing tests continue to cover additional replay, fork guard, eval, and Studio contracts; they are not counted as new. |
| Production `npm audit --omit=dev --json` | Zero advisories after Next 16.4.1 and Zod 4.6.7 update. |
| Full `npm audit --json` | Two moderate development-only findings in Vitest and `@vitest/mocker`; zero high or critical findings. Audit JSON is saved locally. |
| Docker build/start/persistence | Initial build failed: Linux `npm ci` found missing optional `@emnapi` lock entries. The lock was repaired from verified npm metadata. The final image was rebuilt after the Studio fix and returned health 200 with unauthenticated run read 401. An earlier acceptance container also returned authenticated run creation 201 and preserved its file in the mounted volume after restart. |
| TypeScript SDK source package | `npm run build --prefix packages/client-typescript`, `npm pack`, and fresh offline tarball install passed. This is an unreleased source package; the independent agent used the published beta. |
| Python published package | Direct PyPI lookup returned no distribution; published compatibility test unavailable. Local wheel build, fresh virtualenv install, 5 local unit tests, and a synthetic run against the Docker server passed (`s12-python-compat-001`). |
| IRIS dogfood | `npx vitest run tests/dogfood/irisDogfood.test.ts` passed 13/13 fixture-based tests. A fresh live IRIS execution was not run. |
| Live model | `NOT_RUN`: no legitimate provider or local model configured. |
| Browser | Chromium first install and connection wizard worked. Seven Studio routes, four run tabs, and narrow viewport loaded; final build showed the incomplete eval warning, observed tool count, and accessible mobile Settings link. A post hoc passing critical eval initially appeared under “Failed Evals”; the verdict/severity logic was corrected. The final browser check shows the post hoc pass and the separate incomplete evidence warning without a false failed or all-passed claim. Unaltered screenshots and a WebM video are under `s12-evidence/screenshots/`. |

## External TypeScript agent

The independent source is under `/private/tmp/reeprov-s12-external` and installs published `@reeprov/client@0.1.0-beta.1` from npm. All incident/customer values are synthetic. It called two read-only functions and a deterministic escalation predicate; the first execution failed its assertion and the corrected execution passed. No model call occurred.

| Execution | Run ID | Outcome | Evaluation event |
| --- | --- | --- | --- |
| Failure | `s12-external-failure-1792818694986` | FAILED | FAILED |
| Corrected independent run | `s12-external-candidate-1792818695182` | COMPLETED | PASSED |

The candidate is an independent execution, **not a fork**. Each initial run expected three boundary sends (two tools and one checkpoint event). Canonical GET returned two stored boundaries (one tool and one custom checkpoint-shaped boundary) and zero canonical checkpoints. After the server fix, a fresh published-SDK run stored all three boundaries in sequence:

| Execution | Fresh run ID | Stored boundaries | Canonical checkpoints |
| --- | --- | ---: | ---: |
| Failure | `s12-external-failure-1792836082122` | 3 | 0 |
| Corrected independent run | `s12-external-candidate-1792836082365` | 3 | 0 |

Strict offline replay of the fresh failure run returned `UNSUPPORTED`, because the checkpoint event normalized to an unsupported `custom` boundary. The safe offline fork API returned HTTP 400, `UNSUPPORTED`, `CHECKPOINT_NOT_FOUND`; zero steps and boundaries were executed. The checkpoint event is not a resumable checkpoint.

The two independent runs were compared as `cmp_8310946074e44a64`; Reeprov returned `NEUTRAL`, so this comparison is not fix proof. A deterministic suite checked only whether each run completed: failure evaluation `evrun_s12-synthetic-outcome_s12-external-failure-1792836082122_1792837028246` failed, candidate evaluation `evrun_s12-synthetic-outcome_s12-external-candidate-1792836082365_1792837028265` passed. These verdicts establish execution outcome, not the agent's escalation decision. The synthetic failure was curated as case `case_run_s12-external-failure-1792836082122_1792836990950` in dataset `s12-synthetic-incident-regressions`. The published SDK's original eval event lacked the required `eval_id` and remained unverified; post hoc results do not erase that gap. The sanitized comparison, eval runs, and regression dataset are in `s12-evidence/reports/`.

## Reproduction

1. Start the isolated local server with a fresh `REEPROV_HOME` and a synthetic `REEPROV_INGEST_KEY`.
2. Install published `@reeprov/client@0.1.0-beta.1` in a directory outside this repository.
3. Run `/private/tmp/reeprov-s12-external/incident-agent.mjs` with `REEPROV_URL` and the synthetic key set in the environment.
4. Query `/api/runs/<run-id>/canonical` and `/api/runs/<run-id>/checkpoints` with an authorized key. Compare stored boundary and checkpoint counts with the script output.

No raw key is included here or in the evidence folder.
