# Sprint P3 — Research Infrastructure, Baselines & Experimental Readiness

Prepares the SwarmGuard laboratory for a time-constrained Apart Research hackathon. SwarmGuard's novel verifier is **not** implemented.

Canonical starting `main`: `54f43fc329998e8d7cdc0e17ba52178d0de1d8cb` (PR #26).

## What this sprint adds

- Detector-visible capture of **delivered** assertions and handoff payloads (not just injection ground-truth records).
- Split storage roots: `detector/<run_id>/` vs `evaluator/<run_id>/`, plus an allowlisted detector interface.
- Frozen 24-case benchmark (8 development / 16 held-out) across software-engineering and investigation.
- Two frozen conventional baselines with a shared output schema.
- Independent evaluation pipeline (classification ≠ attribution ≠ causal root cause).
- Experiment CLI: list, run, baselines, score, freeze, validate.
- Research protocol, paper skeleton, and submission checklist without invented results.

## Trust boundary

| Visible to monitors / future SwarmGuard | Evaluator only |
|---|---|
| Canonical `RunArtifact`, `exportRunEvidenceBundle`, `run-record.json` | `ground-truth.json`, oracle labels, injection records, scoring metadata, experimental seed |
| Delivered assertion `details.claim` (when capture policy allows) | Intervention type, target boundary, actual modification |
| Delivered handoff `payload` + `payload_capture_status` | Expected failure source, experimental validity |

`research/swarmguard-testbed/src/detector.ts` refuses evaluator paths, directory traversal, and non-allowlisted files. Baselines import `leakcheck`, never `isolation` or `oracle`.

## Injection observability

An injection is valid only when the detector-visible export contains the delivered effect. See `docs/testing/p3-research-infrastructure.md`.

## Commands

```bash
npm run research:p3:list
npm run research:p3:offline
npx tsx research/swarmguard-testbed/scripts/run.ts run --case se-d01
npx tsx research/swarmguard-testbed/scripts/run.ts freeze
npx vitest run research/swarmguard-testbed
```
