# Execution Integrity & Causal Trajectory Linkage

## 1. Monotonic Boundary Sequences

In Sprint 2, multiple boundaries within a single run could inadvertently share sequence indices or collide on IDs. In Sprint 3, monotonic boundary sequencing is an absolute invariant enforced during capture and verified in pre-flight planning.

### Invariants:
1. Every boundary has a globally unique `boundary_id` (format: `bnd_<type>_<runId>_<sequenceIndex>`).
2. For every run:
   ```
   boundary[0].sequence_index = 0
   boundary[1].sequence_index = 1
   ...
   boundary[n].sequence_index = n
   ```
3. No duplicate `sequence_index` is permitted under any circumstances.
4. Concurrency or branch lineage is represented using causal/parent metadata, not by overloading `sequence_index`.

---

## 2. Step ↔ Boundary Bidirectional Linkage

`ExecutionStep` is causal runtime truth:
- Every boundary must specify a valid `step_id` pointing to an existing step in `trajectory`.
- Each step maintains `boundary_ids`, `model_invocation_ids`, `tool_invocation_ids`, `retrieval_operation_ids`, and `memory_operation_ids`.
- No boundary may belong to multiple steps simultaneously.
- Decorative steps without boundary linkage or detached boundary orphan records fail execution integrity validation.

---

## 3. Pre-Flight Validation Engine (`validateExecutionIntegrity`)

```typescript
export interface ExecutionIntegrityReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  boundary_count: number;
  step_count: number;
  unlinked_boundary_ids: string[];
  unlinked_step_ids: string[];
}
```

Pre-flight validation verifies:
- Uniqueness of `boundary_id` across the run.
- Zero gaps in `sequence_index` from 0 to n.
- Referential validity between steps and boundaries.
- Content availability vocabulary: canonical enum (`CAPTURED`, `REDACTED`, `HASH_ONLY`, `TRUNCATED`, `NOT_CAPTURED`, `UNAVAILABLE`).
- Boundary type canonicalization: `retrieval_call` is standard; legacy `retrieval_service` is normalized.
