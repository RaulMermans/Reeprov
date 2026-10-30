# Cross-agent evidence verification for multi-agent claim monitoring

Paper skeleton for the Apart Research hackathon. **No results or conclusions are claimed here.**

## Title

TBD after H2. Working title: *Cross-agent evidence verification for unsupported claims in multi-agent systems*.

## Abstract

Placeholder. Do not fill with anticipated improvements.

## 1. Introduction

Multi-agent systems produce claims, tool evidence, and handoffs. Conventional monitors either inspect agents independently or pool event statuses. This paper will test whether cross-agent evidence verification improves detection and attribution of unsupported claims relative to those baselines.

## 2. Related work / prior-work disclosure

Disclose Reeprov (this repository), Sprint P1 runtime evidence contracts, Sprint P2 multi-agent testbed, and the two frozen P3 baselines. SwarmGuard's novel method is the H1 contribution and must not be described as already evaluated.

Prior public systems to cite during writing (do not treat this list as complete): agent tracing/observability, fact verification, debate/critique, tool-use monitoring. Exact citations belong in H3.

## 3. Hypothesis

Stated in `docs/research/swarmguard-methodology.md`. Falsifiable: if baselines match or beat SwarmGuard on held-out contradiction recall and attribution, the hypothesis is not supported.

## 4. Method

- Domains, agents, injections, capture, isolation: P2/P3 testbed
- Baselines: `baseline.per_agent.v1`, `baseline.pooled_event.v1`
- Proposed method: SwarmGuard (H1; unimplemented in P3)
- Evaluation: independent scorer in `src/evaluate.ts`
- Held-out partition: 16 cases, untouched during H1 development

## 5. Experiments

To be run in H2. Report offline fixture results separately from any live-model executions. Do not mix sample types.

## 6. Results

Intentionally empty.

## 7. Discussion

Intentionally empty. Pre-register limitations from the methodology doc.

## 8. Conclusion

Intentionally empty.

## Appendix

Reproduction commands, benchmark hashes, baseline versions, commit SHA.
