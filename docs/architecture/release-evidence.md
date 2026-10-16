# Reeprov Release Evidence Snapshots

## Durable, Immutable Governance Records

### 1. The Core Purpose of Release Evidence

When an agentic system is promoted to production or released to users, organizations need an auditable answer to the question:
> *"What empirical evidence existed when this specific agent version was deemed acceptable for release?"*

In traditional CI, test logs are ephemeral, drift occurs undetected, and configurations are decoupled from evaluation datasets.

Reeprov solves this with **ReleaseEvidenceSnapshot**:
- A durable, immutable historical artifact created upon release gate qualification.
- Binds configuration, capability profile, security policy, evaluation suite, and regression gate verdict into a single cryptographically sealed record.
- Preserved forever for governance, incident reconstruction, and compliance audits.

---

### 2. Architectural Boundary: No Automated Deployment

Reeprov strictly observes a separation of concerns:

```
[Reeprov]
CAPTURE → INSPECT → REPRODUCE → FORK → PROVE → COMPARE → DIAGNOSE → EVALUATE → REGRESSION / DRIFT
                                                                                           │
                                                                                           ▼
                                                                             [ReleaseEvidenceSnapshot]
                                                                                           │
                                                                           (Verdict: PROMOTION SUPPORTED)
                                                                                           │
───────────────────────────────────────── ARCHITECTURAL BOUNDARY ──────────────────────────┼──────────────
                                                                                           │
[External Release Engineering / CD]                                                        ▼
ArgoCD / GitHub Actions / Kubernetes Controller ───────────────────────────────> Evaluates Evidence & Deploys
```

**Reeprov does NOT deploy containers, update DNS, or restart services.** It produces the authoritative qualification evidence that external CD pipelines inspect before proceeding.

---

### 3. ReleaseEvidenceSnapshot Contract

```typescript
export interface ReleaseEvidenceSnapshot {
  release_evidence_id: string;              // Unique snapshot ID, e.g. "rel_support_v1.4.0_1728812345"
  project_id: string;                       // Project identifier
  release_version: string;                  // Target release version (e.g. "v1.4.0")
  git_sha?: string;                         // Source code repository commit SHA
  agent_id: string;                         // Target agent identifier
  configuration_hash: string;               // SHA-256 sealing models, prompts, skills, and tools
  configuration_snapshot_id?: string;       // Reference to canonical ConfigurationSnapshot
  capability_snapshot_id: string;           // Reference to multi-dimensional CapabilitySnapshot
  policy_snapshot_id: string;               // Reference to PolicyBehaviorSnapshot
  eval_suite_id: string;                    // Test suite used for qualification
  eval_suite_version: number;               // Suite version
  dataset_id?: string;                      // Dataset used for qualification
  dataset_version?: number;                 // Dataset version
  regression_gate_result_id: string;        // Authoritative RegressionGateResult ID
  regression_gate_status: "PASS" | "FAIL" | "NOT_COMPARABLE" | "EVALUATOR_ERROR";
  experiment_provenance_id?: string;        // Optional experiment trial ID if promoted from A/B run
  evidence_hash: string;                    // SHA-256 digest sealing all fields above
  status: "CANDIDATE" | "APPROVED_EXTERNALLY" | "REJECTED" | "SUPERSEDED";
  approved_by?: string;                     // Approving stakeholder (e.g. "vp_engineering")
  approved_at?: string;                     // Approval timestamp
  created_at: string;                       // Snapshot creation timestamp
  metadata: Record<string, unknown>;
}
```

---

### 4. Cryptographic Evidence Hash Calculation

To ensure complete tamper-evidence, `evidence_hash` is computed over the normalized JSON representation of the release parameters:

$$\text{EvidenceHash} = \text{SHA-256}\Big(\text{canonical\_json}\big(\text{release\_version}, \text{configuration\_hash}, \text{capability\_snapshot\_id}, \text{policy\_snapshot\_id}, \text{regression\_gate\_result\_id}\big)\Big)$$

If any constituent evaluation result or policy finding is modified after the fact, the cryptographic digest fails verification.
