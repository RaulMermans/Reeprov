# Incident Triage — reference external agent (synthetic)

A small agent used to prove external replay and resumed forks. All data is synthetic; the "model" is a deterministic local summarizer, not an LLM.

- `adapter.mjs`: the host adapter. Seven steps, injected dependencies, resume points at steps 0 and 4. Baseline policy `v1` ignores customer impact (the defect under test).
- `agent.mjs`: live orchestration. Captures boundaries and registers the `start` and `after_evidence` checkpoints. In `STRUCTURE_ONLY` mode it records observations instead.
- `run-live.mjs`: CLI entry (`REEPROV_URL`, `REEPROV_INGEST_KEY`, optional `TRIAGE_RUN_ID`, `TRIAGE_CONTENT_MODE`, `TRIAGE_METRICS_CREDENTIAL`). Side-effecting tools write to `./outbox`.
- `eval-suite.json`: deterministic domain assertions (severity, required evidence, no deferral, paging, no unauthorized executed side effects).

Fork mutation used in Sprint 13:

```json
[{"mutation_id":"mut_policy_v2_impact","mutation_type":"state_patch","target_identifier":"/config/triage_policy/consider_customer_impact","description":"Consider customer impact","mutated_value":true},
 {"mutation_id":"mut_policy_v2_version","mutation_type":"state_patch","target_identifier":"/config/triage_policy/version","description":"Policy v2","mutated_value":"v2"}]
```

See `docs/testing/S13-acceptance.md` for the full sequence.
