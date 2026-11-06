# Submission Checklist — KARMA POLICE (H3)

Status as of authoring. "Done" means checked by script or inspection; items marked **Human** need you.

## Paper
- [x] Official template structure followed (title block + footnote, author block, Abstract, 1–6, Code and Data, Author Contributions, References, Appendix) — template inspected page by page
- [x] Abstract: 208 words (build script asserts 150–250)
- [x] Main text before References: 7 pages (5 portrait + 2 landscape figure pages); limit 8
- [x] Required sections present: Introduction, Related Work, Methods, Results, Discussion and Limitations, Conclusion
- [x] Appendix A Limitations and Dual-Use / Ethical Considerations; Appendix B per-scenario results; Appendix C LLM Usage Statement
- [x] Pre-hackathon vs hackathon contributions disclosed (Methods)
- [x] Figure 1, Figure 2, Table 1, Table 2 present with captions; figures legible when rendered
- [x] No placeholders; no first-person verification claims
- [x] Claims restricted to evaluated conditions; claims described as clustered; baselines described as simple frozen heuristics
- [x] All 20 detector errors reported by mechanism
- [x] No private paths or secrets in paper sources
- [ ] **Human:** final read-through, author/affiliation, LLM statement (see `HUMAN_VERIFICATION_REQUIRED.md`)

## Numbers
- [x] Tables 1 and 2 checked by `scripts/verify-h3-reproducibility.ts`; Table B1 extracted from committed per-scenario evaluation files
- [x] External validation numbers re-derived by re-running monitors on committed artifacts

## References
- [x] 16 references verified individually (`REFERENCES_VERIFIED.md`, `references.bib`)

## Integrity and CI
- [x] CI workflow fetches full history (`fetch-depth: 0`); integrity test unchanged
- [x] Zero diff of `src/karmaPolice/` and `src/baselines/` against `5a4bcb59`
- [x] `npm run ci` passes locally
- [ ] GitHub Actions on the pull request — see final report for status

## Files
- `karma-police-apart-2026.pdf` — final PDF
- `manuscript.md` — editable source; `manuscript.html` — generated
- `scripts/build-paper-pdf.py`, `scripts/generate-figures.py`, `scripts/verify-h3-reproducibility.ts`
- `figures/` — SVG and PNG for both figures
- `REPRODUCIBILITY_SUPPLEMENT.md`, `HUMAN_VERIFICATION_REQUIRED.md`

## Before submitting (Human)
- [ ] Upload the PDF to the Apart Research submission form (not done by the agent)
- [ ] Decide on release of the sealed pack
