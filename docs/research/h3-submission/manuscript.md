# KARMA POLICE: Cross-Agent Evidence Verification for Multi-Agent Oversight

## Abstract

Multi-agent systems pass assertions between agents, and downstream decisions may rely on upstream statements that are unsupported, stale, altered in transit, or contradicted by recorded evidence. We ask whether cross-agent claim-to-evidence verification can detect such statements that per-agent and pooled-event monitoring miss. We present KARMA POLICE, a deterministic, zero-token verifier that indexes tool observations, test results, artifact versions, and handoffs across all agents in a canonical REEPROV trace, resolves each extracted claim to supported, contradicted, or unverified, and reports provenance anomalies in a separate channel. In a post-freeze evaluation of 16 experimenter-authored synthetic scenarios (88 gold claims, clustered within scenarios; software-engineering and investigation domains), KARMA POLICE made 68/88 correct classifications, compared with 52/88 for a frozen pooled-event heuristic and 29/88 for a frozen per-agent heuristic. Its contradiction recall was 16/20, versus 4/20 and 0/20, and none of the 36 contradicted or unverified claims was labeled supported. It also made 20 errors: six false contradictions, eleven incorrect abstentions, and three missing predictions under structure-only capture. In an offline, deterministic reproduction of a handoff-integrity failure in the Microsoft Agent Framework, it classified 6/6 tampered-episode claims correctly, whereas both baselines classified 1/6. The results are restricted to our monitors, domains, and small clustered sample, and the evaluation was not third-party blind.

## 1. Introduction

In a multi-agent workflow, an agent's output becomes another agent's input. A planner summarizes a tool result for a coder, a coder reports test status to a reviewer, and a reviewer approves a release on that basis. Each handoff is a point at which a downstream decision can come to rest on an assertion that is unsupported by any recorded observation, refers to a superseded artifact version, was altered between producer and consumer, or is contradicted by evidence recorded elsewhere in the run. Taxonomies of multi-agent failure describe information withholding, inter-agent misalignment, and inadequate verification as recurring failure modes (Cemri et al., 2025; Hammond et al., 2025), and injected content has been shown to propagate across agent boundaries (Lee & Tiwari, 2024).

A monitor that examines each agent in isolation cannot detect a contradiction whose resolving evidence was produced by a different agent. A monitor that pools events without tracking which agent produced which evidence, and which version of an artifact, can be misled by evidence that is unrelated, stale, or non-authoritative. This paper studies a monitor that binds each claim to indexed cross-agent evidence.

**Research question.** Can cross-agent claim-to-evidence verification detect unsupported or contradicted statements that conventional per-agent and pooled-event monitoring misses? We treat this as a falsifiable question about a specific verifier, two specific frozen baselines, two synthetic domains, and a small sample. We do not claim the answer generalizes beyond them.

Our main contributions are:

1. **A deterministic verifier.** KARMA POLICE resolves each extracted claim against a cross-agent evidence index to *supported*, *contradicted*, or *unverified*, abstains when capture or evidence is insufficient, and reports provenance-integrity anomalies in a channel kept separate from factual correctness.
2. **A post-freeze evaluation with a negative-result account.** On 88 gold claims in 16 scenarios, scored against frozen heuristic baselines after the detector was frozen, we report all 20 detector errors by mechanism, and the scenarios in which a baseline was as accurate or more accurate.
3. **A controlled external demonstration.** We run a pinned Microsoft Agent Framework handoff workflow with an experimenter-authored offline chat client and a tampered handoff, and report how the three monitors classify its claims.

## 2. Related Work

**Multi-agent risks and failure taxonomies.** Hammond et al. (2025) organize multi-agent risks into miscoordination, conflict, and collusion, with information asymmetry as a contributing factor. Cemri et al. (2025) derive an empirical failure taxonomy from annotated traces of multi-agent LLM frameworks, including inter-agent misalignment and incomplete task verification. Lee & Tiwari (2024) show prompt injection propagating between agents. These works characterize what goes wrong; they do not provide a deterministic claim-level verifier. Orchestration frameworks such as AutoGen (Wu et al., 2024) and MetaGPT (Hong et al., 2024) create the handoff structure studied here.

**Failure attribution.** Zhang et al. (2025) study automated attribution of task failures to an agent and a step, using LLM-based methods on failed trajectories. Attribution answers *who and when* after a known failure. KARMA POLICE instead classifies individual claims whether or not the task failed, and reports only *observable* attribution, namely the agent and event that made a claim. It does not infer causal responsibility, and we report causal attribution as not attempted.

