# AgentPulse Sprint 6: Run Diff & Divergence Proof Report

## 1. Executive Summary

Sprint 6 implements the **COMPARE** stage of the AgentPulse pipeline:
```
CAPTURE → INSPECT → REPRODUCE → FORK → PROVE → COMPARE → EVALUATE → REGRESSION
```

All 19 core requirements and 3 canonical reference proofs have been verified against the production test suite:
- Total test files: **92**
- Total test cases: **1,585**
- Passing tests: **1,585 (100%)**
- TypeScript strict errors: **0**
- ESLint errors: **0**
- Next.js build: **Success (32 routes compiled)**

## 2. Canonical Reference Proofs

### Reference Proof #1: Sprint 4 Controlled Balance Fork
- **Baseline**: Canonical customer triage run (`run_vertical_slice_ref_001`), customer balance = 150 USD.
- **Candidate Fork**: Forked child at checkpoint `chk_parent_step_1` with mutation `tool_result_override` on `get_customer_account` setting balance to 300 USD.
- **Verification**:
  - `detectRunRelationship()` classified topology as `PARENT_CHILD`.
  - Prefix steps 0 & 1 materialized as `HISTORICAL_SHARED` pointing to parent run without mutating either artifact.
  - First meaningful divergence located at step 2 (`get_customer_account`) tagged with `causal_status: CONTROLLED_MUTATION` and `origin_mutation_id: mut_bal_300`.
  - Downstream state snapshot divergence detected at `/customer/balance` (`150 -> 300`).

### Reference Proof #2: Sprint 5 Prompt Configuration Fork
- **Baseline**: Prompt configuration `support@7`.
- **Candidate Fork**: Controlled configuration mutation upgrading prompt to `support@8`.
- **Verification**:
  - `diffConfiguration()` cleanly isolated `changed_prompts: true` and indexed modified prompt under `prompts.support`.
  - Divergence tagged as `CONTROLLED_MUTATION` with `origin_mutation_id: mut_prompt_v8`.
  - Model, tools, skills, and permissions correctly reported as unchanged.

### Reference Proof #3: Evidence Plane Delta (FAILED -> PASSED)
- **Baseline**: Run failing compliance test and receiving review `CHANGES_REQUESTED`.
- **Candidate**: Run passing all tests and receiving `APPROVED` review status.
- **Verification**:
  - `diffEvidencePlane()` identified `test_results: 0/1 -> 1/1` and `review_results: CHANGES_REQUESTED -> APPROVED`.
  - Rule-based verdict evaluator assigned verdict `IMPROVED`.

## 3. Direction-Normalized Metrics

Observability diffing protects against zero-division errors and honors metric polarity:
- **`LOWER_IS_BETTER`**: Latency, total duration, cost, error counts. A reduction (negative delta) is classified as an improvement.
- **`HIGHER_IS_BETTER`**: Test pass rate, token efficiency, eval scores. An increase (positive delta) is classified as an improvement.
- **Zero-Division Protection**: Baseline metric of 0 yields percentage delta `0%` or `null` without throwing `NaN` or `Infinity`.

## 4. Visual Proof Layer Execution Canvas

The visual canvas supports comparison mode with visual tokens:
- `SAME`: Gray node border.
- `MODIFIED`: Amber node border.
- `BASELINE_ONLY`: Red dashed border.
- `CANDIDATE_ONLY`: Blue solid border.
- `FIRST_DIVERGENCE`: Pulsing purple badge and highlight.
