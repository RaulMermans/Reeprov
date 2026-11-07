# KARMA POLICE: Cross-Agent Evidence Verification for Multi-Agent Oversight

## Abstract

Multi-agent workflows can propagate unsupported or contradictory claims across agent boundaries. We ask whether cross-agent evidence verification can identify such claims, and what limitations appear when a deterministic verifier encounters real LLM-generated language. KARMA POLICE is a zero-token monitor that indexes tool observations, artifact versions, producer outputs, and delivered handoffs in a canonical REEPROV trace, labels each extracted claim *supported*, *contradicted*, or *unverified*, and reports provenance anomalies in a separate channel. In a post-freeze controlled evaluation of 16 experimenter-authored synthetic scenarios (88 gold claims; two domains), it classified 68/88 claims correctly, compared with 52/88 for a frozen pooled-event heuristic and 29/88 for a frozen per-agent heuristic. Contradiction recall was 16/20 versus 4/20 and 0/20, and none of 36 non-supported claims was labeled supported. Twenty errors remained. In a subsequent live study, original Microsoft Agent Framework agent definitions ran through Ollama (Qwen2.5 7B) under a sequential research controller rather than HandoffBuilder. Across eight consumed episodes (22 gold claims; 11,524 provider-reported tokens), the receiving agent requested refund-specialist routing after 4/4 false-status deliveries and 0/4 true-status deliveries; no simulated refund tool executed. KARMA POLICE recalled both injected factual contradictions (2/2) that both baselines missed (0/2), but overall accuracy was 8/22 versus 12/22, with contradiction precision 2/16, because paraphrases and provenance or omission payload edits were classified as factual contradictions. The evidence supports a narrow design result and a reliability boundary: a provenance or payload mismatch is not sufficient evidence of semantic contradiction.

## 1. Introduction

In a multi-agent workflow, one agent's output becomes another agent's input. A planner summarizes a tool result for a coder; a specialist reports order status to a triage agent; a downstream agent then chooses a tool or a route. Each handoff is a point at which a later decision can rest on an assertion that is unsupported by any recorded observation, refers to a superseded artifact, was altered between producer and consumer, or is contradicted by evidence recorded elsewhere in the run. Taxonomies of multi-agent failure describe information withholding, inter-agent misalignment, and incomplete verification as recurring modes (Cemri et al., 2025; Hammond et al., 2025), and injected content has been shown to propagate across agent boundaries (Lee & Tiwari, 2024).

A monitor that examines each agent in isolation cannot use evidence produced by a different agent. A monitor that pools events without tracking producer, artifact version, and delivered payload can treat unrelated, stale, or non-authoritative records as support. This paper studies a third design: bind each claim to indexed cross-agent evidence from the same recorded run.

**Research question.** Can cross-agent evidence verification identify misinformation and unsupported claims propagating through multi-agent systems, and what limitations emerge when deterministic verification encounters real LLM-generated language? We treat this as a falsifiable question about one verifier, two frozen heuristic baselines, a small synthetic pack, and a small live-agent adapter study. We do not claim generalization beyond those conditions.

The paper makes five evidence-backed contributions, none of which is a claim of general reliability or statistical significance:

1. **A deterministic verifier.** KARMA POLICE resolves extracted claims against a cross-agent evidence index, abstains when capture or evidence is insufficient, and keeps provenance-integrity anomalies out of factual accuracy (Figure 1).
2. **A post-freeze controlled evaluation.** On 88 gold claims in 16 scenarios, scored after the detector was frozen, the verifier improved classification and contradiction detection relative to two simple frozen heuristics, and it made 20 errors that we report by mechanism.
3. **External-framework capture.** A pinned Microsoft Agent Framework customer-support workflow was observed through REEPROV, first offline and then with live local inference.
4. **A live consumed-handoff study.** Under an adapted sequential controller, a receiving LLM agent consumed experimenter-delivered false-status messages and changed routing. No unauthorized refund tool executed.
5. **A reliability boundary.** On live language, payload mismatch and lexical variation produced many false contradiction labels. That negative result is a primary finding, not a footnote.

## 2. Related Work