**AI control and oversight.** AI control studies protocols that bound harm when a model may act adversarially, including trusted monitoring (Greenblatt et al., 2024; Bhatt et al., 2025). Debate frames oversight as adjudicating competing claims by examining evidence (Irving et al., 2018). GuardAgent uses an LLM-generated guard to check a target agent's behavior against policy (Xiang et al., 2025). Our verifier is not adversarially evaluated and is not a control protocol; it is a deterministic claim-checking component that could serve as one input to such protocols.

**Observability and trace-based verification.** Chan et al. (2024) argue for agent identifiers, real-time monitoring, and activity logs, and Dong et al. (2024) taxonomize telemetry for agent observability. These works motivate and specify trace collection. We assume such a trace exists and study a verification step over it.

**Evidence and provenance.** Claim decomposition and three-way verification against evidence are established in fact verification (Thorne et al., 2018; Min et al., 2023), where evidence is a text corpus. W3C PROV-DM (Moreau & Missier, 2013) models lineage among entities, activities, and agents. KARMA POLICE adapts the three-way label space to evidence drawn from the *same run* (tool observations, system-recorded tests, versioned artifacts, and handoffs), and borrows the idea of lineage for a typed anomaly channel. We make no claim of general novelty. We did not compare against LLM-based monitors, trace-attribution systems, or commercial observability products, and the comparison here is limited to two simple frozen heuristics.

## 3. Methods

**Pre-existing and hackathon work.** *Before the hackathon* we had built REEPROV (canonical run capture and runtime), the P1–P3 testbed, the two frozen baselines, and the evaluation tooling (`evaluation.v2`). *During the hackathon* we built the KARMA POLICE verifier (H1), made correctness fixes (H1-R), added a pre-freeze correction for negation, denial, and universal-statement false support (commit `5a4bcb59`), ran the post-freeze evaluation and failure analysis (H2), wrote the external-framework adapter, and wrote this manuscript (H3).

**Inputs.** The verifier consumes a canonical REEPROV run artifact: trajectory steps, tool calls, system-recorded test outcomes, versioned artifacts, agent assertions, and inter-agent handoffs. Scanned or recorded content is treated as untrusted data; the verifier never executes it and no model is called.

**Claim extraction and evidence indexing.** Claims are the agent assertions and handoff payload statements in the artifact. A single pass builds an index of (i) artifact versions with stale flags, (ii) authoritative evidence (system-recorded test outcomes and tool records), (iii) documentary records, with witness statements and rumors treated conservatively, (iv) each producing agent's recorded turn state and each delivered handoff, and (v) reference resolution (in-run, cross-run, stale, unresolved).

**Cross-agent resolution.** For each claim the resolver applies, in order: (1) a producer-versus-delivered check, comparing a delivered handoff with the producer's canonical turn state; (2) binding to authoritative test or tool predicates, abstaining if the validation was never executed; (3) checking explicit token-to-target mappings and set-domain statements against recorded artifact contents; and (4) clause-local negation and polarity matching against documentary records, with a counterexample scan for universal statements. A claim that no rule resolves is *unverified*. Capture completeness is checked first: where claim text is omitted (`STRUCTURE_ONLY` capture), the verifier abstains with an incomplete-capture marker or emits no prediction.

**Factual versus provenance-integrity outputs.** The primary output is the three-way label with the originating agent and event. Typed provenance anomalies (cross-run reference, stale artifact reference, unexecuted observation, unresolved reference, missing resolving evidence, producer-delivered mismatch) are emitted in a companion channel and never folded into factual accuracy (Figure 1, on the first landscape page after Author Contributions).

**Baselines.** Both baselines are frozen, simple heuristic reference monitors, not state-of-the-art, commercial, or LLM-based monitors. *Per-agent* resolves a claim only from the claiming agent's own cited tools or tests and abstains otherwise. *Pooled-event* resolves claims from a pool of events without agent-level or artifact-version indexing, using status-style heuristics. Their source files and the detector were verified byte-identical to the freeze commit by a zero-diff check (`git diff 5a4bcb59 -- src/karmaPolice src/baselines`) enforced in continuous integration.

