# Reeprov Canonical Checkpoint Model

## 1. Overview and Core Invariants

In Reeprov, **checkpoints** provide durable, cryptographic recovery points for recorded agent executions. They form the foundation for **Fork from Here** execution branching.

> **Core Invariant**: A checkpoint is not a vague bookmark; it is an evidence-based, cryptographically verified anchor binding an immutable state snapshot to an exact boundary cursor and resume step.

```
RunArtifact
├── state[]                     (Immutable StateSnapshots)
├── boundaries[]                (Non-deterministic I/O sequence 0..N)
├── checkpoints[]               (Canonical recovery/fork points)
│    ├── chk_step_0 (cursor: 1, resume: 1)
│    ├── chk_step_1 (cursor: 3, resume: 2)
│    └── chk_step_2 (cursor: 4, resume: 3)
└── lineage                     (Ancestry: parent, root, mutations)
```

### Architectural Separation: Checkpoints vs. Lineage
- **Lineage** (`lineage`) describes ancestry: where an execution originated, what run spawned it, and what mutations were applied. Lineage is not a checkpoint store.
- **Checkpoints** (`checkpoints[]`) describe recovery locations: explicit execution states and boundary offsets available for replay or forking.
- For backward compatibility with legacy artifacts, `lineage.checkpoint_reference` is maintained as an optional mirror of the first checkpoint, but `RunArtifact.checkpoints[]` is the canonical truth.

---

## 2. Checkpoint Specification & Schema

Every checkpoint is validated against the versioned `checkpointReferenceSchema`:

```typescript
export interface CheckpointReference {
  checkpoint_id: string;              // Unique identifier (chk_<nanoid>)
  run_id: string;                     // Originating run ID
  step_id?: string;                   // Associated step ID
  state_snapshot_id: string;          // Strictly referenced StateSnapshot ID
  state_hash?: string;                // SHA-256 hash of referenced state
  boundary_cursor: number;            // Monotonic index of NEXT boundary to execute
  position: "BEFORE_STEP" | "AFTER_STEP" | "CUSTOM"; // Relative step anchor
  resume_step_index?: number;         // Next step index to execute upon restore
  resume_step_id?: string;            // Next step ID to execute upon restore
  restorable: boolean;                // Derived from snapshot availability and integrity
  label?: string;                     // Optional human-readable description
  timestamp: string;                  // ISO 8601 creation timestamp
}
```

### Precise Boundary Cursor & Resume Semantics
- `boundary_cursor`: The exact 0-indexed position of the **next** boundary that will execute when resuming.
  - Example: If Step 0 consumed boundary 0, and Step 1 consumed boundaries 1 and 2, an `AFTER_STEP` checkpoint at Step 1 has `boundary_cursor: 3`.
- `resume_step_index`: The 0-indexed position of the next step to execute in the host adapter.
  - For `AFTER_STEP` at Step 1, `resume_step_index: 2` (Step 2: Account Lookup).
- `position`:
  - `BEFORE_STEP`: State captured immediately before the step begins (resume index = current step).
  - `AFTER_STEP`: State captured immediately after step finalization (resume index = current step + 1).
  - `CUSTOM`: Arbitrary point within execution flow.

---

## 3. Snapshot Immutability & State Hashing

Historical execution state must never mutate after capture:

1. **Structured Clone Guarantee**:
   `captureState(state)` performs an immediate `structuredClone(state)` before hashing or storage. Mutations to in-memory application variables after calling capture cannot alter the recorded snapshot.
2. **Cryptographic Correspondence**:
   `checkpoint.state_hash` is computed as `sha256(canonicalJson(snapshot.state))`. It must match the snapshot referenced by `state_snapshot_id`. The hash is never derived from an arbitrary "last" snapshot.
3. **Evidence-Based Restorability**:
   `restorable: true` is set only when:
   - The snapshot is present in `artifact.state[]`.
   - The snapshot payload is fully available.
   - The state hash re-verifies successfully.
   If any validation condition fails, `restorable` evaluates to `false`.

---

## 4. Atomic Checkpoint API

Rather than separating snapshot capture and checkpoint registration into disconnected calls, the `CaptureSession` provides an atomic API:

```typescript
const chk = session.checkpoint(currentState, {
  stepId: "step_1",
  position: "AFTER_STEP",
  label: "post_policy_retrieval"
});
```

### Atomic Execution Pipeline:
1. Deep-clones `currentState` via `structuredClone`.
2. Computes SHA-256 hash across canonical JSON serialization.
3. Generates and stores `StateSnapshot` with unique ID and step linkage.
4. Identifies current monotonic boundary cursor count.
5. Derives `resume_step_index` and `resume_step_id`.
6. Instantiates `CheckpointReference` with `restorable: true`.
7. Appends checkpoint to `session.checkpoints[]` and mirrors to `session.lineage`.

---

## 5. Fail-Closed Restoration & Pre-Flight Validation

The restoration engine strictly enforces fail-closed behavior:

- **Explicit Checkpoint Request**:
  Requesting `restoreState({ checkpointId: "chk_nonexistent" })` throws `StateRestorationError` with code `CHECKPOINT_NOT_FOUND`. It **never** silently falls back to initial state.
- **Initial State Fallback**:
  Fallback to `INITIAL_STATE` occurs **only** when no checkpoint is explicitly requested (`checkpointId` is undefined).
- **Comprehensive Validation (`validateCheckpoint`)**:
  Before any fork or restore operation, checkpoints are verified for:
  - Checkpoint existence in artifact.
  - Run ID matching (rejecting cross-run checkpoint injection).
  - Referenced state snapshot presence and payload integrity.
  - State hash verification.
  - Boundary cursor range (`0 <= cursor <= boundaries.length`).
  - Restorable flag assertion.