**Multi-agent risks and orchestration.** Hammond et al. (2025) organize multi-agent risks into miscoordination, conflict, and collusion, with information asymmetry as a contributing factor. Cemri et al. (2025) derive an empirical failure taxonomy from annotated traces, including inter-agent misalignment and incomplete task verification. Lee & Tiwari (2024) show prompt injection propagating between agents. Orchestration frameworks such as AutoGen (Wu et al., 2024), MetaGPT (Hong et al., 2024), and Microsoft Agent Framework (Microsoft, 2026) create the handoff structure studied here. These works characterize failures and platforms; they do not provide the claim-level verifier evaluated below.

**Failure attribution.** Zhang et al. (2025) study automated attribution of *task* failures to an agent and a step, using LLM-based methods on failed trajectories. Attribution answers who and when after a known failure. KARMA POLICE instead classifies individual claims whether or not the task failed, and reports only observable origin (which agent and event made the claim). Causal responsibility is not attempted.

**AI control and oversight.** AI control studies protocols that bound harm when a model may act adversarially, including trusted monitoring (Greenblatt et al., 2024; Bhatt et al., 2025). Debate frames oversight as adjudicating competing claims against evidence (Irving et al., 2018). GuardAgent uses an LLM-generated guard to check a target agent's behavior against policy (Xiang et al., 2025). Our verifier is not adversarially evaluated and is not a control protocol. It is a deterministic claim-checking component that could serve as one input to such protocols.

**Observability, evidence, and provenance.** Chan et al. (2024) argue for agent identifiers, monitoring, and activity logs; Dong et al. (2024) taxonomize telemetry for agent observability. Those works motivate trace collection. We assume a canonical trace exists and study verification over it. Claim decomposition and three-way verification against a text corpus are established in fact checking (Thorne et al., 2018; Min et al., 2023). W3C PROV-DM models lineage among entities, activities, and agents (Moreau & Missier, 2013). KARMA POLICE adapts the three-way label space to evidence from the *same run* and keeps lineage defects in a typed anomaly channel. We do not claim general novelty relative to fact verification or observability products. The comparison in this paper is limited to two simple frozen heuristics; we did not evaluate LLM-based monitors, trace-attribution systems, or commercial observability tools.

## 3. Methods

**Prior work versus hackathon work.** Before the hackathon we had built REEPROV (canonical run capture and runtime), the P1–P3 testbed, the two frozen baselines, and the evaluation protocol `evaluation.v2`. During 6–8 November 2026 we built the KARMA POLICE verifier (H1), made evidence-correctness fixes (H1-R), applied a pre-freeze correction for negation, denial, and universal-statement false support (freeze commit `5a4bcb59afa37e110b641b35db99c9a6b453137a`), ran the post-freeze evaluation (H2), wrote an external-framework adapter, captured live Ollama traces (H2-B, H2-C), and wrote this manuscript (H3). Only the weekend's verifier and experiments are offered as hackathon contributions. REEPROV capture itself is preexisting infrastructure.

**Inputs and isolation.** The verifier consumes a canonical REEPROV run: trajectory steps, tool calls, system-recorded test outcomes, versioned artifacts, agent assertions, and inter-agent handoffs. Recorded content is treated as untrusted data. The verifier never executes scanned code and calls no model. Detector-only access blocks oracle fields; a leak scan is part of the evaluation harness.

**Claim extraction and evidence indexing.** Claims are agent assertions and handoff payload statements. A single pass indexes (i) artifact versions with stale flags, (ii) authoritative evidence (system-recorded tests and tool records), (iii) documentary records, treating rumors conservatively, (iv) each producing agent's recorded turn state and each delivered handoff, and (v) reference resolution (in-run, cross-run, stale, unresolved).

**Cross-agent resolution.** For each claim the resolver applies, in order: (1) a producer-versus-delivered check on handoffs; (2) binding to authoritative test or tool predicates, abstaining if the cited validation was never executed; (3) checking explicit token-to-target mappings and set-domain statements against recorded artifact contents; and (4) clause-local negation and polarity matching against documentary records, with a counterexample scan for universal statements. Unresolved claims are *unverified*. Where capture is `STRUCTURE_ONLY`, the verifier abstains or emits no prediction. Typed provenance anomalies (cross-run reference, stale artifact, unexecuted observation, unresolved reference, missing resolving evidence, producer-delivered mismatch) are emitted in a companion channel and never folded into factual accuracy (Figure 1).