**Domains and evaluation protocol.** Two domains were used, software engineering (8 scenarios, 41 gold claims) and investigation (8 scenarios, 47 gold claims). Gold labels are *supported* (52), *contradicted* (20), and *insufficient evidence*, mapped to *unverified* (16). Scenarios were authored by the experimenter, executed in `offline_fixture` mode (no model calls), and stored in a sealed pack with a published SHA-256 commitment (`5f380067…1132`). The protocol had five stages: freeze the detector and baselines; generate and seal the pack outside version control; run all three monitors with detector-only access, so that the detector bundle contains no oracle fields (checked by a leak scan); hash and commit all predictions; and only then read oracle labels and score with `evaluation.v2`. Missing predictions are scored as errors.

**Limits of oracle isolation.** Isolation was enforced by code and process, not by an independent party. The experimenter wrote the verifier, the evaluation harness, and the scenarios. The evaluation is therefore post-freeze but not blind in the third-party sense.

**External demonstration.** We ran the original handoff workflow and tools from Microsoft Agent Framework (Microsoft, 2026), pinned at commit `82f03c81aba5c5e4b1b36589027470bc5d094422`, with an experimenter-authored deterministic offline chat client; no live provider HTTP completion occurred. A control episode (4 gold claims) and a tampered episode (6 gold claims) were captured through an observer and converted to REEPROV artifacts. In the tampered episode the delivered handoff text was altered relative to the producer's recorded output. The "refund" is a call to an example tool that returns a string, not a financial transaction.

## 4. Results

**Primary post-freeze evaluation.** Table 1 gives matched-monitor results on the same 88 gold claims. The 88 claims are clustered within 16 scenarios and are not 88 independent runs; we report no significance tests, and the sample does not support them.

| Monitor | Accuracy | Cond. accuracy | Contradiction recall | Contradiction precision | False support, non-supported | Coverage | Abstention |
|---|---|---|---|---|---|---|---|
| Per-agent (frozen) | 29/88 (33.0%) | 29/85 (34.1%) | 0/20 (0.0%) | 0/4 | 14/36 (38.9%) | 85/88 | 47/88 (53.4%) |
| Pooled-event (frozen) | 52/88 (59.1%) | 52/85 (61.2%) | 4/20 (20.0%) | 4/12 (33.3%) | 25/36 (69.4%) | 85/88 | 2/88 (2.3%) |
| KARMA POLICE | 68/88 (77.3%) | 68/85 (80.0%) | 16/20 (80.0%) | 16/22 (72.7%) | 0/36 (0.0%) | 85/88 (96.6%) | 24/88 (27.3%) |

*Table 1. Matched-monitor classification on the post-freeze pack (16 scenarios, 88 gold claims, `offline_fixture`). "False support, non-supported" is the fraction of contradicted or unverified gold claims labeled supported. Coverage is claims with a prediction; three claims in one scenario received none from any monitor.*

Accuracy and recall should be read together with the label prior: 52 of 88 gold claims are *supported*, so a trivial classifier that always answers *supported* would score 52/88 (59.1%), equal to the pooled-event accuracy, with 0/20 contradiction recall. The pooled-event heuristic labeled 71 of 85 covered claims *supported*.

Table 2 breaks results down by domain.

| Domain (claims) | Monitor | Accuracy | Contr. recall | Contr. precision | Abstained | Provenance anomalies |
|---|---|---|---|---|---|---|
| Software eng. (41) | Per-agent | 20/41 | 0/8 | 0/3 | – | – |
| | Pooled-event | 26/41 | 4/8 | 4/11 | – | – |
| | KARMA POLICE | 34/41 (82.9%) | 5/8 (62.5%) | 5/7 | 11/41 | 9 (4 scenarios) |
| Investigation (47) | Per-agent | 9/47 | 0/12 | 0/1 | – | – |
| | Pooled-event | 26/47 | 0/12 | 0/1 | – | – |
| | KARMA POLICE | 34/47 (72.3%) | 11/12 (91.7%) | 11/15 | 13/47 | 5 (4 scenarios) |

*Table 2. Per-domain results. KARMA POLICE errors by domain: software engineering, 2 false contradictions, 2 supported claims abstained, 3 contradicted claims abstained (7 total); investigation, 4 false contradictions, 5 supported and 1 contradicted claims abstained, 3 missing predictions (13 total). A dash marks a quantity not tabulated per domain for the baselines; Appendix B gives per-scenario counts.*

