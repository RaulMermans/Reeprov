# Testing Proof: Context & Memory Intelligence Verification

## 1. Test Suite Coverage

Reeprov Sprint 7 Context & Memory Intelligence is validated through 4 specialized test suites and 2 canonical reference fixtures:

| Test Suite | Purpose | Tests | Status |
| :--- | :--- | :--- | :--- |
| `lib/core/contracts/__tests__/canonicalContracts.test.ts` | Validates canonical fixtures J & K against Zod schemas | 26 | PASS |
| `lib/core/intelligence/__tests__/contextIntelligence.test.ts` | Decision-scoped composition, churn, token measurement, retrieval admission, tool exposure bloat | 15 | PASS |
| `lib/core/intelligence/__tests__/memoryIntelligence.test.ts` | Lifecycle evolution, stale memory injection, duplicate detection, write failure tracking | 11 | PASS |
| `lib/core/intelligence/__tests__/ablationProofs.test.ts` | End-to-end controlled ablation fork proofs & silent replay guards | 4 | PASS |

---

## 2. Canonical Reference Fixtures

### Fixture J: Context Ablation Baseline (`fixture-j-context-ablation-baseline.json`)
- **Run ID**: `run_fixture_j_context_ablation_baseline`
- **Canonical State Hash**: `sha256:2be7cda68af50cc3e998eff87402cda4f86469b898109441ddd95c3dc1b269f0`
- **Scenario**: 1,750-token decision context containing an irrelevant duplicate shipping note chunk (500 tokens).
- **Ablation Proof**: Ablating `ctx_item_irrelevant_duplicate` reduces tokens to 1,250 while producing equivalent task success. Comparison divergence confirms `CONTROLLED_MUTATION` with 0 regression.

### Fixture K: Memory Ablation Baseline (`fixture-k-memory-ablation-baseline.json`)
- **Run ID**: `run_fixture_k_memory_ablation_baseline`
- **Canonical State Hash**: `sha256:b087d19973573aeb4a148e5db8ec5a7668dc0c1089328c2e0bc87e9f7a96221e`
- **Scenario**: Injected user style preference `mem_concise_01` ("Keep customer answers under 2 sentences").
- **Ablation Proof**: Ablating `mem_concise_01` causes downstream model response to diverge to a verbose 3-sentence reply. Comparison confirms `CONTROLLED_MUTATION` for memory/context, and `CAUSALLY_SUPPORTED` for downstream model output divergence.

---

## 3. Enforcement Proofs

1. **Silent Replay Guard:** When context or memory is ablated without providing a candidate model handler, `ForkRuntime` strictly errors with `ABLATION_REQUIRES_CANDIDATE_MODEL`, preventing dishonest baseline output replay.
2. **Immutability Invariance:** The baseline run artifact hash and structure remain 100% unaltered before, during, and after ablation fork execution.