{{FIG1}}

**Baselines.** Both baselines are frozen, simple heuristic reference monitors, not state-of-the-art, commercial, or LLM-based monitors. *Per-agent* resolves a claim only from the claiming agent's own cited tools or tests and abstains otherwise. *Pooled-event* resolves claims from a pool of events without agent-level or artifact-version indexing, using status-style heuristics. Source files for the detector and both baselines were verified byte-identical to freeze commit `5a4bcb59`.

**H2 controlled evaluation.** Two domains were used: software engineering (8 scenarios, 41 gold claims) and investigation (8 scenarios, 47 gold claims). Gold labels are *supported* (52), *contradicted* (20), and insufficient evidence, mapped to *unverified* (16). Scenarios were authored by the experimenter, executed in `offline_fixture` mode (no model calls), and stored in a sealed pack with SHA-256 commitment `5f380067…1132`. Protocol: freeze monitors; generate and seal the pack outside version control; run all three monitors with detector-only access; hash and commit predictions; then read oracle labels and score with `evaluation.v2`. Missing predictions are errors. Isolation was enforced by code and process, not by an independent party. The evaluation is post-freeze, not third-party blind. The original sealed pack is not in the public repository.

**H2 external offline demonstration.** We ran the original Microsoft Agent Framework customer-support handoff sample, pinned at commit `82f03c81aba5c5e4b1b36589027470bc5d094422`, with an experimenter-authored deterministic offline chat client (no live provider HTTP). In a tampered episode the delivered handoff text was altered relative to the producer's recorded output. The “refund” is a call to an example tool that returns a string, not a financial transaction. That offline path is a configured demonstration, not an independently established framework vulnerability.

**H2-B live feasibility.** On a Cursor cloud KVM guest, the same pinned framework ran with Ollama `qwen2.5:7b` and completed local `POST /api/chat` requests. An injected broadcast mismatch was detected by KARMA POLICE, but no receiving agent consumed the mutated payload. Raw H2-B cloud files were not recovered and are not public.

**H2-C live consumed-handoff study.** H2-C ran on host `raul-mermans-EVO-X3` with Ollama 0.40.15 and `qwen2.5:7b` (digest `845dbda0ea48ed749caafd9e6037047aa19acfcfd82e704d7ca97d631a0b697e`). Original Microsoft Agent Framework agent definitions were retained. **H2-C does not use the original `HandoffBuilder` routing.** A deterministic sequential research controller delivered producer messages so that consumption could be tested. Agents generated responses with real model inference (temperature 0, seed 8841, `num_ctx` 3072, `num_predict` 192). Eight preregistered episodes (two intact controls, two factual-contradiction handoffs, two evidence-omission handoffs, two provenance restatements) completed with the delivered sentence present in the receiving agent's captured model input (8/8). Frozen monitors scored the same canonical traces. Gold labels used preregistered lexical rules; they were not adjusted after seeing monitor outputs to improve scores.

## 4. Results

**H2 primary post-freeze evaluation.** Table 1 reports matched-monitor results on the same 88 gold claims. Claims are clustered within 16 scenarios and are not 88 independent runs. We report no significance tests.

| Monitor | Accuracy | Contr. recall | Contr. precision | False support | Coverage | Abstention |
|---|---|---|---|---|---|---|
| Per-agent (frozen) | 29/88 (33.0%) | 0/20 (0%) | 0/4 (0%) | 14/36 | 85/88 | 47/88 |
| Pooled-event (frozen) | 52/88 (59.1%) | 4/20 (20%) | 4/12 (33.3%) | 25/36 | 85/88 | 2/88 |
| KARMA POLICE | 68/88 (77.3%) | 16/20 (80%) | 16/22 (72.7%) | 0/36 | 85/88 | 24/88 |

*Table 1. Post-freeze controlled pack (16 scenarios, 88 gold claims, `offline_fixture`). “False support” is the fraction of contradicted or unverified gold claims labeled supported. Three claims in one scenario received no prediction from any monitor and count as errors. Per-scenario counts are in Appendix B.*