All three monitors reported the originating agent for 85/88 claims (96.6% coverage), correct for 85/85, and the event or handoff for 85/85. Causal responsible-agent attribution was not attempted by any monitor. KARMA POLICE emitted 14 provenance anomalies across 8 of 16 scenarios; these are not part of the accuracy figures.

**Scenario-level heterogeneity.** KARMA POLICE had higher per-scenario accuracy than both baselines in 8 scenarios, tied the best baseline in 3 (`h2-se-01`, `h2-se-06`, `h2-inv-08`), and was less accurate than at least one baseline in 5 (`h2-se-03`, `h2-se-07`, `h2-inv-01`, `h2-inv-05`, `h2-inv-07`). In `h2-se-07` it scored 1/5 against 3/5 for pooled-event, and in `h2-inv-01` 3/6 against 6/6 (Appendix B).

**Error analysis (20 errors).** (a) *Six false contradictions* (supported claims labeled contradicted): two from a numeral-word match (“zero” mapped to `0`) colliding with a digit in a hostname (`h2-inv-05`); two from checking a sum across two records (4 + 5 = 9) against each record separately (`h2-inv-07`); and two from a redaction placeholder rewritten during sanitization, combined with a mapping pattern that matched a field name (`h2-se-03`). (b) *Eleven incorrect abstentions* (seven supported and four contradicted claims labeled *unverified*) on claims stated in free-form natural language that the structural rules do not parse: paraphrases of eviction policy (`h2-se-07`, 4), claims that a rumor was uncorroborated hitting the conservative rumor guard (`h2-inv-01`, 3), an idiomatic physical-state antonym (`h2-inv-07`, 2), an unlisted anomaly phrase (`h2-inv-04`, 1), and a custom nested payload key (`h2-se-04`, 1; the downstream claim in that scenario was still labeled contradicted). (c) *Three missing predictions* in `h2-inv-08`, where `STRUCTURE_ONLY` capture omits claim text for all monitors.

**Secondary, non-blind benchmark.** On the 16 public held-out cases of `p3.benchmark.v1.1` (85 claims), whose oracle labels are public in repository history, accuracy was 34/85 (per-agent), 66/85 (pooled-event), and 71/85 (KARMA POLICE), with KARMA POLICE contradiction recall 11/14 and 4 false contradictions among 71 non-contradicted claims. This is a regression check, not independent evidence, because the detector was developed with access to those labels.

**External demonstration.** In the control episode (4 gold claims) KARMA POLICE was correct on 4/4, and both baselines on 3/4. In the tampered episode (6 gold claims; 1 supported, 4 contradicted, 1 unverified) KARMA POLICE was correct on 6/6 with contradiction recall 4/4, and both baselines were correct on 1/6 with recall 0/4 (Figure 2, on the second landscape page). KARMA POLICE labeled the altered handoff *contradicted* directly through a producer-versus-delivered mismatch against the producer's recorded turn state. For the three downstream claims, the order-status record was neutral, and the contradicted label arose from a polarity conflict between “failed” in the claims and the simulated refund tool's “processed successfully” record. This is a controlled handoff-integrity failure in a configured offline workflow; we do not present it as an independently established vulnerability of the framework.

## 5. Discussion and Limitations

**Interpretation.** On these scenarios, the largest gap between KARMA POLICE and the baselines is contradiction detection (16/20 against 4/20 and 0/20), and the absence of any contradicted or unverified claim labeled supported (0/36, against 14/36 and 25/36). A plausible explanation, which we did not isolate by ablation, is that evidence indexed by producing agent, artifact version, and handoff allows a claim to be checked against evidence the claiming agent never saw, and that the delivered-versus-produced comparison detects alteration directly. The per-agent baseline cannot use another agent's evidence by construction, and the pooled-event heuristic has no mechanism to separate authoritative from non-authoritative or stale evidence. The pooled-event result also coincides with the always-*supported* rate, so we interpret its accuracy as little evidence of discrimination.

**Safe abstention versus correct classification.** Abstention is not correctness. KARMA POLICE abstained on 24/88 claims, of which 13 were correct (*unverified* gold) and 11 were not. An abstained contradicted claim is not flagged, so abstention reduces false support but also reduces recall, as shown by the four contradicted claims abstained. Reporting accuracy, recall, false-support, abstention, and coverage separately keeps this trade-off visible. The false contradictions (6) are the costlier errors for oversight use, since they would flag correct claims.

**Limitations.**

