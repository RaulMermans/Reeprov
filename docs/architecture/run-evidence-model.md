# Reeprov Run Evidence Model

## Overview

Reeprov captures, inspects, reproduces, forks, and now **proves** agent execution.
The Run Evidence Model extends `RunArtifact` with a first-class evidence plane that captures the verifiable proof of an agent's execution without creating a disconnected or competing run representation.

```mermaid
graph TD
    RunArtifact["RunArtifact (Canonical Execution Truth)"]
    ConfigSnapshot["configuration_snapshot (AgentConfigurationSnapshot)"]
    EvidencePlane["evidence (RunEvidence)"]

    RunArtifact --> ConfigSnapshot
    RunArtifact --> EvidencePlane

    EvidencePlane --> Plan["plan (PlanEvidence - Structured, No CoT)"]
    EvidencePlane --> VerificationEvents["verification_events[] (Append-only Chronology)"]
    EvidencePlane --> TestResults["test_results[] (Typed Executions)"]
    EvidencePlane --> ReviewResults["review_results[] (Typed Code/Policy/Output Reviews)"]
    EvidencePlane --> ApprovalEvents["approval_events[] (Explicit Human/Policy Approvals)"]
    EvidencePlane --> SecurityEvents["security_events[] (Permission & Policy Telemetry)"]
    EvidencePlane --> FinalOutcome["final_outcome (RunOutcome: Status, Verification, Tests)"]

    VerificationEvents -.-> TestResults
    VerificationEvents -.-> ReviewResults
    VerificationEvents -.-> ApprovalEvents
```

---

## 1. Extension of RunArtifact

The evidence plane is embedded directly inside the canonical `RunArtifact`:

```typescript
export interface RunArtifact {
  schema_version: "1.0.0-alpha";
  identity: RunIdentity;
  execution: RunExecution;
  environment: RunEnvironment;
  trajectory: ExecutionStep[];
  boundaries: ExecutionBoundary[];
  state: StateSnapshot[];
  checkpoints: CheckpointReference[];
  lineage: RunLineage;
  // Sprint 5 Evidence Extensions
  configuration_snapshot?: AgentConfigurationSnapshot;
  evidence?: RunEvidence;
}
```

This guarantees:
1. **Single Source of Truth:** Evidence is physically and cryptographically bound to the trajectory, boundaries, and checkpoints.
2. **Backwards Compatibility:** Legacy runs without `evidence` parse without errors.
3. **Immutability:** Once serialized, the artifact (including its evidence and configuration) is immutable.

---

## 2. Explicit Plan Evidence (No Hidden CoT)

`PlanEvidence` captures structured, explicitly emitted plans. It strictly forbids private model reasoning, internal thoughts, or scratchpads.

```typescript
export interface PlanEvidence {
  plan_id: string;
  run_id: string;
  step_id?: string;
  goal: string;
  items: PlanItem[];
  created_at: string;
  producer: string;
  version?: string;
  artifact_ref?: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "SKIPPED" | "CANCELLED";
}

export interface PlanItem {
  id: string;
  description: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "SKIPPED" | "CANCELLED";
  dependencies: string[];
  evidence_refs: string[];
}
```

### Strict Non-CoT Validation
Attempts to inject fields such as `reasoning`, `thought`, `chain_of_thought`, or `scratchpad` are rejected with explicit schema validation errors. Reeprov only records declared commitments, not ungrounded chain-of-thought tokens.

---

## 3. Append-Only Verification Chronology & Typed Results

Reeprov decouples **lifecycle chronology** from **typed result records**:

1. **`VerificationEvent`:** Append-only timeline entries with strictly monotonic sequence indices (`test.started`, `test.passed`, `review.started`, `eval.passed`, `approval.requested`).
2. **`TestResult`:** Normalized results containing test suite, name, status (`PASSED`, `FAILED`, `SKIPPED`, `ERROR`), attempt count, execution duration, and content references for unbounded stdout/stderr.
3. **`ReviewResult`:** Normalized reviews (`CODE`, `OUTPUT`, `SECURITY`, `POLICY`, `HUMAN`, `AUTOMATED`) with explicit findings, severity levels, and evidence references.
4. **`EvalResult`:** Existing evaluation contracts are referenced by verification events, eliminating redundant eval data models.

---

## 4. Run Outcome Contract

A successful HTTP 200 execution does not equal a successful run. A run may complete technically while failing its policy, tests, or security checks.

`RunOutcome` records the comprehensive, multi-dimensional outcome:

```typescript
export interface RunOutcome {
  status: "SUCCESS" | "FAILURE" | "PARTIAL_SUCCESS" | "BLOCKED" | "CANCELLED" | "UNKNOWN";
  reason_code?: string;
  summary?: string;
  output_ref?: string;
  verification_status: "PASS" | "FAIL" | "PARTIAL" | "NOT_RUN";
  tests_status?: "PASS" | "FAIL" | "SKIPPED" | "NOT_RUN";
  review_status?: "PASS" | "FAIL" | "CHANGES_REQUESTED" | "NOT_RUN";
  eval_status?: "PASS" | "FAIL" | "NOT_RUN";
  security_status?: "PASS" | "VIOLATION" | "BLOCKED" | "NOT_RUN";
  completed_at: string;
}
```

---

## 5. Evidence Completeness Scoring

Every run can be evaluated for evidence completeness across 9 canonical dimensions:
- `configuration`
- `plan`
- `tools`
- `tests`
- `review`
- `verification`
- `permissions`
- `artifacts`
- `outcome`

Completeness policies define required dimensions (e.g., `["configuration", "tests", "outcome"]`). If any required dimension is missing, the run fails the evidence policy check, providing an automated gate for CI/CD and deployment pipelines.

---

## 6. Claims vs Observed Evidence

Completeness measures whether records are **present**. It does not decide whether those records are **authoritative**.

Every verification event and test result carries:

- `origin`: `externally_observed` | `agent_asserted` | `system_recorded` | `unverified`
- `authority`: `authoritative` | `asserted` | `unverified`

Rules:

1. An agent saying that validation succeeded is `agent_asserted` and is never authoritative proof.
2. Capture-SDK test helpers record `system_recorded` / `authoritative` because the host actually ran the check.
3. HTTP-ingested `eval_completed` events are stored, but classified as `agent_asserted`.
4. Missing, malformed, duplicate, or cross-run `evidence_refs` stay unresolved. They do not become verified evidence.

`validateEvidenceIntegrity(artifact)` is the canonical checker. `exportRunEvidenceBundle(artifact)` writes that report next to the existing RunArtifact for independent analysis.

---

## 7. Agent Identity and Handoffs

- `identity.agent_id` is the initiating agent when known. It is omitted when unknown.
- `identity.participating_agent_ids` lists distinct observed agent identities. Reeprov does not invent members of this list.
- Trajectory steps, tool invocations, and model invocations may carry `agent_id`.
- Cross-agent transfers are first-class `handoffs[]` records (`from_agent_id`, `to_agent_id`, `attribution_status`). Missing identifiers yield `partial` or `unknown` attribution rather than inferred agents.
