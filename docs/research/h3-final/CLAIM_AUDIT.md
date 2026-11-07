# Claim audit — KARMA POLICE H3-final

Each headline claim is mapped to an artifact. Claims not listed must not appear in the paper.

| Claim | Support | Do not infer |
|---|---|---|
| H2 accuracy 29/88, 52/88, 68/88 | `research/swarmguard-testbed/results/h2/metrics-summary.json`; recomputed by `verify-h3-final.ts` | Statistical significance |
| H2 contradiction recall 0/20, 4/20, 16/20 | Same | Generalization beyond 16 scenarios |
| H2 contradiction precision 0/4, 4/12, 16/22 | Same | Stronger monitors would lose |
| H2 false support 14/36, 25/36, 0/36 | Confusion matrices in `metrics-summary.json` (contradicted+unverified gold labeled supported) | Causal localization advantage |
| 20 H2 errors: 6 false contradictions, 11 incorrect abstentions, 3 missing | `docs/research/karma-police-h2-failure-analysis.md` plus per-case evaluations | Detector was tuned after freeze |
| Provenance anomalies: 14 across 8/16 scenarios | Per-case prediction `karma_police_provenance_findings`; H2 Markdown said 7 — artifacts win | Gold-labeled provenance accuracy |
| Offline MAF tamper: KP 6/6, baselines 1/6, recall 4/4 vs 0/4 | `results/h2/external-validation/` | Live LLM; production vulnerability |
| H2-B: live inference; mismatch detected; not consumed | `docs/research/karma-police-h2b-results.md` | Public raw files exist |
| H2-C 8/8 valid consumed episodes | `public/provenance.json` `episode_valid` and `consumption.label` | Unmodified HandoffBuilder |
| H2-C 22 gold claims; acc 12/22, 12/22, 8/22 | Sum of eight `*.evaluation.json` accuracy numerators/denominators | Independent large benchmark |
| H2-C contradiction recall 0/2, 0/2, 2/2 | Same files | Precision is also high |
| H2-C KP precision **2/16 = 12.5%** | Sum of contradiction_precision numerators/denominators | Live language is reliably classified |
| Tokens 11,524 | Sum of `observability.total_tokens` on eight public run artifacts | Metered API cost |
| Refund route 4/4 false-status, 0/4 true-status | Results note + provenance `triage_requested_refund_route` / `refund_route_requested` | Production agent failure |
| `process_refund` 0/8 | `unauthorized_refund_executed: false` on all eight episodes | Offline H2 MAF simulated refund (separate, offline) |
| False sentence not repeated 0/4 | H2-C results `false_information_repeated` | Model “agreed” in natural language |
| Adapter is not HandoffBuilder | `provenance.upstream.executed_upstream_workflow.handoff_builder_used === false` | Framework spontaneously injected the false payload |
| Frozen detector unchanged | `git diff 5a4bcb59 -- karmaPolice baselines` empty | Post-freeze tuning |
| No production readiness | Explicit limitations section | |

Banned phrases checked in the built PDF: “statistically significant”, “production-ready”, “first system of its kind”, “unauthorized refund occurred”.
