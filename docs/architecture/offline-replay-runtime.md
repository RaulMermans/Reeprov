# AgentPulse Deterministic Offline Replay Runtime Architecture

## 1. Overview and Core Invariant

The **AgentPulse Deterministic Offline Replay Runtime** proves the primary milestone of Sprint 3:

> **"Given a supported captured agent run, AgentPulse can reconstruct and validate the execution trajectory offline using the original application logic plus recorded nondeterministic boundaries."**

Unlike naive mocking or static trace viewing, the replay runtime executes authentic host agent code in an isolated execution harness where all non-deterministic external interactions (LLM calls, tool executions, vector searches, database queries, clocks, and pseudo-random generators) are resolved deterministically against recorded execution boundaries without live dependencies or network access.

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
  - Zero live network traffic (`fetch`, `http.request`, `https.request` blocked by active kill switch).
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
   In `STRICT_OFFLINE`, the `NetworkKillSwitch` activates to intercept socket and HTTP operations.
4. **Adapter Ingestion**:
   Host application interacts via `ReplayHostAdapter.getDependencies()`, routing `callModel`, `callTool`, and `callRetrieval` to `BoundaryResolver`.
5. **Divergence Detection**:
   Any deviation in boundary type, identity, input hash, step index, or side-effect intent triggers immediate divergence recording.
6. **Finalization & Persistence**:
   Output comparison against recorded terminal step summary, event log finalization, and persistence to `.agentpulse/replays/<id>.json` and Postgres `ap_replay_runs`.

---

## 3. Boundary Resolution & Ordering Semantics

- **Monotonic Cursor**: Boundaries are sorted by `sequence_index` (0..n). Cursor advances strictly by 1 upon valid substitution.
- **Identity Matching**: Matches `dependency_identity` (e.g. `anthropic:claude-3-5-sonnet`, `tool:get_customer_account`, `retrieval:pinecone_kb`).
- **Normalized Boundary Types**: Canonical types are enforced (`retrieval_call`, `model_call`, `tool_call`). Legacy aliases (`retrieval_service`) are normalized at ingestion.
- **Hash Verification**: `incomingHash = hashPayload(request.input)` must match recorded `input.hash`. Any parameter change (even 1 prompt character) triggers `INPUT_HASH_MISMATCH`.
