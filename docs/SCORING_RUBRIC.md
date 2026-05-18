# Scoring Rubric

Overall score uses:

- Architecture: 18%
- Prompt quality: 18%
- Tool governance: 18%
- Eval coverage: 13%
- Security: 14%
- Documentation: 9%
- Maintainability: 10%

## Architecture

Good repositories have explicit agent boundaries, agent config, clear workflows, and maintainable structure. Bad repositories hide agent behavior across unrelated source files with no inventory.

Workflow projects are first-class. A repository with `workflow.yaml` and no `agents.yaml` is not penalized for missing agent config.

## Prompt Quality

Good prompts are versioned, scoped, testable, and include tool and safety policies. Bad prompts are scattered, implicit, generic, or mixed with runtime state.

## Tool Governance

Good tool layers distinguish read and write operations, require approval for risky actions, and support dry-run behavior. Bad tool layers expose delete, post, publish, update, create, or email operations without policy.

## Eval Coverage

Good projects include evals for expected behavior, refusal behavior, tool selection, prompt injection, and regression cases. Bad projects have no evals or only generic unit tests unrelated to agent behavior.

## Security

Good repositories avoid committed secrets, ignore environment files, and document token handling. Bad repositories include credentials, raw private keys, or unclear secret boundaries.

### Secret Confidence Levels

Secret findings are classified by confidence before applying score penalties:

**High confidence** (strong evidence of a real credential):
- Known key formats: `sk-ant-...`, `sk-...`, `ghp_...`, `github_pat_...`, `AKIA...`
- Private key blocks: `-----BEGIN PRIVATE KEY-----`
- Database connection URLs with credentials
- AWS access key IDs

**Medium confidence** (plausible but not definitive):
- Named variable assignments (`API_KEY`, `SECRET`, `PASSWORD`, `ACCESS_TOKEN`) with long, high-entropy values
- These reduce the security score, but not as severely as high-confidence matches

**Low confidence** (heuristic match, not a finding):
- Generic token words without credential-looking values
- Loop variables (`for token in (...)`)
- Function parameters (`token: string`)
- Short placeholder values

Low-confidence patterns are filtered out and do not produce findings or score penalties. One high-confidence secret finding reduces the security score significantly. Multiple high-confidence findings reduce it further. Medium-confidence assignments apply a moderate penalty only.

## Maintainability

Maintainability measures how easy and safe the AI system is to evolve over time. This is not a style lint — it focuses on structural signals that indicate whether the system is becoming harder, riskier, or slower to change.

Score starts at 100 and subtracts penalties. Minimum score is 20.

### Deterministic checks (V1)

**A. Large files** — source files (not tests, docs, lockfiles) over 500 lines (medium) or 800 lines (high). Signals mixed responsibilities that make evolution risky.

**B. Scanner/router concentration** — files in scanner/, reports/, routing/ paths that are very large or have many exports. Indicates that new detection logic cannot be tested in isolation.

**C. TODO/FIXME markers** — info for 1–3 markers, low for 4–10, medium for >10. Deferred work accumulates as AI system complexity grows.

**D. Schema version missing** — if no `reportVersion` field exists in schema/type files. Required before scan history is implemented.

**E. Dashboard component complexity** — UI components over 300 lines. Large components are harder to extend for scan history or diff views.

**F. Duplicate recommendation wording** — recommendation phrases repeated across multiple source files may cause dashboard and exports to diverge.

**G. Missing golden fixtures** — if tests exist but no golden report fixtures are found. Semantic regressions in report output may go undetected.

**H. Documentation drift** — if docs appear to be missing references to major project-type concepts.

### Penalties

- Large source file >500 lines: -8 (per file)
- Huge source file >800 lines: -15 (per file)
- TODO/FIXME per marker: -1 (capped at -8)
- Schema version missing: -8
- Dashboard complexity: -5 (per component)
- Scanner concentration: -8 (per file, capped)
- Duplicate recommendation wording: -5
- Missing golden fixtures: -5
- Docs drift: -2

### Positive signals (bonus)

- Tests detected: +3
- Dedicated AI evals: +3
- Docs files present: +2
- Manifest files present (agents.yaml / workflow.yaml): +2

### Why this is not a generic linter

Generic linters measure style, formatting, and language correctness. The maintainability auditor measures whether the AI system's code will become harder to reason about, test, and extend as agent/workflow/prompt complexity grows. A 200-line file with tightly coupled scanning, scoring, and recommendation logic is a maintainability risk even if it's stylistically perfect.

### Future work

A future LLM Code Debt Auditor (behind `ENABLE_LLM_AUDITORS`) could evaluate semantic debt patterns — identifying inconsistent abstraction layers, tangled prompt/tool coupling, or reasoning about which refactors would have the highest ROI. This remains out of scope for V1.

## Documentation

Good documentation explains agent responsibilities, constraints, setup, safety posture, and maintenance. Bad documentation omits agent behavior or only describes installation.

## Workflow Support

Workflow-based projects (`workflow_system`) are evaluated like agent-based projects but with adjusted expectations. A workflow manifest (`workflow.yaml`) serves the same structural function as `agents.yaml`. Missing `agents.yaml` is not penalized for workflow-only projects.

## Severity Levels

- Info: useful note with minimal risk.
- Low: quality issue or missing clarity.
- Medium: maintainability, evaluation, or architecture risk.
- High: security or unsafe automation risk.
- Critical: likely credential exposure or dangerous automation without controls.
