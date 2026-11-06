# Human Verification Required — KARMA POLICE (H3)

The paper was drafted and checked programmatically by an AI agent. The following need the human author before submission.

## Identity and disclosure
- [ ] **Author name and affiliation.** The PDF lists "Raúl Mermans, Independent Researcher, with Apart Research", based on repository git history (sole committer). Confirm spelling, affiliation, and whether to add an email/ORCID. No co-authors were added.
- [ ] **Author Contributions** sentence ("R.M. directed the project and is responsible for its claims; implementation and drafting were AI-assisted") — confirm it is accurate.
- [ ] **LLM Usage Statement** (Appendix C) — confirm it matches actual tool use. Apart asks that the submission be primarily written by the team; decide whether the level of AI drafting needs more explicit disclosure or rewriting by you.
- [ ] **Pre-hackathon vs hackathon boundary** (Methods) — confirm the dates and which components pre-existed (REEPROV, capture/runtime, P1–P3 testbed, frozen baselines, `evaluation.v2`).

## Scientific claims to confirm
- [ ] Descriptions of the two baselines (per-agent: own cited tools/tests only; pooled-event: pooled events with status-style heuristics) and of the five-stage protocol are written from the source and H2 documents; confirm they match your intent.
- [ ] The sentence that the pack was "authored by the experimenter" and that isolation was "enforced by code and process, not by an independent party" — confirm.
- [ ] Interpretation in Discussion (why evidence binding helped) is a hypothesis; no ablation was run.
- [ ] Provenance anomalies: paper says 8 of 16 scenarios; the H2 results document says 7. Committed predictions give 8.
- [ ] Error attribution to specific scenarios (e.g., `h2-inv-05`, `h2-inv-07`, `h2-se-03`) comes from the H2 failure analysis document; spot-check against the artifacts.

## Reproducibility decision
- [ ] The original sealed pack was not found. If you have it, decide whether to release it (see `REPRODUCIBILITY_SUPPLEMENT.md`). Until then the paper states it is not public.

## Citations
- [ ] All 16 references were checked against publisher/proceedings/arXiv records via web search (see `REFERENCES_VERIFIED.md`). Confirm venue details if you want to cite final proceedings pages (ICML 2025 PMLR page numbers are not given).
- [ ] The Microsoft Agent Framework entry cites a commit URL; confirm the version strings.

## Submission
- [ ] The official Apart Research form was **not** submitted. Upload the PDF yourself.
- [ ] The official template is a Google Doc; the PDF follows its structure (title block, footnote, author block, Abstract, sections 1–6, Code and Data, Author Contributions, References, Appendix) but is generated from HTML, not copied into the Doc. Confirm Apart accepts this, or paste `manuscript.md` into the Doc.
- [ ] Decide when to merge the pull request and publish the repository content.
