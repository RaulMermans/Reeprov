# Scoring Rubric

Overall score uses:

- Architecture: 20%
- Prompt quality: 20%
- Tool governance: 20%
- Eval coverage: 15%
- Security: 15%
- Documentation: 10%

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

## Documentation

Good documentation explains agent responsibilities, constraints, setup, safety posture, and maintenance. Bad documentation omits agent behavior or only describes installation.

## Workflow Support

Workflow-based projects (`workflow_system`) are evaluated like agent-based projects but with adjusted expectations. A workflow manifest (`workflow.yaml`) serves the same structural function as `agents.yaml`. Missing `agents.yaml` is not penalized for workflow-only projects.

## AI System Graph Penalties

When manifest agents are present (`displayKind: manifest`), the scorer applies small penalties when the AI system graph cannot link them to expected artifacts:

- **Architecture**: small penalty if a workflow manifest declares no stages.
- **Architecture**: small penalty if manifest agents have no `model: { provider, name }` mapping.
- **Prompt quality**: small penalty if manifest agents have no `prompts:` mapping.
- **Eval coverage**: small penalty if eval files exist in the repo but no manifest agent is mapped to them.

Penalties remain moderate. A small repository without an agents.yaml manifest is not punished for lacking graph mappings.

## Severity Levels

- Info: useful note with minimal risk.
- Low: quality issue or missing clarity.
- Medium: maintainability, evaluation, or architecture risk.
- High: security or unsafe automation risk.
- Critical: likely credential exposure or dangerous automation without controls.
