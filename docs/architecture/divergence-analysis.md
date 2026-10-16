# Reeprov Divergence Analysis & Causality Attribution

## 1. Structural vs Meaningful Divergence

Reeprov distinguishes between mere mechanical variance and divergences that impact behavior or outcomes:

### First Structural Divergence
The earliest chronological point where the execution traces differ in any observable fact:
- Slight input hash differences
- Sub-50ms latency variations
- Safe context re-orderings

### First Meaningful Divergence
The earliest point where behavior diverged with potential consequence for downstream execution:
- Tool selection changed (e.g. `query_database` instead of `search_docs`)
- Tool argument changed (e.g. `customer_id: 1001` vs `customer_id: 1002`)
- Tool output changed (e.g. `balance: 150` vs `balance: 300`)
- Retrieval results altered (new results admitted to context)
- Model response semantic deviation
- Verification check or compliance guardrail status changed

Trivial differences (such as latency jitter < 50ms, cosmetic whitespace formatting, or timestamp changes) are flagged as non-meaningful.

## 2. Causality Attribution Vocabulary

Reeprov enforces a strict causal language contract:

| Causal Status | Meaning | Usage Criteria |
|---|---|---|
| `CONTROLLED_MUTATION` | The exact intentional change injected at a fork checkpoint or configuration experiment | Child fork mutation matching the target tool, parameter, or prompt |
| `CAUSALLY_SUPPORTED` | Downstream change directly preceded by and resulting from a controlled mutation | Downstream state, model response, or outcome following a controlled fork mutation |
| `PLAUSIBLE_CONTRIBUTOR` | A strong suspect for outcome differences in related or forked runs without full proof | Candidate change in a fork or experiment run preceding an outcome shift |
| `OBSERVED_DIFFERENCE` | A factual divergence without established causal link | General difference between independent runs |

**Rule**: The system never uses overconfident causal phrasing ("X caused Y") for independent runs without controlled experimental isolation.

## 3. Controlled Fork Attribution Isolation

Controlled forks offer a distinct advantage over independent run comparison:
1. Historical prefix up to the fork point is known and identical.
2. The mutation applied at the checkpoint is recorded in `RunArtifact.lineage.mutations`.
3. The first divergence is directly attributed to `CONTROLLED_MUTATION` with `origin_mutation_id`.
4. All subsequent divergences (modified tool calls, state changes, final answer revisions) are linked via `downstream_of_divergence_id` and classified as `CAUSALLY_SUPPORTED`.

## 4. Rule-Based Comparison Verdicts

Comparisons culminate in an objective verdict:
- `IMPROVED`: Candidate passes more tests/evals, achieves higher outcome status, or reduces cost/latency with identical pass rates.
- `REGRESSED`: Candidate fails previously passing tests, introduces policy violations, or outcome fails.
- `NEUTRAL`: Executions produced equivalent outcomes and metric deltas within tolerance.
- `MIXED`: Some metrics or tests improved while others degraded.
- `INCONCLUSIVE`: Outcome or metrics cannot be definitively compared.
