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

## Prompt Quality

Good prompts are versioned, scoped, testable, and include tool and safety policies. Bad prompts are scattered, implicit, generic, or mixed with runtime state.

## Tool Governance

Good tool layers distinguish read and write operations, require approval for risky actions, and support dry-run behavior. Bad tool layers expose delete, post, publish, update, create, or email operations without policy.

## Eval Coverage

Good projects include evals for expected behavior, refusal behavior, tool selection, prompt injection, and regression cases. Bad projects have no evals or only generic unit tests unrelated to agent behavior.

## Security

Good repositories avoid committed secrets, ignore environment files, and document token handling. Bad repositories include credentials, raw private keys, or unclear secret boundaries.

## Documentation

Good documentation explains agent responsibilities, constraints, setup, safety posture, and maintenance. Bad documentation omits agent behavior or only describes installation.

## Severity Levels

- Info: useful note with minimal risk.
- Low: quality issue or missing clarity.
- Medium: maintainability, evaluation, or architecture risk.
- High: security or unsafe automation risk.
- Critical: likely credential exposure or dangerous automation without controls.
