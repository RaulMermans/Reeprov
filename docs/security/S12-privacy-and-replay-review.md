# Sprint 12 privacy and replay review

## Capture contract

`FULL_CONTENT` retains permitted content but still applies mandatory secret redaction. `SAFE_CONTENT` retains sanitized content. `STRUCTURE_ONLY` omits narrative payloads and sidecar content. Canonical records are sanitized at construction and checked immediately before durable persistence. A rejected historical artifact is a remediation candidate; the validator does not silently rewrite source runs.

Input hashes are hashes of the persisted sanitized representation. They do not prove that redacted original credentials were identical. Replay therefore separates `FULL` from `PARTIAL` input verification. Strict exact replay returns `INPUT_UNVERIFIABLE` if content was redacted or an input hash is absent. Output hashes and dependency identity are checked before returning captured output.

The network kill switch intercepts known Node network and subprocess APIs in the process. It is application-level interception, **not process or container isolation** and not a zero-egress guarantee. Untrusted host code requires separate isolation before any such claim. Offline recorded-boundary substitution is a narrower supported mode.

## Persistence and export

The pre-write canonical validator runs before either filesystem or PostgreSQL writes. Run start, completion, failure, and trace event HTTP ingestion also scrub records before writing the legacy run store. API responses and project exports remain privacy-sensitive surfaces. Existing records made before this invariant are not automatically safe and need inventory and backed-up remediation before redistribution.

## Open risks

- Published `@reeprov/client@0.1.0-beta.1` ignores per-record rejection inside HTTP 200 ingestion responses. Source is fixed; registry package is not yet updated.
- Its `checkpointSaved` sends a checkpoint-shaped boundary event, but does not create a restorable canonical checkpoint.
- Docker persistence passed, but external strict replay and fork remain unsupported for the published SDK's checkpoint-shaped event.