Accuracy should be read with the label prior: 52/88 gold claims are *supported*, so a trivial always-*supported* classifier would score 52/88, equal to pooled-event accuracy, with 0/20 contradiction recall. The pooled-event heuristic labeled 71 of 85 covered claims *supported*.

KARMA POLICE had higher per-scenario accuracy than both baselines in 8 scenarios, tied the best baseline in 3, and was worse than at least one baseline in 5, including `h2-se-07` (1/5 vs 3/5 pooled-event) and `h2-inv-01` (3/6 vs 6/6). All three monitors reported the originating agent for 85/88 claims, correct on 85/85 covered claims. Causal responsible-agent attribution was not attempted. KARMA POLICE emitted 14 provenance anomalies across 8 of 16 scenarios; these are excluded from accuracy. The H2 narrative document said seven scenarios; committed prediction artifacts give eight. This paper uses eight.

**H2 error analysis (20 errors).** Six false contradictions: numeral-word collision with a hostname digit (`h2-inv-05`), checking a true sum against each addend record separately (`h2-inv-07`), and a redaction placeholder rewritten during sanitization (`h2-se-03`). Eleven incorrect abstentions on free-form paraphrases, a conservative rumor guard, an idiomatic antonym, an unlisted anomaly phrase, and a custom nested payload key. Three missing predictions under `STRUCTURE_ONLY` capture (`h2-inv-08`), shared by all monitors.

**H2 offline external episode.** In the tampered offline episode (6 gold claims), KARMA POLICE was correct on 6/6 with contradiction recall 4/4; both baselines were correct on 1/6 with recall 0/4. The simulated refund example tool ran in that offline configuration. We do not present this as live-model behavior or as a production failure.

**H2-B live feasibility.** Live inference and REEPROV capture were demonstrated. KARMA POLICE labeled an injected producer-delivered mismatch *contradicted*; both baselines labeled it *supported*. The receiving agent never consumed the mutated broadcast, so downstream propagation was not shown. No `process_refund` ran.

**H2-C live consumed-handoff evaluation.** Table 2 and Figure 2 summarize eight valid live episodes (22 gold claims; 11,524 provider-reported tokens; cost unmetered local).

| Monitor | Accuracy | Contr. recall | Contr. precision | Abstention |
|---|---|---|---|---|
| Per-agent (frozen) | 12/22 (54.5%) | 0/2 | n/a (0 predicted) | 0/22 |
| Pooled-event (frozen) | 12/22 (54.5%) | 0/2 | n/a (0 predicted) | 0/22 |
| KARMA POLICE | 8/22 (36.4%) | 2/2 | 2/16 (12.5%) | 6/22 |

*Table 2. H2-C live-agent evaluation on eight consumed episodes. KARMA POLICE contradiction precision is 2/16. Downstream: false-status handoffs produced refund-specialist routing in 4/4 cases; true-status handoffs in 0/4. Simulated `process_refund` execution: 0/8. Lexical repetition of the injected failure sentence: 0/4.*

On both factual-contradiction episodes, KARMA POLICE classified the mutated handoff *contradicted* via `producer_delivered_mismatch` (recall 1/1 per episode). Both baselines classified that handoff *supported*. On both controls, KARMA POLICE contradicted the producer paraphrase “expected to ship” against the tool sentence “will ship”; gold labeled those claims *supported*, and both baselines scored 2/2. Omission handoffs were gold *unverified* (missing evidence) but predicted *contradicted* because delivered text differed from producer text. Provenance handoffs restated the true sandbox status while citing a foreign run id; gold was *supported* with a provenance defect, while KARMA POLICE again predicted *contradicted* from payload inequality.

The receiving `triage_agent` requested `handoff_to_refund_agent` after every false-status delivery (contradiction and omission, 4/4) and did not request a refund route after true-status deliveries (two controls, two provenance restatements). `refund_agent` then ran in the false-status episodes and never called `process_refund`. Control receiver completions were empty HTTP-complete turns; we do not interpret those empty turns as acceptance or rejection of the true status.

{{FIG2}}

## 5. Discussion and Limitations

