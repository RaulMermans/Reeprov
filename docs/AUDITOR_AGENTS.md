# Auditor Agents

## Architecture Auditor

Reviews agent boundaries, component layout, workflows, memory use, state ownership, and maintainability.

## Prompt Auditor

Reviews prompt clarity, scope, instruction hierarchy, tool policy, safety language, and injection resistance.

The Prompt Auditor is the first real LLM auditor. It is feature-flagged behind `ENABLE_LLM_AUDITORS` and receives only selected redacted prompt evidence, not a full repository dump. When the flag is disabled or the provider is not configured, static placeholder behavior remains in place.

Static scan remains the default and required trust layer for all auditor results.

## Tool Auditor

Reviews tool inventory, write permissions, approval gates, dry-run support, idempotency, and error handling.

## Eval Auditor

Reviews eval coverage, regression tests, adversarial cases, expected outputs, and confidence thresholds.

## Safety Auditor

Reviews secret handling, unsafe paths, prompt injection exposure, dangerous automation, and data retention.

## Documentation Auditor

Reviews README, AGENTS.md, architecture docs, runbooks, setup steps, and operational constraints.

All auditors other than the Prompt Auditor remain deterministic placeholders for now.
