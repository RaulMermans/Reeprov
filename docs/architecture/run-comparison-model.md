# AgentPulse Run Comparison Model (COMPARE)

Sprint 6 introduces the canonical cross-run comparison engine for AgentPulse:
```
CAPTURE → INSPECT → REPRODUCE → FORK → PROVE → COMPARE → EVALUATE → REGRESSION
```

## 1. Core Architectural Separation

AgentPulse strictly separates two layers of comparison:
1. **Layer 1 — Deterministic Facts**: Exact structural diffs computed without model assistance.
   - Prompt/skill/model configuration changes
   - Step sequence additions, omissions, and modifications
   - Tool call arguments, outputs, latencies, and statuses
   - Boundary order, side-effect classifications, and replayability flags
   - Retrieval queries, candidate rankings, and scores
   - Memory reads, committed writes, and context insertions
   - Context snapshot contents, provenance, and token deltas
   - State mutations via JSON Pointer / JSON Patch paths
   - Verification evidence deltas (tests pass/fail, reviews, approvals, security policies)
   - Observability metrics (cost, duration, latency, token count)
   - Final run outcome statuses

2. **Layer 2 — Semantic Interpretation**: Evaluates meaning and nuances across natural language outputs, plans, retrieved contexts, and final answers.
   - LLMs or offline similarity heuristics may assist Layer 2.
   - **Crucial Invariant**: Layer 2 can never redefine, mask, or override Layer 1 facts.

## 2. Distinction from Replay Divergence

AgentPulse explicitly distinguishes between:
- **`ReplayDivergence`**: Answers *"Why did an attempted reproduction fail to match its recorded source execution?"* It detects recording anomalies, non-determinism, or unreplayable boundaries.
- **`RunComparison`**: Answers *"How do two valid, completed executions differ across their configuration, trajectory, state, and evidence?"*

`RunComparison` does not overload `ReplayDivergence`. Instead, it introduces dedicated contracts: `RunComparison`, `ComparisonDivergence`, `ComparisonAlignment`, `ComparisonDimension`, and `ComparisonFinding`.

## 3. Canonical RunComparison Schema (v1.0.0)

A `RunComparison` is a versioned, immutable standalone artifact derived from two source `RunArtifact`s:

```typescript
export const runComparisonSchema = z.object({
  comparison_id: z.string(),                  // Deterministic cmp_<hash>
  schema_version: z.string(),                // "1.0.0"
  baseline_run_id: z.string(),
  candidate_run_id: z.string(),
  project_id: z.string().optional(),
  relationship: runRelationshipSchema,        // INDEPENDENT | PARENT_CHILD | SIBLING_FORKS | REPLAY_SOURCE | SAME_EXPERIMENT | UNKNOWN
  created_at: z.string(),
  configuration_diff: configurationDiffSchema,
  execution_alignment: comparisonAlignmentSchema,
  divergences: z.array(comparisonDivergenceSchema).default([]),
  state_diffs: z.array(stateDiffSchema).default([]),
  context_diff: contextDiffSchema.optional(),
  memory_diff: memoryDiffSchema.optional(),
  retrieval_diff: retrievalDiffSchema.optional(),
  evidence_diff: evidenceDiffSchema,
  metrics_diff: metricsDiffSchema,
  outcome_diff: outcomeDiffSchema,
  first_structural_divergence: comparisonDivergenceSchema.optional(),
  first_meaningful_divergence: comparisonDivergenceSchema.optional(),
  semantic_comparisons: z.record(z.string(), semanticComparisonResultSchema).default({}),
  findings: z.array(comparisonFindingSchema).default([]),
  interpretation: z.string().optional(),
  verdict: comparisonVerdictSchema.default("INCONCLUSIVE"),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
```

## 4. Relationship-Aware Comparison

Comparisons classify the topological relationship between runs before alignment:
- `PARENT_CHILD`: Candidate is a fork of baseline (or vice-versa). Historical prefix is shared up to the fork checkpoint.
- `SIBLING_FORKS`: Both runs originate from the same root run or parent run.
- `REPLAY_SOURCE`: One run is an offline or sandboxed replay of the other.
- `SAME_EXPERIMENT`: Both runs belong to the same automated evaluation or test batch.
- `INDEPENDENT`: Two separate runs within the same project.

## 5. Dual-Mode Storage & Persistence

Comparisons are persisted independently of the underlying immutable runs:
- **File Mode**: Stored under `.agentpulse/comparisons/<comparison_id>.json`.
- **Postgres Mode**: Persisted across tables `ap_run_comparisons` and normalized rows in `ap_comparison_divergences`.

Cross-project comparisons are strictly blocked at the comparison engine boundary via `ProjectIsolationError`.