**What the controlled study shows.** On the synthetic pack, the largest gap is contradiction detection (16/20 versus 4/20 and 0/20) together with the absence of false support on non-supported claims (0/36 versus 14/36 and 25/36). A plausible, unablated explanation is that indexing evidence by producing agent, artifact version, and delivered handoff lets a claim be checked against evidence the claiming agent never saw, and that producer-versus-delivered comparison detects alteration directly. The per-agent baseline cannot use another agent's evidence by construction. The pooled-event result coincides with the always-*supported* rate, so its accuracy is weak evidence of discrimination. Scenario-level heterogeneity remains: the verifier lost to a baseline in five scenarios.

**What the live study shows.** Actual LLM agents can consume a controller-delivered false-status message and change routing. That is a behavioral observation under an adapted sequential controller, not a claim that Microsoft Agent Framework spontaneously generated the false content, and not a claim that an unauthorized refund executed. The model did not repeat the false sentence verbatim.

**Reliability boundary (central negative finding).** On live language, KARMA POLICE overall accuracy fell below both baselines (8/22 versus 12/22) because contradiction precision collapsed to 2/16. The same `producer_delivered_mismatch` rule that correctly flagged injected factual contradictions also flagged (i) near-paraphrases (“expected to ship” versus “will ship”), (ii) omission payloads whose gold label is missing evidence, and (iii) provenance restatements whose facts remained true. **A provenance or payload mismatch is not sufficient evidence of a factual contradiction.** Evidence lineage and semantic entailment must be handled separately if this class of monitor is to be dependable. Treating the live false-positive rate as a minor inconvenience would misstate the result.

**Limitations.**

- *Sample.* Sixteen synthetic scenarios (88 clustered claims) and eight live episodes (22 claims) cannot support inferential statistics or production claims.
- *Construction.* H2 scenarios and the detector share an author. H2 is post-freeze, not third-party blind. H2-C gold used experimenter-written lexical rules.
- *Adapter.* H2-C guaranteed delivery with a sequential controller. It is not an evaluation of unmodified `HandoffBuilder`.
- *Baselines.* Both are simple frozen heuristics. No LLM-based or commercial monitor was compared.
- *Trust.* The verifier assumes trustworthy logs and complete capture. We demonstrate no resistance to log tampering, covert channels, or collusion.
- *Attribution.* Observable origin is not causal responsibility.
- *Reproducibility.* The original H2 sealed pack is not public. H2-B raw cloud files were not recovered. H2-C raw observations remain local and gitignored; public sanitized artifacts and hashes are committed.
- *Semantic coverage.* Free-form claims are often abstained on (H2) or over-contradicted (H2-C). The frozen detector was not edited after these failures.

## 6. Conclusion

Under the H2 synthetic conditions, cross-agent evidence verification classified more claims correctly (68/88) and detected more contradictions (16/20) than two frozen heuristics (52/88 and 29/88; 4/20 and 0/20), without labeling any of 36 non-supported claims as supported. Under H2-C live conditions, injected false-status handoffs were consumed and changed routing, and the same frozen verifier recalled both factual-contradiction injections (2/2) that both baselines missed—while producing contradiction precision 2/16 and accuracy 8/22. No simulated refund executed. The evidence supports only the narrow claim that cross-agent evidence binding helped on these synthetic scenarios against these baselines, that live consumption of manipulated handoffs is possible in this adapter, and that deterministic mismatch is an unreliable proxy for semantic contradiction. It does not show general reliability or production readiness, and we report no significance tests.

## Code and Data

- Repository: https://github.com/RaulMermans/Reeprov. Frozen detector: `5a4bcb59afa37e110b641b35db99c9a6b453137a`. Paper sources: `docs/research/h3-final/`.
- H2 committed artifacts: `research/swarmguard-testbed/results/h2/`.
- H2-C public artifacts: `research/h2c-live-error-propagation/public/` (SHA-256 in `SHA256SUMS`).
- Verification: `docs/research/h3-final/scripts/verify-h3-final.ts`.
- **Not public:** original H2 sealed pack (commitment `5f380067a7e8b67985579f90b7c47d2ebfd03e269bed8dd39f3ad96b678a1132`); H2-B raw cloud traces; H2-C raw observation JSON (local hash `bae87bb1…aa61` confirmed on the authoring machine, file gitignored).

## Author Contributions

