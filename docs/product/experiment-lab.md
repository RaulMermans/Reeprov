# Product Surface: Experiment Lab

> **Canonical Role:** Controlled experiment designer, execution forking workbench, and baseline vs mutant comparison engine.

---

## 1. Job to Be Done

When optimizing an AI agent, developers must avoid guessing. Changing a prompt or swapping a model might improve one query while breaking ten others.

Experiment Lab provides the controlled scientific framework:
1. Establish an immutable **Baseline Run** representing production behavior or a specific benchmark test.
2. Define a **Controlled Mutation Set** declaring exactly what is being tested (e.g. model change, temperature tweak, prompt revision, context inclusion/exclusion, memory ablation, tool schema modification).
3. **Fork** an execution from a chosen checkpoint step rather than re-running the entire workflow from scratch.
4. **Evaluate** both baseline and candidate runs against identical eval criteria.
5. **Compare** execution trajectories, state drift, cost, latency, and eval results to determine semantic divergence.
6. Make an evidence-backed **Promotion Decision** to accept, reject, or further iterate on the change.

---

## 2. Data Required

- **Lineage Contracts:** `RunLineage` with `parent_run_id`, `root_run_id`, `fork_step_id`, `baseline_run_id`, `experiment_id`.
- **Checkpoint Data:** `CheckpointReference` with `checkpoint_id`, `step_id`, and point-in-time state snapshot hash.
- **Controlled Mutations:** `ExperimentMutation[]`:
  - `mutation_type`: `model`, `model_parameters`, `prompt`, `context_inclusion`, `context_exclusion`, `memory_inclusion`, `memory_exclusion`, `retrieval_configuration`, `tool_exposure`, `tool_result_override`, `workflow_configuration`, `agent_configuration`.
  - `target_identifier`: Exact node, tool, or parameter targeted.
  - `original_value`, `mutated_value`.
- **Comparison Metadata:** `ComparisonMetadata` tracking `divergence_step_id`, metric deltas, and outcome verdict.

---

## 3. Primary Views

- **Experiment Matrix:** Overview of active experiments, showing baselines, declared mutations, variant runs, and status.
- **Split-Screen Execution Diff (Canvas & Timeline):** Side-by-side visualization of baseline vs mutant runs, highlighting identical steps in neutral tones and highlighting the exact step where trajectories diverged.
- **Mutation Declared vs Observed Inspector:** Detailed card validating that only the declared mutation differed at the fork point, ensuring experimental integrity.
- **Metric Delta Scorecard:** Clear table of deltas: $\Delta$ cost, $\Delta$ latency, $\Delta$ token count, $\Delta$ eval pass rate, and safety score changes.
- **Promotion Decision Gate:** Review view summarizing evidence, confidence scores, and regression risks before recommending promotion.

---

## 4. Primary Actions

- **Fork Run from Step:** Select any checkpoint step in an existing run and launch a new experiment branch.
- **Declare Mutation Set:** Use structured mutation builders (model picker, prompt editor, context exclusion toggles) without manual JSON manipulation.
- **Run A/B Comparison:** Trigger comparison engine over baseline and candidate runs.
- **Promote Candidate:** Mark an experimental run as the new baseline and export the mutation configuration as a code/config diff.
- **Discard Ineffective Experiment:** Archive an experiment with documented learnings and failure reasons.

---

## 5. Dependencies

- Canonical `RunLineage`, `CheckpointReference`, `ExperimentMutation`, and `ComparisonMetadata` contracts.
- Linkage to `RunArtifact` trajectory, state snapshots, and evals.
- Replayability semantics (`ExecutionBoundary`).

---

## 6. Non-Goals

- **Autonomous Production Deployment:** Does not push code or mutate live production agent infrastructure directly.
- **Brute-Force Hyperparameter Sweeps:** Does not spin up thousands of unconstrained training runs; focuses on targeted, developer-guided hypotheses.
- **Live Fork Execution Engine (in this sprint):** This sprint establishes the contracts and lineage schemas; execution runtime will follow.

---

## 7. Future Evals

- `regression`: Did the mutation introduce regressions compared to the baseline?
- `task_success`: Did the mutation improve overall completion rate?
- `cost`: Did the mutation achieve the targeted cost reduction without degrading quality?
- `latency`: Did the change reduce total execution time?

---

## 8. Risks

- **Uncontrolled Multi-Variable Drift:** Users mutating multiple parameters simultaneously, invalidating causality. Mitigation: warn when mutation set contains multiple conflicting variables.
- **State Divergence in Live Reruns:** External environments changing between baseline and fork. Mitigation: enforce replayability boundary classifications and sandboxed mock responses.
