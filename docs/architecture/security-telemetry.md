# Security & Permission Telemetry Architecture

## Overview

Reeprov **observes** policy and permission decisions made by agent runtimes.
It does **NOT** enforce policy or act as an execution gateway. The runtime executes or blocks; Reeprov records the evidence so operators can reconstruct why a decision occurred.

---

## 1. Action Correlation Model

A privileged action is correlated across its entire lifecycle using a stable `action_id`:

```
action.requested
       ↓
permission.checked
       ↓
approval.requested? (if high privilege required)
       ↓
approval.granted / denied?
       ↓
tool boundary invocation (or side_effect.blocked)
       ↓
verification event
```

Using `correlateActionTrail(actionId, evidence)`, auditors can instantly reconstruct the full lifecycle of any privileged action:
- Was the action requested with proper parameters?
- Was permission checked against the active policy?
- Was an approval required, who approved it, and what was the rationale?
- Was a dangerous side-effect blocked offline?

---

## 2. Event Contracts

### SecurityEvent
```typescript
export interface SecurityEvent {
  event_id: string;
  run_id: string;
  step_id?: string;
  action_id?: string;
  agent_id?: string;
  tool_id?: string;
  permission_class?: string;
  policy_id?: string;
  policy_version?: string;
  event_type: string;
  decision: "ALLOW" | "DENY" | "BLOCKED" | "REQUIRE_APPROVAL" | "UNKNOWN";
  reason_code?: string;
  approval_id?: string;
  risk_class?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  target_ref?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
```

### ApprovalEvidence
```typescript
export interface ApprovalEvidence {
  approval_id: string;
  action_id?: string;
  requested_by: string;
  required_permission_class: string;
  requested_at: string;
  resolved_at?: string;
  resolved_by?: string;
  decision: "GRANTED" | "REJECTED" | "EXPIRED" | "PENDING";
  policy_version?: string;
  proposal_hash?: string;
  reason?: string;
  expiry?: string;
  evidence_refs: string[];
}
```

---

## 3. Telemetry Event Types

| Event Type | Typical Decision | Usage |
|---|---|---|
| `action.requested` | `UNKNOWN` / `REQUIRE_APPROVAL` | Agent attempts to invoke tool or effect |
| `permission.checked` | `ALLOW` / `DENY` | Policy engine evaluated capability set |
| `permission.granted` | `ALLOW` | Capability confirmed |
| `permission.denied` | `DENY` | Agent lacked required capability |
| `approval.requested` | `REQUIRE_APPROVAL` | Elevated privileges require explicit approval |
| `approval.granted` | `ALLOW` | Supervisor or automated rule approved proposal |
| `approval.rejected` | `DENY` | Approver denied action |
| `sensitive_tool.accessed` | `ALLOW` | Tool marked with sensitive risk accessed |
| `policy.violation` | `DENY` / `BLOCKED` | Attempt violated explicit rule |
| `side_effect.blocked` | `BLOCKED` | External side effect blocked (e.g. offline fork guard) |
| `destructive_action.blocked` | `BLOCKED` | Irreversible operation blocked by runtime |

---

## 4. Separation of Concerns

1. **External Runtime Responsibility:** Determines capabilities, grants permissions, prompts users for approval, and blocks unauthorized network operations.
2. **Reeprov Responsibility:** Records append-only facts, hashes proposal payloads, preserves lineage, and computes evidence completeness metrics.
