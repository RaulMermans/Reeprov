# Product Surface: Run Debugger

> **Canonical Role:** Interactive forensic debugger and causality inspector for AI agent executions.

---

## 1. Job to Be Done

When an AI agent deviates from intended behavior, fails a task, executes unexpected tools, enters an infinite loop, or exhausts its budget, the developer needs to:
1. Pinpoint the exact step where the failure occurred.
2. Inspect the causality chain: what state existed, what context was provided, what the model reasoned, what tool was invoked, and what error was returned.
3. Distinguish between model reasoning failures, tool execution bugs, context pollution, and infrastructure timeouts using a standardized failure taxonomy.
4. Step backwards and forwards chronologically through the agent's trajectory to observe how intermediate state evolved.

---

## 2. Data Required

The Run Debugger requires the canonical `RunArtifact`:
- **Identity & Trajectory:** `RunIdentity`, chronological `ExecutionStep[]` with step indices, node linkages, and statuses.
- **Boundaries:** `ExecutionBoundary[]` capturing inputs, outputs, side-effect classes, and replayability ratings.
- **Context & Invocations:** `ContextSnapshot` linked to `ModelInvocation` records (tokens, latency, prompt parameters).
- **Tool Invocations:** `ToolInvocation[]` with serialized inputs, outputs, permission classes, and error stacks.
- **State Snapshots:** `StateSnapshot[]` capturing point-in-time agent/workflow variables before and after transitions.
- **Taxonomy Tagging:** Root-cause error classifications (`FailureCategory`).

---

## 3. Primary Views

- **Visual Trajectory Timeline:** Interactive causal DAG showing nodes, branches, and loop iterations with color-coded status chips (completed, degraded, failed, skipped).
- **Step Inspector Slide-Over:** Detailed drawer showing:
  - Input/Output summaries and raw structured payloads.
  - Model prompt and completion breakdown.
  - Active tool invocation arguments and returned values.
  - State delta: diff between state before and after the step.
- **Root Cause & Issues Panel:** Collapsed, deduplicated list of warnings, errors, and eval failures categorized by failure taxonomy (`TOOL_EXECUTION`, `MODEL_REASONING`, `CONTEXT`, `SCHEMA`, etc.) with suggested fixes.
- **Execution Boundary Inspector:** Matrix of external boundaries encountered, showing idempotency keys, replayability rating, and side-effect permissions.

---

## 4. Primary Actions

- **Time-Travel Step Scrubbing:** Jump directly to any execution step to inspect the exact state and context present at that moment.
- **Filter by Evidence Kind:** Toggle visibility of models, tools, evals, artifacts, and errors on the execution canvas.
- **Copy Replay/Repro Payload:** Export a deterministic boundary fixture containing recorded inputs and mocks for local testing.
- **Initiate Fork:** Select an execution checkpoint step to spawn a candidate branch in the Experiment Lab.
- **Promote to Regression Test:** Send a failing step and its evidence to Eval Studio as a persistent regression candidate.

---

## 5. Dependencies

- Canonical `RunArtifact` v1 contract (`identity`, `trajectory`, `boundaries`, `state`, `models`, `tools`).
- Visual Execution Canvas (`components/proof-layer/VisualExecutionCanvas.tsx`).
- Canonical Failure Taxonomy (`FailureCategory`).

---

## 6. Non-Goals

- **Live Process Stepping:** This is not a gdb/pdb live breakpoint runtime pausing active python processes in production. It is a post-hoc and live-streaming execution debugger.
- **Automatic Code Rewriting:** Does not autonomously edit python/typescript agent code.
- **Autonomous Remediation:** Does not apply fixes automatically to production without human confirmation.

---

## 7. Future Evals

- `trajectory`: Did the agent take the optimal path through the workflow topology?
- `tool_selection`: Was the chosen tool the correct tool given the context?
- `argument_validity`: Did the tool arguments conform strictly to the expected schema?
- `latency`: Did individual execution steps meet SLA targets?

---

## 8. Risks

- **Payload Size Inflation:** Heavy model outputs or tool responses could degrade browser rendering performance. Mitigation: lazy loading of large boundary payloads and content hashing.
- **Secret Exposure:** Inspecting raw inputs/outputs carries credential exposure risks. Mitigation: enforce strict server-side redaction and indicate `redaction_status` on every boundary.
