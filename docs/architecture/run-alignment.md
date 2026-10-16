# Reeprov Run Alignment Engine

## 1. Overview

Comparing multi-step agent executions requires establishing correspondence between steps, boundaries, tool calls, and model calls across runs. Naive index-by-index comparison fails when steps are inserted, skipped, or reordered.

The `alignRuns()` engine deterministically aligns two runs without relying on non-deterministic LLM calls.

## 2. Lineage-Aware Materialization

When comparing a parent run and a fork child, the child artifact contains only its newly executed suffix:
```
Parent: [Step 0] -> [Step 1] -> [Step 2] -> [Step 3]
Child:                          [Step 2*] -> [Step 3*]
```

`materializeComparableRuns()` reconstructs the comparable views without mutating either artifact:
- **Prefix Steps (Step 0, Step 1)**: Tagged as `HISTORICAL_SHARED` with origin pointing to the parent run.
- **Parent Remaining Steps (Step 2, Step 3)**: Tagged as `BASELINE_ONLY`.
- **Child Fork Steps (Step 2*, Step 3*)**: Tagged as `FORK_EXECUTION`.

## 3. Step Alignment Fallback Hierarchy

Step alignment executes deterministically through five tiers:
1. **Shared Lineage / Stable IDs**: Identical step IDs guaranteed by fork inheritance.
2. **Explicit Node / Workflow IDs**: Match by workflow graph node IDs when available.
3. **Step Name & Relative Ordinal Order**: Exact match on step name and proximate position.
4. **Boundary Identities**: Steps invoking identical external dependencies (e.g., matching tool name and target).
5. **Sequence Alignment Heuristic**: Weighted similarity metric (names, boundary types, input summaries).
   - If similarity >= threshold (default 0.70):
     - If candidate match is unique or leads the runner-up by > 0.10: Tagged as `MATCHED` or `MODIFIED`.
     - If runner-up score is within 0.10: Explicitly tagged as `AMBIGUOUS`.

Aligned step statuses:
- `MATCHED`: Unchanged step execution.
- `MODIFIED`: Same logical step with different inputs, outputs, duration, or boundaries.
- `BASELINE_ONLY`: Step executed in baseline but omitted or skipped in candidate.
- `CANDIDATE_ONLY`: Step introduced in candidate run.
- `AMBIGUOUS`: Heuristic match with close contender; flagged for inspection rather than pretending certainty.

## 4. Boundary Alignment

Boundaries represent interaction with external dependencies (tools, models, retrieval, memory, HTTP).

`alignBoundaries()` correlates boundaries and identifies:
- `BOUNDARY_ADDED`: Boundary present in candidate only.
- `BOUNDARY_REMOVED`: Boundary present in baseline only.
- `BOUNDARY_REORDERED`: Boundaries executed in different sequence.
- `BOUNDARY_TYPE_CHANGED`: e.g. Tool call changed to direct model completion.
- `BOUNDARY_INPUT_CHANGED`: Payload hash delta in boundary input.
- `BOUNDARY_OUTPUT_CHANGED`: Payload hash delta in boundary output.
- `SIDE_EFFECT_CLASS_CHANGED`: e.g., `READ_ONLY` shifted to `EXTERNAL_WRITE` or `DESTRUCTIVE`.
- `REPLAYABILITY_CHANGED`: e.g., shift from `REPLAYABLE_RECORDED` to `VOLATILE_NETWORK`.
