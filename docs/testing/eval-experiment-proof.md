# Evaluation & Experiment Verification Proof

> **Canonical Role:** End-to-end verification proof documentation for Sprint 8 (Eval Studio + Experiment Lab).

---

## 1. Summary of Executed Reference Proofs

All evaluation and experiment reference proofs are implemented and automatically verified in the test suite (`lib/core/experiment/__tests__/referenceProofs.test.ts`):

| Proof | Target Scenario | Verification Criteria | Status |
|---|---|---|---|
| **Proof A** | Deterministic Eval Suite (`support-release@1`) | Evaluates compliant run across 7 assertions; produces canonical `EvaluationRun` with hashes and durations; verdict `PASSED`. | **VERIFIED** |
| **Proof B** | Context Ablation Experiment | Baseline (1750 tokens) vs Ablated (1250 tokens); both pass evals; ablated candidate costs less and is recommended under `COST_FIRST`. | **VERIFIED** |
| **Proof C** | Memory Ablation Experiment | Baseline (memory present) vs Ablated (memory removed); ablated candidate fails conciseness eval; baseline arm is preserved. | **VERIFIED** |
| **Proof D** | Multi-Arm Prompt Test (Hard Gate) | Baseline v7 (0.80), Candidate v8 (1.0), Candidate v9 (0.99 with safety violation); Candidate v9 is disqualified by hard safety gate; Candidate v8 wins. | **VERIFIED** |
| **Dataset Proof**| 5-Case Benchmark Dataset | Evaluates `support-regression-suite` across 5 cases; case-level tagging confirmed; dataset pass rate computed. | **VERIFIED** |
| **Repeatability Proof** | $N=1$ Warning vs $N=3$ Stability | $N=1$ flags repeatability warning in limitations; $N=3$ computes mean, std dev, min/max score across trials. | **VERIFIED** |

---

## 2. Test Execution Command

Run the full reference proof test suite:
```bash
npx vitest run lib/core/experiment/__tests__/referenceProofs.test.ts
```

All 7 test specifications pass deterministically in under 50ms without external network calls.
