# Fork from Here Proof & Verification Matrix

## 1. Customer Support Vertical Slice Reference (`fixture-h-vertical-slice.json`)

The canonical customer support triage workflow demonstrates intermediate checkpoint restoration and counterfactual branching:

### Workflow Steps & Checkpoints:
- **Step 0: Planning**
  - Consumes Boundary 0 (`model_call` — Anthropic Claude 3.5 Sonnet).
  - Produces Checkpoint `chk_step_0` (`boundary_cursor: 1`, `resume_step_index: 1`).
- **Step 1: Policy Retrieval & Triage Reasoning**
  - Consumes Boundary 1 (`retrieval_call` — Pinecone KB) and Boundary 2 (`model_call`).
  - Produces Checkpoint `chk_step_1` (`boundary_cursor: 3`, `resume_step_index: 2`).
- **Step 2: Account Lookup**
  - Consumes Boundary 3 (`tool_call` — `get_customer_account`).
  - Recorded balance in original run: `$300.00`.
  - Produces Checkpoint `chk_step_2` (`boundary_cursor: 4`, `resume_step_index: 3`).
- **Step 3: Synthesis & Recommendation**
  - Consumes Boundary 4 (`model_call`).
  - Baseline outcome: Since balance is `$300.00` (exceeding $100 policy limit), the agent recommends manual escalation.

---

## 2. Verification Proofs

### Proof 1: Intermediate Checkpoint Restore Without Prefix Re-Execution
- **Operation**: Branching from `chk_step_1` (`boundary_cursor: 3`, `resume_step_index: 2`).
- **Observed Behavior**:
  - `CustomerSupportResumableHostAdapter` initializes directly with state from `chk_step_1`.
  - Steps 0 and 1 are skipped completely.
  - Execution begins at Step 2 (`account_lookup`) using Boundary 3.
  - Child artifact contains exactly 2 execution steps (`step_2` and `step_3`).
  - Historical prefix is not duplicated in the child artifact.
  - Parent run artifact remains 100% byte-for-byte identical.

### Proof 2: State Patch Mutation with Cryptographic Auditing
- **Operation**: Apply RFC 6902 patch at checkpoint `chk_step_1`:
  ```json
  {
    "type": "state_patch",
    "patch": [
      { "op": "replace", "path": "/ticket/priority", "value": "CRITICAL" }
    ]
  }
  ```
- **Observed Behavior**:
  - State patch engine validates path existence and mutates isolated clone.
  - Pre-mutation SHA-256 and post-mutation SHA-256 are recorded in `appliedMutations`.
  - The resumed execution receives the modified priority.

### Proof 3: Tool Result Override Counterfactual Divergence
- **Operation**: Branching from `chk_step_1` with tool override:
  ```json
  {
    "type": "tool_result_override",
    "tool_name": "get_customer_account",
    "result": {
      "account_id": "acc_cust_8821",
      "tier": "enterprise",
      "balance": 50.00
    }
  }
  ```
- **Observed Behavior**:
  - Resumed host agent invokes `dependencies.callTool("get_customer_account")`.
  - `BoundaryResolver` returns the overridden balance of `$50.00` instead of historical `$300.00`.
  - Synthesis step detects balance is within the `$100.00` automated limit and issues an immediate automated refund approval.
  - `ForkResult.status` is `COMPLETED`.
  - Child run records lineage: `parent_run_id: "run_customer_support_slice_001"`, `fork_checkpoint_id: "chk_step_1"`.

---

## 3. Comprehensive Fork Test Matrix (`forkRuntime.test.ts`)

| Category | Test Case | Target / Invariant | Result |
| :--- | :--- | :--- | :--- |
| **Pre-Flight Validation** | `validateCheckpoint - valid checkpoint` | Confirms all checkpoint invariants match | Pass |
| **Pre-Flight Validation** | `validateCheckpoint - missing checkpoint` | Throws `CHECKPOINT_NOT_FOUND` | Pass |
| **Pre-Flight Validation** | `validateCheckpoint - cross-run rejection` | Rejects foreign checkpoint ID with `CROSS_RUN_CHECKPOINT_REJECTED` | Pass |
| **Pre-Flight Validation** | `validateCheckpoint - hash mismatch` | Rejects tampered snapshot with `CHECKPOINT_CORRUPT` | Pass |
| **Pre-Flight Validation** | `validateCheckpoint - invalid cursor` | Rejects out-of-range boundary cursor with `INVALID_CURSOR` | Pass |
| **Pre-Flight Validation** | `validateCheckpoint - not restorable` | Rejects snapshot flagged `restorable: false` | Pass |
| **Planner** | `buildForkPlan - produces valid plan` | Generates `FORKABLE` plan with correct resume index and cursor | Pass |
| **Planner** | `buildForkPlan - un-restorable checkpoint` | Returns `NOT_FORKABLE` with explicit validation errors | Pass |
| **Patch Engine** | `applyJsonPatch - replace operation` | Modifies nested value and verifies immutability | Pass |
| **Patch Engine** | `applyJsonPatch - add operation` | Inserts new property into target object | Pass |
| **Patch Engine** | `applyJsonPatch - remove operation` | Deletes property from target object | Pass |
| **Patch Engine** | `applyJsonPatch - missing path error` | Throws validation error on non-existent path | Pass |
| **Patch Engine** | `applyJsonPatch - protected path error` | Blocks modification of internal runtime metadata | Pass |
| **Mutation Applier** | `applyMutations - state patch with hashes` | Computes valid `before_hash` and `after_hash` audit trail | Pass |
| **Mutation Applier** | `applyMutations - tool result override` | Configures tool override mapping for resolver | Pass |
| **Resolver Start Cursor**| `BoundaryResolver - startCursor` | Resolves from cursor 3; does not replay boundaries 0..2 | Pass |
| **Resolver Start Cursor**| `BoundaryResolver - fork substituted count`| Correctly tallies boundaries substituted after cursor | Pass |
| **Resolver Start Cursor**| `BoundaryResolver - tool override` | Returns overridden tool output over recorded output | Pass |
| **Runtime Execution** | `Intermediate checkpoint restore (No-op)` | Executes steps 2 and 3; leaves parent run unmodified | Pass |
| **Runtime Execution** | `Tool override counterfactual divergence`| Executes with balance $50; diverges output to approval | Pass |
| **Runtime Execution** | `State patch mutation execution` | Restores patched state and completes successfully | Pass |
| **Lineage & Traversal** | `Lineage graph queries` | Correctly resolves parent, root, children, ancestors, descendants | Pass |
| **Lineage & Traversal** | `Lineage cycle detection` | Intercepts circular lineage loops with `LineageCycleError` | Pass |
| **Lineage & Traversal** | `materializeLineageView` | Synthesizes prefix steps + child steps into unified timeline | Pass |
| **Safety & Security** | `NetworkKillSwitch during fork` | Blocks live network attempts; records `blocked_actions` | Pass |
