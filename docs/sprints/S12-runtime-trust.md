# Sprint 12 — Runtime trust

Status: **BLOCKED**. Branch `sprint/12-runtime-trust` starts at remote `main` commit `3dcb3a4bd2224c74bc514d0d43aac5a9d536bb89`. The original checkout had unrelated uncommitted files; this work uses a separate worktree.

## Confirmed defects and repairs

| Area | Reproduction / cause | Repair / proof |
| --- | --- | --- |
| Replay hash | Capture hashed sanitized inputs; replay hashed caller inputs. Sensitive input caused a false mismatch. | Replay uses the same sanitization, reports partial verification, and strict mode returns `INPUT_UNVERIFIABLE` when exact equality cannot be proved. Targeted replay tests cover ordinary, changed, redacted, missing, corrupt, identity, and legacy evidence. |
| Capture privacy | Sidecar construction forced `SAFE_CONTENT` despite `STRUCTURE_ONLY`. | Sidecars, boundary metadata, errors, snapshots, and final artifacts follow the selected content mode; pre-write validation rejects unsafe canonical artifacts before filesystem or PostgreSQL writes. |
| Fork persistence | Candidate boundaries bypassed normal boundary capture. | Candidate model boundaries use normalization; child artifacts and returned values are scrubbed. Synthetic secret regression covers this path. Existing unsafe historical artifacts require explicit remediation and are not rewritten. |
| Evaluation | Empty or invalid evidence could satisfy a non-regression gate. | Missing results, invalid verdicts, evaluator errors, and absent baselines fail closed. |
| External ingestion | Published SDK omitted boundary sequence and ID; two same-type calls generated one ID and one was overwritten. HTTP 200 with rejected records looked successful. | Server assigns sequence for omitted indices. SDK source checks per-record acknowledgement. The published beta SDK still lacks that client change. |
| Studio startup | `npm run start` invoked a script that only exported a function and exited. | Script now launches Next for local production mode. |
| Studio evaluation view | A post hoc passing critical eval was displayed under “Failed Evals” because severity was treated as verdict. | Passed results no longer become issues or failed cards; the independent missing-evidence warning remains visible. Chromium proof is in local evidence. |

## Dependency review

The resolved application uses Next.js 16.4.1 and Zod 4.6.7. PR #21 (Next) passed its checks; PR #20 (Zod) had a package-install `ECONNRESET`, not a code assertion failure. The branch updates each dependency independently and does not merge either PR. Production npm audit reported zero advisories after the update. Docker build, startup, auth rejection, and persistence across restart passed.

## Acceptance boundary

The TypeScript external agent executed synthetic incident triage and sent real telemetry. No model provider was configured, so the live model leg is `NOT_RUN`. The published SDK's checkpoint event does not create a canonical, restorable checkpoint, and no HTTP replay route exists. Consequently a complete external strict replay → fork → regression workflow is not yet proved. Do not describe this run as a successful deterministic replay or fork.

No release, package publication, merge, or PR is authorized until all premerge gates pass. See the acceptance report for exact commands and run IDs.
