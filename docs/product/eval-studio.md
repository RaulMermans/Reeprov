# Product Surface: Eval Studio

> **Canonical Role:** Run-linked evaluation analytics, regression tracking, and aggregate benchmark visualization.

---

## 1. Job to Be Done

Evaluating AI agents requires moving beyond single-number test passes to multidimensional, run-linked evidence. Developers need to:
1. Aggregate eval pass rates, scores, costs, and latencies across runs, models, prompts, and versions.
2. Drill down directly from an aggregate score dip to the exact historical run, execution step, and failing evidence.
3. Track performance across 15 distinct eval families: task success, output validity, schema adherence, tool selection, argument validity, retrieval quality, context utilization, memory accuracy, trajectory efficiency, safety, approval compliance, regressions, cost, latency, and benchmarks.
4. Compare model/provider tradeoffs (e.g. Claude 3.5 Sonnet vs GPT-4o vs Gemini 1.5 Pro) across standardized test suites.
5. Prevent regressions by continuously validating historical failure cases against newly deployed agent iterations.

---

## 2. Data Required

- **`EvalResult[]`:**
  - `eval_id`, `eval_type` (`EvalFamily`).
  - `evaluator_id`, `evaluator_version`.
  - `target_run_id`, `target_step_id`, `target_node_id`.
  - `score`, `passed`, `threshold`, `metric`.
  - `severity`: `info`, `warning`, `fail`, `critical`.
  - `evidence_references`: Links to specific trace events, context items, or artifacts.
  - `grader_type`: `deterministic`, `model_based`, `human`.
  - `dataset_id`, `dataset_version`.
  - `findings`, `recommendation`.
- **Run Aggregates:** Total costs, latencies, error summaries, and lineage metadata.

---

## 3. Primary Views

- **Eval Scoreboard & Health Matrix:** High-level dashboard displaying pass rates, average scores, and volume trends categorized by eval family.
- **Score History Trends:** Time-series charts visualizing score trajectories across workflow versions, prompt revisions, and model upgrades.
- **Provider & Model Benchmark Comparison:** Side-by-side radar and bar charts comparing models on accuracy, latency, cost per 1k tokens, and failure frequency.
- **Drill-Down Investigation View:** Clicking any failing data point opens the exact underlying `RunArtifact` in Run Debugger with the failing step highlighted.
- **Regression Suite Monitor:** Dedicated tracker for historical bug fixtures, showing status (passing, failing, flaky) and quarantine states.

---

## 4. Primary Actions

- **Drill Down to Source Run:** Click from aggregate metric dip directly into the offending run's trajectory and context.
- **Filter by Eval Family or Grader:** Segment analytics by deterministic rule checks vs model-based evaluations.
- **Create Regression Test Case:** Convert any completed run or failing step into a persistent dataset benchmark case.
- **Export Benchmark Report:** Generate markdown/JSON summary of evaluation results for deployment sign-off.
- **Compare Test Runs:** Select two benchmark test runs and launch side-by-side evaluation diffing.

---

## 5. Dependencies

- Canonical `EvalResult` contract and `evalFamilySchema`.
- Linkage to `RunArtifact` (`target_run_id`, `target_step_id`).
- Run Store query capabilities for aggregate metrics.

---

## 6. Non-Goals

- **Built-in Synthetic Data Generation:** Does not automatically invent fake test datasets.
- **Replacing Benchmark Frameworks:** Complements external eval runners (e.g. Promptfoo, DeepEval, Ragas, Braintrust); does not replace them.
- **Autonomous Release Blocking:** Emits evaluation statuses; release gating policies are enforced by CI/CD systems.

---

## 7. Future Evals

- `regression`: Verification that previously resolved failure cases have not reoccurred.
- `model_benchmark`: Standardized capability evaluations across model releases.
- `safety`: Continuous guardrail stress testing.

---

## 8. Risks

- **Grader Non-Determinism:** Model-based graders may fluctuate between evaluations. Mitigation: capture `grader_type`, `evaluator_version`, and grading rationale in `metadata`.
- **Metric Fragmentation:** Teams defining conflicting metric names. Mitigation: enforce standardized `EvalFamily` categories with flexible custom metrics.