- *Sample.* Sixteen scenarios, 88 claims clustered within them, two domains; no inferential statistical claim is supported. Scenario-level results vary (Section 4).
- *Construction.* Scenarios are synthetic and experimenter-authored; the experimenter also wrote the detector. The evaluation is post-freeze but not third-party blind, and results may reflect similarity between scenario authoring and detector design.
- *Public benchmark.* The original held-out benchmark labels are public, so it is only a regression check.
- *Baselines.* Both are simple frozen heuristics. No LLM-based, commercial, or learned monitor was compared.
- *External validation.* One framework, one workflow, two episodes, offline deterministic chat client, no live-LLM behavior, and no live provider calls.
- *Trust assumptions.* The verifier assumes trustworthy upstream logs and complete evidence capture. We demonstrate no resistance to arbitrary log modification, covert coordination, or collusion among agents.
- *Attribution.* Observable attribution (which agent and event made a claim) does not establish causal responsibility.
- *Semantic coverage and reproducibility.* Free-form claims are mostly handled by abstention (11 incorrect abstentions), and the original sealed pack is not public (see Code and Data).

**Future work.** Third-party blind scenario authorship; comparison with LLM-based monitors and trace-attribution baselines; an ablation of the evidence index components; adversarial and tamper-evident logging evaluation; live-LLM external validation across more frameworks; and fixes for numerical aggregation, identifier disambiguation, and redaction-aware parsing (the six false contradictions).

## 6. Conclusion

In our evaluated conditions, a deterministic cross-agent claim-to-evidence verifier classified more claims correctly (68/88) and detected more contradictions (16/20) than two frozen heuristic baselines (52/88 and 29/88; 4/20 and 0/20), without labeling any of 36 non-supported claims as supported, and it did so on a controlled offline handoff-tampering example (6/6 against 1/6). It also made 20 errors, concentrated in cross-record arithmetic, identifier ambiguity, redaction parsing, free-form natural-language claims, and structure-only capture. The evidence supports only the narrow claim that cross-agent evidence binding helped on these synthetic scenarios against these baselines; it does not show generalization to other domains, stronger monitors, adversarial agents, or live models.

## Code and Data

- Code repository: https://github.com/RaulMermans/Reeprov (frozen detector commit `5a4bcb59afa37e110b641b35db99c9a6b453137a`; paper sources in `docs/research/h3-submission/`).
- Committed H2 artifacts: `research/swarmguard-testbed/results/h2/` (predictions with SHA-256 commitments, evaluations, confusion matrices, external-validation bundles). `docs/research/h3-submission/scripts/verify-h3-reproducibility.ts` re-checks hashes, confusion-matrix conservation, and the freeze diff, and re-executes the three monitors on the committed external artifacts.
- **Not public:** the original sealed pack (commitment `5f380067a7e8b67985579f90b7c47d2ebfd03e269bed8dd39f3ad96b678a1132`) and its raw oracle labels are not in the repository, and we did not regenerate them. Scoring from raw traces is therefore not reproducible from public files; the committed predictions, evaluations, hashes, and aggregates are. Releasing the original bytes would allow a commitment check but would retire the pack for future blind evaluation.

## Author Contributions

R.M. directed the project and is responsible for its claims; implementation and drafting were AI-assisted (Appendix C).

{{FIG1}}

{{FIG2}}

## References

