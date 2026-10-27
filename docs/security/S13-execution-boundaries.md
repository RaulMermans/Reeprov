# Sprint 13 — Execution boundaries

## Where code runs

| Code | Where it executes | Never |
| --- | --- | --- |
| Agent (host) code, live | The agent's own process | — |
| Agent (host) code under replay or fork | The developer's machine, inside the `reeprov host-replay` / `host-fork` CLI process, loaded from a path the developer passes | **Never in the Reeprov server.** Upload routes only validate and store results. |
| Built-in reference adapter (customer-support fixture) | Server `ForkRuntime` | Third-party code is never registered there. External checkpoints return `HOST_ADAPTER_REQUIRED`. |
| Scanned repositories | Not executed (unchanged) | — |

The server accepts runner output only after validation:
- **Replays** (`POST /api/runs/{id}/replays`): schema, run identity, and internal consistency. `VERIFIED` requires `MATCHED`, no divergences, full input verification, a matched output, and host re-execution.
- **Forks** (`POST /api/runs/{id}/forks`): lineage, project, state validity of the checkpoint, adapter identity, resume proof (start step equals resume step, prefix steps executed = 0, cursor and restored state hash match), no parent-prefix boundaries, and no executed side effects.

Uploads require the dashboard key (`DASHBOARD_WRITE`), never the ingest key. Results are scrubbed under the run's capture policy before storage.

A runner-reported replay or fork is a claim made by the developer's own runner. The server checks that the claim is internally consistent and consistent with stored evidence. It cannot attest that the uploading machine ran unmodified code.

## Isolation is application-level

During replay and fork the runner activates `NetworkKillSwitch`. It intercepts `fetch`, `http(s)`, `net`, `tls`, `dgram`, `dns` and `child_process` in-process; attempts are recorded as `NETWORK_ATTEMPT_BLOCKED` and fail the replay or fork. This is **not** OS, process or container isolation: native addons, workers spawned before activation, or code that captured references earlier can bypass it. Untrusted host code must run in a separately network-isolated process or container before anyone claims zero egress.

## Side effects

- **Replay** substitutes the recorded result of side-effecting calls and never executes them. Each match is marked `side_effect_substituted`.
- **Fork**: while the child is still on the recorded path, recorded results are reused. Once it diverges, any non-read-only tool is `BLOCKED_SIMULATED`: not executed, recorded with status `skipped`, and the host receives `{ reeprov_simulated: true, executed: false }`. A divergent read-only call fails the fork; offline forks never call live tools.
- The `SIDE_EFFECT_COMPLIANCE` grader's `executed_only` option counts only side effects that actually executed.

## Checkpoint trust

- Observations are never restorable.
- A registered checkpoint is advertised as restorable only when its state is valid **and** host resume has been verified (host probe or stored resumed fork).
- The client sends a canonical SHA-256 of the state; the server recomputes it and rejects a mismatch.
- States that required redaction are stored redacted and marked not restorable (`STATE_REDACTED`): a redacted snapshot cannot reproduce the host's state.
- Credentials belong in host configuration, not in checkpointed state. The reference agent passes its synthetic metrics credential through adapter options.

## Privacy

- Each run's capture policy (`STRUCTURE_ONLY`, `SAFE_CONTENT`, `FULL_CONTENT`; redaction always on) is chosen at run start and applied to boundaries, checkpoint snapshots, observations, trace events and the final output.
- `STRUCTURE_ONLY` runs cannot register restorable checkpoints.
- Redacted inputs can only be **partially** verified during replay: any credential hashes the same after redaction. Strict mode refuses them (`INPUT_UNVERIFIABLE`).

## Fixed in this sprint
- `personal_local` with `REEPROV_ACCESS_KEY` set: unlock was a no-op while dashboard APIs required a session or key, which locked the operator out. Unlock now verifies the key and issues the HttpOnly session; the session endpoint reports that auth is required.
- The Docker build context and repository audits now exclude `s13-evidence/`, which holds local synthetic keys.

## Remaining risks
- Older SDKs (`0.1.0-beta.1`, `0.1.0b1`) send unkeyed boundaries. Transport retries from them can still duplicate records; the server flags `UNKEYED_BOUNDARY`.
- Historical runs stored before this sprint are not rewritten. Their checkpoints assess as `LEGACY_UNVERIFIED`.
- Postgres advisory locking was not exercised against a live database in this sprint.
