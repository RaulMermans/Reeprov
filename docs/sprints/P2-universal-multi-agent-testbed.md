# Sprint P2 — Universal Multi-Agent Research Testbed

Research laboratory for later SwarmGuard study. SwarmGuard itself is **not** implemented.

## Architecture (minimal)

Hybrid deterministic workflow + LLM agents:

- **Experimental controller** (`research/swarmguard-testbed/src/harness.ts`) owns scenario selection, agent order, handoff routing, tool authorization, fault injection, run IDs, ground truth, and budgets.
- **LLM agents** own task interpretation, tool selection when permitted, structured JSON turns, and review/decision judgments.
- **Reeprov** remains the capture, persistence, replay, and evidence plane (`CaptureSession`, canonical handoffs, `RunArtifact`, `exportRunEvidenceBundle`, evidence origin/authority).

No new general-purpose agent framework. No competing trace store. Experimental code is isolated under `research/swarmguard-testbed/`.

## Domains

Both run through the same harness:

- **Software engineering:** coder → reviewer → release-decision, disposable workspace, versioned JSON artifacts, gold-case validation (no execution of model code).
- **Investigation:** investigator → validator → decision, documentary records (`system_log` / `witness` / `rumor`).

## Honest execution modes

`live_llm` is recorded only after a completed provider HTTP call. `offline_fixture` and `mocked` cannot be relabeled. Environment-variable presence is not proof.

## Isolation

Detector-visible stream: canonical events, assertions, tool outputs, handoffs, artifacts, origin/authority.

Evaluator-only: intervention labels, intended failure location, actual mutations, seed, scoring metadata.

Tests in `research/swarmguard-testbed/__tests__/adversarial.test.ts` prove leakage prevention.