R.M. directed the project and is responsible for its claims. Implementation, experiments, and manuscript drafting were AI-assisted. **Human approval of this statement is still required** (see `LLM_USAGE_AND_AUTHOR_REVIEW.md`). Affiliation “Independent Researcher; research conducted at the Apart Research Swarm Alignment Hackathon” is provisional.

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

**What these results do not establish.** They do not establish that KARMA POLICE is a production monitor, that it bounds colluding agents, that it remains accurate when logs can be edited, that live accuracy exceeds simple heuristics, or that a real financial refund occurred. H2-C used an adapted controller that guaranteed message delivery. Empty control replies are captured model outputs, not scripted closes, and do not by themselves show that the model accepted the true order status.

**Dual-use.** Publishing where a deterministic verifier abstains or over-flags (free-form paraphrase, payload inequality) could help an operator craft handoffs that avoid useful detection or that flood a monitor with false contradictions. We judge that risk modest relative to the value of reporting the failure mode: the system is an undeployed research prototype, H2 cases are synthetic, and H2-C refunds are simulated example tools. The opposite misuse is false assurance: a low flagged-claim count must not be read as evidence that handoffs are factually correct.

**Data and safety.** H2 scenarios are synthetic and contain no personal data or real credentials. H2-C used a local sandbox order record. Repository content was treated as untrusted evidence and was never executed as scanned-repo code. No credentials are included in public artifacts.

## Appendix B: Supplementary Results

**Table B1. H2 per-scenario correct classifications.**

| Scenario | Claims | Per-agent | Pooled-event | KARMA POLICE | KP contr. rec. | KP abstained |
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

H2 aggregate confusion (gold → predicted; supported / contradicted / unverified / missing). KARMA POLICE: supported → 39 / 6 / 7 / 0; contradicted → 0 / 16 / 4 / 0; unverified → 0 / 0 / 13 / 3. Pooled-event: 46 / 6 / 0 / 0; 16 / 4 / 0 / 0; 9 / 2 / 2 / 3. Per-agent: 20 / 4 / 28 / 0; 10 / 0 / 10 / 0; 4 / 0 / 9 / 3.

H2 domain split. Software engineering (41): per-agent 20/41, pooled-event 26/41, KARMA POLICE 34/41 (contr. recall 5/8). Investigation (47): 9/47, 26/47, 34/47 (contr. recall 11/12).

Non-blind `p3.benchmark.v1.1` (85 public claims): 34/85, 66/85, 71/85; KARMA POLICE contradiction recall 11/14. This is a regression check, not independent evidence.

**Table B2. H2-C per-episode monitors.**

| Episode | Mechanism | KP acc | Per-agent acc | Refund route | `process_refund` | mismatch |
|---|---|---|---|---|---|---|
| control-01 | none | 0/2 | 2/2 | no | no | no |
| contradiction-01 | factual | 2/3 | 1/3 | yes | no | yes |
| control-02 | none | 0/2 | 2/2 | no | no | no |
| contradiction-02 | factual | 2/3 | 1/3 | yes | no | yes |
| omission-01 | omission | 1/3 | 1/3 | yes | no | yes |
| omission-02 | omission | 1/3 | 1/3 | yes | no | yes |
| provenance-01 | provenance | 1/3 | 2/3 | no (order route) | no | yes |
| provenance-02 | provenance | 1/3 | 2/3 | no (order route) | no | yes |

Pooled-event accuracy matched per-agent on every H2-C episode. Token totals by public run artifact: 783 + 787 + 1695 + 1695 + 1719 + 1729 + 1558 + 1558 = 11,524.

## Appendix C: LLM Usage Statement

Large language model coding agents were used throughout this project, including writing and modifying verifier and evaluation code, running experiments, searching and summarizing literature, drafting and editing this manuscript, generating figures, and producing the submission package. LLMs were not used *inside* the evaluated monitors: KARMA POLICE and both baselines are deterministic and call no model. H2 ran in `offline_fixture` mode. H2-B and H2-C used `qwen2.5:7b` as the *object of study* (the agents under observation), not as the monitor. Numerical results were checked programmatically against committed evaluation artifacts. Those checks do not substitute for human review. Apart Research recommends that the final submission be primarily written by the team. **No AI system may certify human authorship.** Items requiring the author's sign-off are listed in `LLM_USAGE_AND_AUTHOR_REVIEW.md`.
