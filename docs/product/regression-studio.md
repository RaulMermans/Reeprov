# Product Surface: Regression Studio

> **Canonical Role:** Continuous regression detection, capability drift analytics, and release gate decision intelligence.

---

## 1. Job to Be Done

Before promoting a new agent version or deploying to users, teams must answer 10 fundamental questions:
1. **Did this new agent version get worse?**
2. **Exactly which previously passing cases now fail?**
3. **Did capability change across model, prompt, skill, or tool updates?**
4. **Did security, governance, or permission behavior change?**
5. **Is the change expected (declared) or unexpected (behavioral)?**
6. **Is an apparent drop real or merely stochastic variance across trials?**
7. **Which configuration change is associated with the regression?**
8. **Should CI / release progression be blocked?**
9. **Which production failures have become permanent regression tests?**
10. **Can we reconstruct the history of an agent's capabilities over time?**

Regression Studio provides the unified visual command center answering all 10 questions with cryptographic evidence.

---

## 2. Seven Specialized Product Views (Tabs)

### Tab 1: Release Gate
- **High-Level Promotion Status**: Large status badge (`PASS`, `FAIL`, `NOT_COMPARABLE`, `EVALUATOR_ERROR`).
- **Comparability Assessment Banner**: Displays comparability verdict with dimensions matched and explicit warnings.
- **CI Exit Code Preview**: Shows the machine-readable exit code that would be returned to CI:
  - `0`: Promotion Supported (Pass).
  - `1`: Gate Failed (New regressions or critical safety violations).
  - `2`: Not Comparable / Evaluator Error (Apples-to-oranges test suite or dataset mismatch).
- **Executive Metric Cards**: New Regressions, Existing Failures, Recovered Cases, Critical Failures.
- **Blocker Summary**: Detailed breakdown of blocking reasons when promotion is denied.

### Tab 2: Regression Findings
- **Taxonomy Filtering**: Filter by category (`CASE_REGRESSION`, `SAFETY_REGRESSION`, `COST_REGRESSION`, etc.).
- **Evidence Comparison**: Side-by-side inspection of baseline evidence vs candidate evidence.
- **Causal Attribution Badge**: Labels whether a drop is `DEFINITIVE_REGRESSION`, `PROBABILISTIC_REGRESSION`, or `OBSERVED_DROP` (honest non-definitive language under low sample size).
- **Associated Configuration Diff**: Directly links finding to the exact prompt, model, or tool edit responsible.

### Tab 3: Case Matrix (Paired Dataset View)
- **Paired Case Grid**: When evaluated against a shared `EvalDataset`, displays identical case IDs side-by-side.
- **Transition Status Badges**:
  - `NEW_REGRESSION` (Red): Baseline `PASS` → Candidate `FAIL` (High-signal regression).
  - `EXISTING_FAILURE` (Yellow): Baseline `FAIL` → Candidate `FAIL` (Known pre-existing bug).
  - `RECOVERED` (Green): Baseline `FAIL` → Candidate `PASS` (Bug fixed).
  - `UNCHANGED_PASS` (Gray): Baseline `PASS` → Candidate `PASS`.
  - `UNCHANGED_FAIL` (Muted): Baseline `FAIL` → Candidate `FAIL`.

### Tab 4: Baselines
- **Explicit Baselines Table**: Lists all registered baselines with status (`ACTIVE`, `SUPERSEDED`, `REVOKED`).
- **Cryptographic Evidence Digest**: Visualizes `evidence_hash` proving historical baseline immutability.
- **Baseline Actions**:
  - Register new baseline with explicit approvals.
  - Supersede baseline (`v1` → `v2`) upon qualification.
  - Revoke baseline with mandatory reason and approving actor.

### Tab 5: Curated Tests
- **Production Incident Curation Modal**: Curate any live production failure (`RunArtifact`) into a permanent regression test case with a single click.
- **Provenance Linkage**: Displays source incident ID (e.g. `INC-9482`), original run ID, failure category, and expected behavior.
- **Permanent Suite Growth**: Ensures every production bug becomes a permanent regression benchmark that must pass before future releases.

### Tab 6: Capability History
- **Multi-Dimensional Longitudinal Tracking**: Plots pass rates and scores across 11 distinct dimensions (`TASK_SUCCESS`, `SAFETY`, `TOOL_USE`, `RETRIEVAL`, `MEMORY`, `COST_EFFICIENCY`, etc.) across versions.
- **No Monolithic "IQ" Collapse**: Prevents gains in task success from hiding regressions in safety or cost.
- **Attribution Cards**: Displays configuration changes (prompt revisions, model swaps) associated with each dimensional shift.

### Tab 7: Policy Drift
- **Declared vs Behavioral Governance**: Compares declared permission sets against runtime tool executions.
- **Drift Category Badges**: `PERMISSION_EXPANSION`, `BEHAVIORAL_POLICY_CHANGE`, `APPROVAL_BEHAVIOR_CHANGE`.
- **Sensitive Tool Execution Alerts**: Highlights any unannounced invocation of destructive tools (`write`, `delete`, `drop`, `admin`) as `CRITICAL` blockers.

---

## 3. Dedicated API Endpoints

Regression Studio is backed by 8 REST API routes:

| Route | Methods | Purpose |
| :--- | :--- | :--- |
| `/api/baselines` | `GET`, `POST` | List baselines, create new baseline, supersede, or revoke. |
| `/api/regressions/gate` | `POST` | Evaluate candidate against baseline & policy; return `RegressionGateResult` and machine exit code. |
| `/api/regressions/reports` | `GET` | Retrieve historical regression reports by ID or project. |
| `/api/regressions/curate` | `POST` | Curate production failure run into permanent regression test case. |
| `/api/capabilities/snapshots` | `GET`, `POST` | List and derive multi-dimensional capability snapshots. |
| `/api/capabilities/drift` | `GET`, `POST` | Analyze capability drift between baseline and candidate with config attribution. |
| `/api/policy-drift` | `GET`, `POST` | Ingest runs and detect declared vs behavioral policy drift. |
| `/api/releases` | `GET`, `POST` | Create and query immutable release evidence snapshots. |

---

## 4. UI Navigation Integration

Regression Studio is integrated into the AgentPulse navigation header at `/dashboard/regressions`, sitting alongside **Runs**, **Lineage**, **Comparison**, **Context**, **Evals**, and **Experiments**.
