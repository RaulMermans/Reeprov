# Architecture: Context & Memory Ablation

## 1. Controlled Ablation via Fork Runtime

Ablation is the scientific method of testing whether a piece of context or memory materially affected an agent's execution.

Instead of guessing or prompting an LLM to judge relevance, AgentPulse:
1. Identifies **Ablation Candidates** via deterministic signals (duplicates, high token share, low retrieval score, stale memory).
2. Clones the execution at a stable historical checkpoint using `ForkRuntime`.
3. Applies a `context_exclusion` or `memory_exclusion` mutation.
4. Executes the candidate in isolation.
5. Performs deterministic Layer 1 comparison via `compareRuns`.

---

## 2. Invariants & Safety Enforcements

### Non-Destructive Invariance
The parent `RunArtifact` is strictly immutable. Ablation forks produce a child run with explicit `lineage.mutations` pointing back to the parent run and checkpoint.

### Silent Replay Guard
When an ablation changes model input context:
- Reusing recorded baseline model outputs is **strictly prohibited**.
- The runtime requires a `candidateModelHandler` (or live model execution) to generate the new output under the mutated context.
- If no candidate handler is supplied, `ForkRuntime` rejects the fork with `ABLATION_REQUIRES_CANDIDATE_MODEL`.

### Non-Destructive Memory Policy
AgentPulse **never** performs destructive write operations against live external memory databases (such as calling `mem0.delete()` or `letta.delete_memory()`). Memory ablation is applied by filtering candidate context assembly and candidate memory operations during fork execution.

---

## 3. Causal Comparison Linkage

When `compareRuns(baseline, candidate)` executes:
- The context or memory exclusion is detected and assigned `causal_status = "CONTROLLED_MUTATION"`.
- Any resulting downstream differences in model input, model output, tool selection, or final outcome are assigned `causal_status = "CAUSALLY_SUPPORTED"`, linking back to `origin_mutation_id`.
- If the agent achieves identical success with the item excluded, the item is proven non-essential (saving tokens without regression).
- If the agent behavior alters or degrades, the causal necessity of that context/memory item is experimentally verified.
