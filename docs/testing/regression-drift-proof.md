# Regression & Policy Drift Verification Proof

> **Canonical Role:** End-to-end reference proofs for Sprint 9 (Regression Detection, Capability History & Policy Drift).

---

## 1. Summary of Executed Reference Proofs

All reference proofs execute deterministically and are verified in `lib/core/regression/__tests__/regressionEngine.test.ts`:

| Proof | Target Scenario | Verification Criteria | Status |
| :--- | :--- | :--- | :--- |
| **Proof A** | Clean Candidate (No Regression) | Candidate matches or improves on baseline; zero regressions; `RegressionGateResult` status `PASS`; exit code `0`. | **VERIFIED** |
| **Proof B** | Case-Level Regression | Baseline passes 3 cases; Candidate fails case 2 (`case_policy_conflict`); detected as `CASE_REGRESSION`; gate status `FAIL`; exit code `1`. | **VERIFIED** |
| **Proof C** | Hard Safety Regression | Candidate passes functional tasks but fails prompt-injection defense; zero-tolerance safety rule triggers `CRITICAL` finding; gate status `FAIL`; exit code `1`. | **VERIFIED** |
| **Proof D** | Apples-to-Oranges Guard | Baseline evaluated on `suite@2 / dataset@2`; Candidate evaluated on `suite@5 / dataset@4`; `ComparabilityEngine` yields `NOT_COMPARABLE`; gate status `NOT_COMPARABLE`; exit code `2`; suggested bridge evaluation returned. | **VERIFIED** |
| **Proof E** | Behavioral Policy Drift | Candidate executes unannounced destructive tool (`database.drop_table`); `PolicyDriftDetector` flags `PERMISSION_EXPANSION` with `CRITICAL` severity and `has_critical_drift = true`. | **VERIFIED** |
| **Proof F** | Declared Policy Change | Explicit governance version bump (`v1` to `v2`) with documented permissions; `PolicyDriftDetector` classifies as `DECLARED_POLICY_CHANGE` with `INFO` severity and `has_critical_drift = false`. | **VERIFIED** |
| **Proof G** | Stochastic Variance Guard | Insufficient trials ($N=1$) under stochastic policy ($N_{min}=3$); metric drop flagged with honest non-definitive `OBSERVED_DROP` causal status. | **VERIFIED** |
| **Lifecycle Proof** | Baseline Immutability & Succession | Approved baseline is sealed with cryptographic digest; promoting next version produces `baseline_v2` and marks `baseline_v1` as `SUPERSEDED` without mutating historical evidence. Revocation preserves audit rationale. | **VERIFIED** |
| **Curation Proof** | Production Failure Curation | Incident `INC-9482` curated from live execution into a permanent regression case (`case_prompt_injection_order_cancel`) with full source provenance. | **VERIFIED** |
| **Capability Proof** | Multi-Dimensional Capability Tracking | Derives independent capability dimensions (`TASK_SUCCESS`, `SAFETY`, `TOOL_USE`); tracks dimensional drift; attributes +0.10 task gain to prompt update. | **VERIFIED** |
| **Release Proof** | Immutable Release Evidence Snapshot | Seals candidate version `v1.4.0` linking configuration hash, capability snapshot, policy snapshot, and regression gate result into tamper-evident digest. | **VERIFIED** |

---

## 2. Test Execution Command

Run the full Sprint 9 regression proof test suite:
```bash
npx vitest run lib/core/regression/__tests__/regressionEngine.test.ts
```

All 12 test specifications pass deterministically without external network calls or database dependencies.
