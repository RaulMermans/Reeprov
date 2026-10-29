# Verification Event Contract & Lifecycle Architecture

## Overview

Verification in Reeprov is structured as an **append-only execution evidence stream**.
Rather than treating verification as an external, unrecorded step or a binary pass/fail flag, Reeprov records lifecycle events with strict monotonic sequence indexing.

---

## 1. Event Taxonomy

Verification events cover tests, reviews, formal verifications, evaluations, approvals, security checks, and artifact verification:

| Event Type | Target Type | Typical Actor | Description |
|---|---|---|---|
| `test.started` | `test` | `test_runner` | Begins execution of a typed test case or suite |
| `test.passed` | `test` | `test_runner` | Test completed within expected criteria |
| `test.failed` | `test` | `test_runner` | Test failed assertion or timed out |
| `review.started` | `review` | `reviewer` / `llm` / `human` | Initiates human or automated code/policy review |
| `review.passed` | `review` | `reviewer` | Review approved without blocking findings |
| `review.failed` | `review` | `reviewer` | Review rejected or requested changes |
| `verification.started` | `verification` | `verifier` | Starts formal policy or invariant verification |
| `verification.passed` | `verification` | `verifier` | Formally verified invariant holds |
| `verification.failed` | `verifier` | `verifier` | Invariant violated |
| `eval.started` | `eval` | `eval_engine` | Begins evaluation run against an `EvalResult` |
| `eval.passed` | `eval` | `eval_engine` | Eval benchmark passed |
| `eval.failed` | `eval` | `eval_engine` | Eval benchmark failed |
| `approval.requested` | `approval` | `agent` | Agent requests human/policy permission |
| `approval.granted` | `approval` | `supervisor` | Approval granted |
| `approval.rejected` | `approval` | `supervisor` | Approval rejected |
| `security.check_started` | `security` | `guard` | Begins policy/permission audit |
| `security.check_passed` | `security` | `guard` | Security checks passed |
| `security.check_failed` | `security` | `guard` | Security violation detected |
| `artifact.verified` | `artifact` | `hasher` | Content blob hash matches verified output |

---

## 2. Event Structure

```typescript
export interface VerificationEvent {
  event_id: string;
  run_id: string;
  step_id?: string;
  event_type: VerificationEventType;
  target_type: "test" | "review" | "eval" | "verification" | "approval" | "security" | "artifact";
  target_id?: string;
  status: "STARTED" | "PASSED" | "FAILED" | "BLOCKED" | "SKIPPED" | "REQUESTED" | "GRANTED" | "REJECTED" | "CANCELLED";
  actor: string;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  evidence_refs: string[];
  artifact_refs: string[];
  details?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  sequence_index: number;
  origin: "externally_observed" | "agent_asserted" | "system_recorded" | "unverified";
  authority: "authoritative" | "asserted" | "unverified";
}
```

`origin` and `authority` default to `unverified` for stored records that predate this field. Agent-authored passes remain claims until independently observed or system-recorded.

---

## 3. Invariants & Sequence Enforcement

Reeprov enforces the following invariants on verification event streams:
1. **Monotonic Sequence Index:** Sequence indices must strictly increase starting from `0`.
2. **Duplicate Detection:** Duplicate `event_id` or sequence index collisions are rejected.
3. **Out-of-Order Detection:** Events with decreasing sequence indices or out-of-order timestamps trigger validation warnings or failures.
4. **Lifecycle Completeness:** Every completed event (`test.passed`, `review.passed`) should reference its corresponding `target_id`.
5. **No Mutation:** Events cannot be updated or deleted post-capture.
6. **Claim/Observation Separation:** `test.passed` with `origin: agent_asserted` is not authoritative verification.
7. **Reference Integrity:** `evidence_refs` that are missing, malformed, duplicated, or scoped to another `run_id` cannot resolve to verified evidence.

---

## 4. Relationship to EvalResult & Content Store

- **`EvalResult` Preservation:** Existing evaluations are preserved in `RunArtifact.trajectory[*].eval_result_ids`. Verification events reference these evaluations without duplication.
- **Content Store Referencing:** Large test outputs, terminal streams, and compiler logs are stored in the Reeprov content store (addressed by content hash) rather than embedding megabytes of raw text into trace events.
