# Apart Research submission checklist

- [x] Hypothesis remains falsifiable; no predetermined conclusion in the paper.
- [x] SwarmGuard / KARMA POLICE novel verifier implemented only in H1 (not P3).
- [x] Baselines frozen before H1 (`baseline.per_agent.v1`, `baseline.pooled_event.v1`).
- [x] Held-out oracles (`benchmark/oracles.heldout.v1.json`) not used for H1 tuning.
- [x] Detector-visible exports used for all monitor inputs.
- [x] Ground-truth isolation tests still passing.
- [x] Every reported injection case is `experimental_validity: valid`.
- [x] Offline fixture results labeled as such; live LLM results reported only with `provider_http_completed: true`.
- [x] Metrics from `src/evaluate.ts`; zero denominators shown as undefined, not as 0% fake scores.
- [x] Classification, attribution, and causal root-cause reported separately.
- [x] Prior work: Reeprov P1/P2/P3 disclosed; starting commit recorded.
- [x] Reproduction: commit SHA, benchmark hashes, commands, model ids, budgets.
- [x] No API keys, raw secrets, or private chain-of-thought in the submission bundle.
- [x] Paper does not invent results.
