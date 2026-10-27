# Sprint 13 — External replay, checkpoint integrity and SDK contract

**Verdict: EXTERNAL_REPLAY_AND_FORK_VERIFIED** — with the limitations listed at the end.

A synthetic incident-triage agent ran as a separate process, in a fresh project outside this repository, with the TypeScript SDK installed from a packed tarball. Its run was captured over HTTP by a local production build of Reeprov. The developer-side runner then re-executed the agent's own step code offline: the replay was `MATCHED / VERIFIED`. The runner resumed the agent from a registered mid-run checkpoint with a policy mutation, and the fork was `COMPLETED`, starting at step 4 with 0 prefix steps re-executed. A deterministic domain eval suite failed the baseline and passed the fork. The improvement-claim gate returned `IMPROVEMENT_VERIFIED` on an evidence-backed divergence. The same sequence passed against the Docker image (`self_hosted` mode) and survived a container restart.

Branch `sprint/13-external-replay` starts at `origin/main` `14d09c1` (merged PR #22). Your original checkout had unrelated uncommitted changes, so the work was done in a separate worktree and those changes were not touched.

## Starting state, independently retested

Registry versions at start: npm `@reeprov/client@0.1.0-beta.1` (latest), PyPI `reeprov-client 0.1.0b1`. Sprint 12 had reported the PyPI package as missing; it now exists.

A reproduction against unchanged `main` (kept in the local evidence folder) confirmed S12's BLOCKED verdict, and found more:

| Defect on `main` | Observed |
| --- | --- |
| Concurrent boundary ingest loses records | 10 concurrent posts → 10 reported accepted, **1 stored** |
| Retry is not idempotent | identical retry → 2 boundaries |
| Different boundary reusing an id | silently overwritten, reported accepted |
| SDK `checkpointSaved` | stored as a `custom` boundary; 0 canonical checkpoints; makes replay `PARTIALLY_REPLAYABLE` |
| Raw checkpoint sent to `/complete` without snapshot or hash | stored with `restorable: true` |
| Fork without a host adapter | `GenericResumableHostAdapter` accepted any step and returned fabricated "resumed" output |
| Run index, trace events, canonical file | unlocked read-modify-write; non-atomic file writes |
| Trace event persistence failure | counted as accepted |
| Capture policy | no way for an HTTP client to choose `STRUCTURE_ONLY` / `SAFE_CONTENT` / `FULL_CONTENT` |
| Replay without host logic | re-fed recorded inputs to the resolver and could report a match. That checks evidence against itself, not application behavior. |

## What changed

### 1. Checkpoint observation vs restorable capture
- **Observation** (`checkpointObserved` / `checkpoint_observed`; the deprecated `checkpointSaved` now maps here): stored in a new `checkpoint_observations` list. It is never a boundary, never restorable, and never a fork point. A legacy `boundaryType: "checkpoint"` record from the published beta SDK becomes an explicit observation, and the per-record response says so (`OBSERVATION_RECORDED`). It is never converted into a restorable checkpoint.
- **Registration** (`registerCheckpoint` / `register_checkpoint`, `POST /api/runs/{id}/checkpoints` with `kind: "register"`) records:
  - a state snapshot and a `CheckpointReference` with `capture_kind: REGISTERED`
  - host step identity, resume step index/id and boundary cursor
  - the server-computed state hash, plus the client's canonical hash, which is checked to catch corruption in transit
  - the resume adapter identity

  It is rejected when: the run is not running; the cursor is ahead of acknowledged evidence; the state hash mismatches; the run is `STRUCTURE_ONLY`; or the id conflicts. A state that required redaction is stored but marked not restorable (`STATE_REDACTED`).
- **Advertising** (`lib/core/fork/restorability.ts`): `RESTORABLE` requires valid state **and** verified host resume capability. Verification is either a host probe with a matching adapter identity and `supportsResume`, or a stored child run that resumed from the checkpoint. The API and Studio show the assessment, never the raw `restorable` flag. Legacy checkpoints are `LEGACY_UNVERIFIED`.

### 2. Canonical ingestion
- One authoritative path, `lib/core/capture/ingestBoundaries.ts`, with a per-record result: `ACCEPTED`, `DUPLICATE`, `OBSERVATION_RECORDED` or `REJECTED` with a code (`BOUNDARY_ID_CONFLICT`, `SEQUENCE_CONFLICT`, `RUN_NOT_FOUND`, …). HTTP status is 200 / 207 / 422.
- Both SDKs assign stable `boundary_id = bnd:{run}:{seq}` and a per-run sequence, so a transport retry is idempotent. Unkeyed records from old clients are accepted with an `UNKEYED_BOUNDARY` warning.
- Storage concurrency: `lib/storage/runLock.ts` combines a per-run in-process mutex, a cross-process lock file and atomic tmp+rename writes. `mutateCanonicalRun` adds a transaction-scoped `pg_advisory_xact_lock` in Postgres mode. The run index has its own lock.
- Trace events: persistence failures are `REJECTED` (`PERSISTENCE_FAILED`), duplicates are `DUPLICATE`, and eval events without a verdict carry `EVAL_NOT_RECORDED`.
- Run start is idempotent and accepts `capture_policy.content_mode`. The mode is stored on the canonical run and applied to boundaries, checkpoints, observations, trace events and the final output. `/complete` and `/fail` keep canonical evidence and ignore raw `checkpoints`/`state` (reported as `RAW_CHECKPOINTS_IGNORED`).

### 3. Developer-side replay runner
`reeprov host-replay` (`lib/core/external/hostRunner.ts`, `scripts/host-runner-cli.ts`) runs on the developer's machine and loads the agent's `ReeprovHostAdapter`. It:
1. validates the replay plan and the start checkpoint;
2. re-executes the host steps, resolving each model/tool call with the existing `BoundaryResolver`;
3. rejects missing or divergent dependencies, and never executes side effects (they are substituted);
4. checks intermediate state against `AFTER_STEP` checkpoints and the final output against the recorded outcome;
5. returns `VERIFIED`, `PARTIALLY_VERIFIED` or `UNVERIFIED`, and can upload the result to `POST /api/runs/{id}/replays`. The server validates claim consistency and never executes code.

The in-process `ReplayRuntime` without host logic is now labelled `RECORDED_SELF_CHECK` / `UNVERIFIED`.

### 4. Genuine external fork
`reeprov host-fork` restores a registered checkpoint, applies `state_patch` or `tool_result_override` mutations, and runs the host from `resume_step_index`.
- Recorded responses are reused while inputs match.
- After divergence, side effects are blocked and simulated (`BLOCKED_SIMULATED`); a read-only call without a recording fails the fork.
- The child artifact carries lineage and a **resume proof**: executed step indices, prefix steps executed (must be 0), cursor, and restored/mutated state hashes.
- `POST /api/runs/{id}/forks` re-validates lineage, adapter identity, the resume proof, prefix non-duplication and the absence of live side effects before storing.
- The server `ForkRuntime` no longer has a generic fallback: an external checkpoint returns `HOST_ADAPTER_REQUIRED`.

### 5. Semantic improvement
- Reference agent: `examples/external-agents/incident-triage/`. The baseline policy ignores customer impact, so a payment-path incident is classified SEV3 and deferred to a ticket queue (a real side effect in its outbox).
- Domain suite: `eval-suite.json`, deterministic, 5 assertions: correct severity, required evidence `RB-PAY-001`, no deferral, pages on-call, and no unauthorized executed side effects.
- `assessImprovementClaim` (`lib/core/comparison/improvementClaim.ts`, exposed through `POST /api/runs/compare`) requires all of:
  - the same suite, failing on the baseline and passing on the candidate;
  - at least one fixed eval and no regressed eval;
  - a divergence that cites run evidence;
  - the candidate is a resumed fork with no live side effects;
  - the baseline replay is `VERIFIED`.
- Comparison of a fork is now fork-aware: boundaries are aligned from the checkpoint cursor, and state is compared against the parent's checkpoint snapshot. Index-based pairing had reported changes that never happened.

### 6. SDK parity (TypeScript and Python)
Run lifecycle, keyed boundaries, observation vs registration, eval evidence, acknowledgements (`IngestAck` / ack dict, `ok` is false whenever any record is unconfirmed or the server is unreachable), errors (`ReeprovIngestError`) and retries are the same in both SDKs. Canonical state hashing is byte-compatible with the server; a test checks this.

The host replay/fork runner executes JavaScript/TypeScript host adapters only. Python agents can capture and register checkpoints, but Python host replay returns `UNSUPPORTED_HOST_LANGUAGE`.

### Also fixed
- `personal_local` mode with `REEPROV_ACCESS_KEY` set: Studio could not be unlocked. Unlock issued no session, and every API call returned 401. Unlock now verifies the key and issues the session cookie.
- `.dockerignore` and the audits did not exclude the new evidence folder.
- Test isolation: the suite runs with `isolate: false`; a setup file now restores `process.env` after each file.
- Studio: execution-state badges (LIVE, RECORDED, FORKED, REPLAYED, PARTIALLY VERIFIED, UNSUPPORTED); a Replays tab; fork panel driven by assessments with the developer-side command for external adapters; timeline controls labelled as playback (no code runs); model/tool counts include captured boundaries.

## Not done / limitations
- **No LLM.** The agent's model call is a deterministic local summarizer recorded as `local/extractive-summarizer-v1`. No provider was configured and none was used.
- **The reference agent was written in this sprint** by the same author as the Reeprov changes. It ran as an independent process using only the public SDK, but it is not third-party code.
- **Network guard is application-level** interception of known Node APIs. It is not OS or container isolation.
- **Python host replay/fork is unsupported** (explicit error).
- **Release:** the owner approved releasing this work as `0.2.0-beta.1` (npm) / `0.2.0b1` (PyPI), through the gated release workflow from `main`. The earlier `0.1.0-beta.1` / `0.1.0b1` packages keep the old behavior: their checkpoint events become observations, and their unkeyed retries are not deduplicated.
- **The comparison `verdict` field stays `NEUTRAL`** for this pair, because it does not consume eval evidence. The improvement claim is the authoritative signal.
- **Regressions → Curated Tests** is static text and does not list saved cases. Curated cases are visible under Evaluate → Datasets.
- **Postgres advisory locking** typechecks and follows the existing persistence path, but it was not exercised against a live Postgres in this sprint. Concurrency was proven on the file store, both in-process and over HTTP.

See `docs/testing/S13-acceptance.md` for gate results and IDs, and `docs/security/S13-execution-boundaries.md` for execution boundaries.