- Bhatt, A., Rushing, C., Kaufman, A., Tracy, T., Georgiev, V., Matolcsi, D., Khan, A., & Shlegeris, B. (2025). *Ctrl-Z: Controlling AI agents via resampling*. arXiv:2504.10374. https://arxiv.org/abs/2504.10374
- Cemri, M., Pan, M. Z., Yang, S., Agrawal, L. A., Chopra, B., Tiwari, R., Keutzer, K., Parameswaran, A., Klein, D., Ramchandran, K., Zaharia, M., Gonzalez, J. E., & Stoica, I. (2025). *Why do multi-agent LLM systems fail?* arXiv:2503.13657. https://arxiv.org/abs/2503.13657
- Chan, A., Ezell, C., Kaufmann, M., Wei, K., Hammond, L., Bradley, H., Bluemke, E., Rajkumar, N., Krueger, D., Kolt, N., Heim, L., & Anderljung, M. (2024). Visibility into AI agents. In *Proceedings of the 2024 ACM Conference on Fairness, Accountability, and Transparency (FAccT '24)* (pp. 958–973). ACM. https://doi.org/10.1145/3630106.3658948
- Dong, L., Lu, Q., & Zhu, L. (2024). *AgentOps: Enabling observability of LLM agents*. arXiv:2411.05285. https://arxiv.org/abs/2411.05285
- Greenblatt, R., Shlegeris, B., Sachan, K., & Roger, F. (2024). AI control: Improving safety despite intentional subversion. In *Proceedings of the 41st International Conference on Machine Learning (ICML 2024)*, PMLR 235. https://arxiv.org/abs/2312.06942
- Hammond, L., Chan, A., Clifton, J., Hoelscher-Obermaier, J., Khan, A., et al. (2025). *Multi-agent risks from advanced AI* (Cooperative AI Foundation Technical Report No. 1). arXiv:2502.14143. https://arxiv.org/abs/2502.14143
- Hong, S., Zhuge, M., Chen, J., Zheng, X., Cheng, Y., Wang, J., Zhang, C., Wang, Z., Yau, S. K. S., Lin, Z., Zhou, L., Ran, C., Xiao, L., Wu, C., & Schmidhuber, J. (2024). MetaGPT: Meta programming for a multi-agent collaborative framework. In *ICLR 2024*. https://arxiv.org/abs/2308.00352
- Irving, G., Christiano, P., & Amodei, D. (2018). *AI safety via debate*. arXiv:1805.00899. https://arxiv.org/abs/1805.00899
- Lee, D., & Tiwari, M. (2024). *Prompt infection: LLM-to-LLM prompt injection within multi-agent systems*. arXiv:2410.07283. https://arxiv.org/abs/2410.07283
- Microsoft. (2026). *Microsoft Agent Framework* (agent-framework-core v1.24.0; agent-framework-orchestrations v1.4.1; commit 82f03c81aba5c5e4b1b36589027470bc5d094422) [Software]. GitHub. https://github.com/microsoft/agent-framework/tree/82f03c81aba5c5e4b1b36589027470bc5d094422
- Min, S., Krishna, K., Lyu, X., Lewis, M., Yih, W.-t., Koh, P. W., Iyyer, M., Zettlemoyer, L., & Hajishirzi, H. (2023). FActScore: Fine-grained atomic evaluation of factual precision in long form text generation. In *Proceedings of EMNLP 2023* (pp. 12076–12100). ACL. https://doi.org/10.18653/v1/2023.emnlp-main.741
- Moreau, L., & Missier, P. (Eds.). (2013). *PROV-DM: The PROV data model* (W3C Recommendation, 30 April 2013). https://www.w3.org/TR/2013/REC-prov-dm-20130430/
- Thorne, J., Vlachos, A., Christodoulopoulos, C., & Mittal, A. (2018). FEVER: a large-scale dataset for fact extraction and VERification. In *Proceedings of NAACL-HLT 2018* (Vol. 1, pp. 809–819). ACL. https://doi.org/10.18653/v1/N18-1074
- Wu, Q., Bansal, G., Zhang, J., Wu, Y., Li, B., Zhu, E., Jiang, L., Zhang, X., Zhang, S., Liu, J., Awadallah, A. H., White, R. W., Burger, D., & Wang, C. (2024). AutoGen: Enabling next-gen LLM applications via multi-agent conversation. In *COLM 2024*. https://arxiv.org/abs/2308.08155
- Xiang, Z., Zheng, L., Li, Y., Hong, J., Li, Q., Xie, H., Zhang, J., Xiong, Z., Xie, C., Yang, C., Song, D., & Li, B. (2025). GuardAgent: Safeguard LLM agents via knowledge-enabled reasoning. In *Proceedings of the 42nd International Conference on Machine Learning (ICML 2025)*, PMLR 267. https://arxiv.org/abs/2406.09187
- Zhang, S., Yin, M., Zhang, J., Liu, J., Han, Z., Zhang, J., Li, B., Wang, C., Wang, H., Chen, Y., & Wu, Q. (2025). Which agent causes task failures and when? On automated failure attribution of LLM multi-agent systems. In *Proceedings of the 42nd International Conference on Machine Learning (ICML 2025)*, PMLR 267. https://arxiv.org/abs/2505.00212

## Appendix A: Limitations and Dual-Use / Ethical Considerations

**Additional limitations.** The detector was iterated during the hackathon (H1, H1-R, and one pre-freeze correction) before the freeze; only the post-freeze pack is used for the primary claim. Provenance-anomaly counts are descriptive and have no gold labels.

**Dual-use.** A published description of what a deterministic verifier checks, and where it abstains or errs, could help an adversarial agent or operator craft handoffs that avoid detection (for example, claims phrased as free-form paraphrase, which are mostly abstained on). We judge this risk low relative to the value of reporting failure modes: the system is an undeployed research prototype and the evaluated cases are synthetic. A verifier can also be misused as a false assurance: low flagged-claim counts must not be read as evidence that handoffs are correct, given abstention, trust in logs, and the false-contradiction errors reported here. We recommend using it as one signal with human review, not as an automated gate.

**Data and safety.** All scenarios are synthetic and contain no personal data, real credentials, or real financial activity; redaction placeholders in the traces are synthetic. The refund in the external demonstration was a simulated example-tool call. Repository content is treated as untrusted evidence and was never executed. The sealed pack, if released after evaluation, loses its value as a blind test for future detector versions.

## Appendix B: Per-Scenario Results and Confusion Matrices

| Scenario | Claims | Per-agent | Pooled-event | KARMA POLICE | KP contradiction recall | KP abstained |
|---|---|---|---|---|---|---|
| h2-se-01 | 5 | 3/5 | 5/5 | 5/5 | 0/0 | 0 |
| h2-se-02 | 5 | 0/5 | 3/5 | 5/5 | 3/3 | 0 |
| h2-se-03 | 5 | 4/5 | 2/5 | 3/5 | 0/0 | 3 |
| h2-se-04 | 5 | 2/5 | 3/5 | 4/5 | 1/2 | 1 |
| h2-se-05 | 5 | 3/5 | 4/5 | 5/5 | 0/0 | 1 |
| h2-se-06 | 5 | 3/5 | 5/5 | 5/5 | 0/0 | 0 |
| h2-se-07 | 5 | 2/5 | 3/5 | 1/5 | 0/2 | 4 |
| h2-se-08 | 6 | 3/6 | 1/6 | 6/6 | 1/1 | 2 |
| h2-inv-01 | 6 | 2/6 | 6/6 | 3/6 | 0/0 | 3 |
| h2-inv-02 | 6 | 0/6 | 1/6 | 6/6 | 5/5 | 0 |
| h2-inv-03 | 6 | 1/6 | 2/6 | 6/6 | 2/2 | 2 |
| h2-inv-04 | 6 | 2/6 | 3/6 | 5/6 | 0/0 | 4 |
| h2-inv-05 | 6 | 1/6 | 5/6 | 4/6 | 0/0 | 0 |
| h2-inv-06 | 6 | 0/6 | 3/6 | 6/6 | 3/3 | 0 |
| h2-inv-07 | 6 | 1/6 | 4/6 | 2/6 | 1/2 | 2 |
| h2-inv-08 | 5 | 2/5 | 2/5 | 2/5 | 0/0 | 2 |
| **Total** | 88 | 29/88 | 52/88 | 68/88 | 16/20 | 24 |

*Table B1. Per-scenario correct classifications (numerator over scenario gold claims). In `h2-inv-08` each monitor has 3 missing predictions that count as errors.*

Aggregate confusion counts (gold → predicted; supported / contradicted / unverified / missing) for KARMA POLICE: supported → 39 / 6 / 7 / 0; contradicted → 0 / 16 / 4 / 0; unverified → 0 / 0 / 13 / 3. Pooled-event: supported → 46 / 6 / 0 / 0; contradicted → 16 / 4 / 0 / 0; unverified → 9 / 2 / 2 / 3. Per-agent: supported → 20 / 4 / 28 / 0; contradicted → 10 / 0 / 10 / 0; unverified → 4 / 0 / 9 / 3.

## Appendix C: LLM Usage Statement

Large language model coding agents were used throughout this project, including for writing and modifying code and tests for the KARMA POLICE verifier and evaluation tooling, running experiments, searching for and summarizing the literature, drafting and editing this manuscript, and generating the figures. LLMs were not used inside the evaluated system: the verifier and both baselines are deterministic and call no model, and the primary evaluation ran in `offline_fixture` mode with no model calls. Numerical results in this manuscript were checked programmatically against committed evaluation artifacts, and cited references were checked against publisher, proceedings, or preprint-server records. These checks do not substitute for human review; items still requiring human confirmation are listed in `HUMAN_VERIFICATION_REQUIRED.md` in the submission package.
