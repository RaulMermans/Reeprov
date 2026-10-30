# Apart Research submission checklist

- [ ] Hypothesis remains falsifiable; no predetermined conclusion in the paper.
- [ ] SwarmGuard novel verifier implemented only in H1 (not P3).
- [ ] Baselines frozen before H1 (`baseline.per_agent.v1`, `baseline.pooled_event.v1`).
- [ ] Held-out oracles (`benchmark/oracles.heldout.v1.json`) not used for H1 tuning.
- [ ] Detector-visible exports used for all monitor inputs.
- [ ] Ground-truth isolation tests still passing.
- [ ] Every reported injection case is `experimental_validity: valid`.
- [ ] Offline fixture results labeled as such; live LLM results reported only with `provider_http_completed: true`.
- [ ] Metrics from `src/evaluate.ts`; zero denominators shown as undefined, not as 0% fake scores.
- [ ] Classification, attribution, and causal root-cause reported separately.
- [ ] Prior work: Reeprov P1/P2/P3 disclosed; starting commit recorded.
- [ ] Reproduction: commit SHA, benchmark hashes, commands, model ids, budgets.
- [ ] No API keys, raw secrets, or private chain-of-thought in the submission bundle.
- [ ] Paper does not invent results.
