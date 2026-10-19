# Reeprov Deterministic Offline Replay Runtime Architecture

## 1. Overview and Core Invariant

The **Reeprov Deterministic Offline Replay Runtime** proves the primary milestone of Sprint 3:

> **"Given a supported captured agent run, Reeprov can reconstruct and validate the execution trajectory offline using the original application logic plus recorded nondeterministic boundaries."**

Unlike static trace viewing, the replay runtime can execute host logic using recorded execution boundaries. Its in-process network guard intercepts known Node APIs; it does not provide OS-level isolation. Untrusted host code requires a separately network-isolated process or container.

```
                      RunArtifact (Canonical JSON)
                                 │
                                 ▼
                     ReplayPlanner (Pre-flight)
                                 │
                            ReplayPlan
                                 │
                                 ▼
                    ┌────────────────────────────┐
                    │      Replay Runtime        │
                    │  ├── State Restorer        │
                    │  ├── Boundary Resolver     │
                    │  ├── Network Guard         │
                    │  ├── Divergence Detector   │
                    │  └── Replay Clock/Random   │
                    └────────────┬───────────────┘
                                 │
                       ReplayHostAdapter
                                 │
                                 ▼
                    Host Agent Application Logic
```

---

## 2. Replay Lifecycle and Modes

### Replay Modes
- `STRICT_OFFLINE` (Default):
  - Known Node network and subprocess APIs are blocked by the active application-level guard. Zero network egress is not guaranteed for arbitrary host code.
  - Cryptographic input hash verification on every boundary (`sha256`).
  - Monotonic cursor tracking and strict identity matching.
  - Substituted recorded side-effects allowed; live external execution strictly forbidden.
  - Fail-fast divergence reporting.
- `BEST_EFFORT_OFFLINE`:
  - Continues past non-critical warning divergences.
  - Replaces unavailable payloads with stub summaries when permitted.
- `VALIDATION_ONLY`:
  - Runs pre-flight analysis without invoking application code.

### Execution Phases
1. **Planning & Pre-Flight**:
   The `ReplayPlanner` inspects schema version (1.x), monotonic boundary sequencing, bidirectional step-boundary linkage, and payload availability in the content store. Yields `REPLAYABLE`, `PARTIALLY_REPLAYABLE`, or `NOT_REPLAYABLE`.
2. **State Restoration**:
   The `StateRestorer` identifies `INITIAL_STATE` or the starting checkpoint, cryptographically verifies state hashes, and mounts state into the host adapter.
3. **Guard Activation**:
   In `STRICT_OFFLINE`, the `NetworkKillSwitch` activates before host-adapter initialization and intercepts known Node network and subprocess APIs. It is process-global and is not a security sandbox.
4. **Adapter Ingestion**:
   Host application interacts via `ReplayHostAdapter.getDependencies()`, routing `callModel`, `callTool`, and `callRetrieval` to `BoundaryResolver`.
5. **Divergence Detection**:
   Any deviation in boundary type, identity, input hash, step index, or side-effect intent triggers immediate divergence recording.
6. **Finalization & Persistence**:
   Output comparison against recorded terminal step summary, event log finalization, and persistence to `.reeprov/replays/<id>.json` and Postgres `ap_replay_runs`.

---

## 3. Boundary Resolution & Ordering Semantics

- **Monotonic Cursor**: Boundaries are sorted by `sequence_index` (0..n). Cursor advances strictly by 1 upon valid substitution.
- **Identity Matching**: Matches `dependency_identity` (e.g. `anthropic:claude-3-5-sonnet`, `tool:get_customer_account`, `retrieval:pinecone_kb`).
- **Normalized Boundary Types**: Canonical types are enforced (`retrieval_call`, `model_call`, `tool_call`). Legacy aliases (`retrieval_service`) are normalized at ingestion.
- **Hash Verification**: `incomingHash = hashPayload(request.input)` must match recorded `input.hash`. Any parameter change (even 1 prompt character) triggers `INPUT_HASH_MISMATCH`.
