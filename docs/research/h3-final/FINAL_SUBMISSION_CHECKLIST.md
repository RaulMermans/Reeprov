# Final submission checklist

Official source: https://apartresearch.com/sprints/swarm-alignment-2026  
Deadline: Sunday 8 November 2026, 11:59 PM AoE.  
Template: Google Doc linked from the Guidelines tab (`1_1_27EyZriMlc8n8EBE2YScaeyMjm-8xjR097nmHXAE`).

## Paper (agent-checked)

- [x] Recommended sections: Abstract, Introduction, Related Work, Methods, Results, Discussion and Limitations, Conclusion, Code and Data, Author Contributions, References, Appendix A Limitations and Dual-Use / Ethical Considerations, LLM usage appendix
- [x] Abstract length asserted by `scripts/build-paper-pdf.py` (150–250 words)
- [x] Main text page count asserted against References start (limit 8)
- [x] Tables 1 (H2) and 2 (H2-C); Figures 1–2
- [x] Negative live result (accuracy 8/22, precision 2/16) in Results and Discussion
- [x] No claim of executed live refund, production validation, or statistical significance
- [x] H2-C stated as adapted sequential controller, not HandoffBuilder
- [x] Prior work vs hackathon work in Methods
- [x] 16 verified references reused from H3; bibliography in `references.bib`

## Template compliance (limitation)

- [ ] **Human:** Official instructions say “research report (PDF) using the official template.” This PDF follows that section structure and the “With Apart Research” title-block convention used in H3. It was **not** exported from the Google Doc. If the organizers require the native template file, paste `manuscript.md` into the Doc and export.

## Numbers (agent-checked against JSON)

- [x] H2 29/88, 52/88, 68/88; recall 0/20, 4/20, 16/20; precision 0/4, 4/12, 16/22; false support 14/36, 25/36, 0/36
- [x] H2-C 12/22, 12/22, 8/22; recall 0/2, 0/2, 2/2; KP precision 2/16; tokens 11524
- [x] Provenance-anomaly scenario count: 8 (artifact), not 7 (old H2 prose)

## Integrity

- [x] Frozen detector zero-diff vs `5a4bcb59`
- [x] H2-C public SHA256SUMS
- [x] Local raw observation hash `bae87bb1…` if the gitignored file is present
- [ ] Run `npx tsx docs/research/h3-final/scripts/verify-h3-final.ts` before submission (must be run; do not tick from memory)
- [ ] `npm run ci` after documentation commit if time allows

## Human submission steps (not performed by the agent)

- [ ] Approve author block and LLM statement
- [ ] Optional: paste into official Google Doc
- [ ] Submit via Apart form: title, 150–250 word abstract, Track 4, GitHub https://github.com/RaulMermans/Reeprov, PDF `docs/research/h3-final/KARMA_POLICE_Final_Paper.pdf`
- [ ] Do not wait for a merge or push unless you choose to publish the branch
- [ ] Keep the confirmation email
