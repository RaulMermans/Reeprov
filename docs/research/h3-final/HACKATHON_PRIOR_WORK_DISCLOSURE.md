# Prior-work disclosure — Apart Research Swarm Alignment Hackathon

Official rule: only the weekend's work is judged; preexisting code must be stated in the report and README. This file is the detailed boundary. The manuscript Methods section carries the short version.

**Human confirmation required.** Commit dates below were read from this repository; they are not a substitute for the author's declaration on the submission form.

## Preexisting (not a hackathon contribution)

- REEPROV product: GitHub/ZIP scanning, redaction, static detection, scoring, dashboard.
- Canonical run capture / runtime used to store traces.
- P1–P3 SwarmGuard testbed scaffolding, including split detector/evaluator storage and `evaluation.v2`.
- Frozen heuristic baselines `baseline.per_agent.v1` and `baseline.pooled_event.v1` (frozen before H1 detector work, per project docs).
- Ignore/redaction/security invariants in `AGENTS.md` / `CLAUDE.md`.

Starting point cited by the task: `main` was later than `e0bc9d13`; this consolidation branch starts from H2-C commit `84b128a9e4a642efb6720752abc57976ed8d65ea`.

## Hackathon work (6–8 November 2026), subject to organizer eligibility rules

- **H1:** KARMA POLICE cross-agent verifier (`research/swarmguard-testbed/src/karmaPolice/`).
- **H1-R:** Evidence-correctness fixes before freeze.
- **Freeze:** `5a4bcb59afa37e110b641b35db99c9a6b453137a` (no subsequent detector edits).
- **H2:** Post-freeze sealed-pack evaluation, failure analysis, offline MAF adapter demonstration.
- **H3:** Academic manuscript (this package supersedes `docs/research/h3-submission/` as the intended final PDF).
- **H2-B:** Live Ollama inference through Microsoft Agent Framework; mismatch detected; receiving agent did not consume the mutated broadcast. Raw cloud files not recovered.
- **H2-C:** Adapted sequential live consumed-handoff study on the EVO-X3 host.

## What must not be described as new this weekend

- REEPROV scanning of GitHub repositories or ZIP uploads.
- Secret redaction and static risk scoring of scanned repos.
- The existence of a detector/evaluator split in the P3 testbed.
- Baseline *ideas* as if invented during H2; the baselines were frozen reference monitors.

## Frozen artifacts that must not be rewritten to improve scores

- Detector and baseline source after `5a4bcb59`.
- `research/swarmguard-testbed/results/h2/`.
- H2-C public evaluation JSON and SHA256SUMS.
- Gold labels.
