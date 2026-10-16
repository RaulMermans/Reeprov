# Reeprov Run Lineage Architecture

## 1. Lineage Graph Model

Execution branching creates a tree of runs anchored by immutable checkpoints:

```
run_root (Root Artifact)
   │
   ├── checkpoint_1 (Step 1)
   │       │
   │       └── run_fork_A (Derived child)
   │
   └── checkpoint_2 (Step 2)
           │
           ├── run_fork_B (Derived child)
           │       │
           │       └── checkpoint_2B (Step 3)
           │               │
           │               └── run_fork_C (Grandchild)
           │
           └── run_fork_D (Derived child)
```

> **Core Invariant**: The parent run is never modified. The child run holds an explicit lineage contract identifying its parent, root, checkpoint anchor, and applied mutations.

---

## 2. Lineage Contract & Persistence

Defined in `lib/core/contracts/lineage.ts` and validated via `runLineageSchema`:

```typescript
export interface RunLineage {
  parent_run_id?: string;             // Direct parent execution ID
  root_run_id?: string;               // Ultimate root of the branch tree
  fork_checkpoint_id?: string;        // ID of checkpoint restored from
  fork_step_id?: string;              // Step ID where fork originated
  baseline_run_id?: string;           // Optional comparator run ID
  experiment_id?: string;             // Associated experiment run ID
  mutations?: AppliedMutationRecord[];// Controlled changes applied at branch point
  checkpoint_reference?: CheckpointReference; // Legacy compatibility mirror
}
```

### Database Persistence (`ap_runs`)
In Postgres/SQLite, lineage columns are indexed for high-performance hierarchy traversal:
- `parent_run_id TEXT REFERENCES ap_runs(run_id)`
- `root_run_id TEXT REFERENCES ap_runs(run_id)`
- `fork_checkpoint_id TEXT`
- `experiment_id TEXT`

---

## 3. The Non-Duplication Invariant

Reeprov strictly rejects duplicating historical prefix steps into derived runs:

### Why Duplicating Steps is Wrong:
1. **Falsification of Execution**: Claims steps executed in the child when they never ran in that process.
2. **Distorted Metrics**: Doubles reported token counts, latencies, and tool costs.
3. **Debugging Ambiguity**: Makes it impossible to distinguish between original and branched execution.

### Canonical Rule:
- **Child Run Artifact**: Contains **only** the steps, boundaries, and snapshots that actually executed post-fork (`stepsExecuted`).
- **Logical History Reconstruction**: Lineage metadata provides the cryptographic links to reconstruct the complete end-to-end execution path on demand.

---

## 4. Materialized Lineage View (`materializeLineageView`)

For developer tooling, UI debuggers, and visual timelines, the lineage module provides `materializeLineageView(parentArtifact, childArtifact)`:

```typescript
export interface MaterializedLineageStep {
  step: ExecutionStep;
  source_run_id: string;
  is_historical_prefix: boolean;      // True for steps from parent
  is_fork_execution: boolean;         // True for steps from child
}

export interface MaterializedLineageView {
  root_run_id: string;
  parent_run_id: string;
  child_run_id: string;
  checkpoint: CheckpointReference;
  mutations: AppliedMutationRecord[];
  steps: MaterializedLineageStep[];   // Prefix steps + Child steps
  boundaries: BoundaryInvocation[];  // Combined boundary sequence
}
```

The debugger UI renders the historical prefix in a distinct visual style (e.g. muted badge "Historical Prefix"), showing clearly where the branch diverged.

---

## 5. Lineage Graph Queries & Cycle Protection

The lineage engine in `lib/core/fork/lineage.ts` provides complete graph navigation:

- `getParentRun(store, runId)`: Retrieves the immediate parent.
- `getRootRun(store, runId)`: Traverses parents to locate the tree root.
- `getChildren(store, runId)`: Finds all direct branches of a run.
- `getAncestors(store, runId)`: Returns the full ordered path from root to run.
- `getDescendants(store, runId)`: Returns all transitive branches in the subtree.

### Cycle Detection
Corrupted or cyclic metadata is actively intercepted:
```typescript
if (visited.has(currentId)) {
  throw new LineageCycleError(
    `Lineage cycle detected: ${currentId} visited multiple times in path`,
    path
  );
}
```
Traversals maintain an active path set. Any cyclic reference throws `LineageCycleError` immediately, preventing infinite loops in graph rendering or evaluation suites.
