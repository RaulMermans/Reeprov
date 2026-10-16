# Reeprov Fork Execution Safety Model

## 1. Safety Posture & Threat Model

Branching execution from historical agent state introduces significant security risks:
- **Accidental Side Effects**: An agent resumed at Step 3 might re-issue a refund, send emails, or delete customer records.
- **Uncontrolled Network Access**: Third-party agent dependencies might attempt to communicate with external APIs, telemetry hosts, or production endpoints.
- **State Tampering & Injection**: An operator might inject arbitrary checkpoints from untrusted runs into a privileged session.

> **Core Security Principle**: All fork operations execute under strict sandboxing where network access is severed, live external side-effects are denied by default, and checkpoint provenance is cryptographically verified.

---

## 2. Global Network Kill-Switch

During fork execution under `SAFE_OFFLINE_FORK` policy, the `NetworkKillSwitch` activates before state restoration and remains active until execution concludes:

```typescript
const killSwitch = new NetworkKillSwitch();
killSwitch.activate();
try {
  // Execute fork logic safely
} finally {
  killSwitch.deactivate();
}
```

### Protection Seams:
1. **Global `fetch`**: Replaced with an interceptor throwing `NetworkAccessDeniedError`.
2. **Node `http` and `https`**: Intercepts `http.request`, `http.get`, `https.request`, and `https.get` to block OS socket allocation.
3. **Auditing**: Every intercepted call increments `blocked_actions` in the `ForkResult` and logs a security event.

---

## 3. Side-Effect Denial Policy

The fork dependency policy enforces explicit segregation between recorded substitutions and live side-effects:

```typescript
export type SideEffectMode = "RECORDED" | "DENY" | "SANDBOXED";
```

### Safety Rules:
- **Default Rule**: `side_effect_mode: "DENY"`.
- If an application component or tool wrapper requests live execution (`sideEffectIntent === "execute_live"`), execution is halted immediately.
- The operation returns `status: "BLOCKED"` and records the attempt under `blocked_actions`.
- Tool outputs may only be supplied via:
  1. Recorded historical outputs (`RECORDED`).
  2. Declared, pre-audited developer overrides (`OVERRIDE`).

---

## 4. Cross-Run Checkpoint Injection Defense

Checkpoints are strictly bound to their originating run:

```typescript
if (checkpoint.run_id !== sourceRun.run_id) {
  errors.push({
    code: "CROSS_RUN_CHECKPOINT_REJECTED",
    message: `Checkpoint ${checkpoint.checkpoint_id} belongs to run ${checkpoint.run_id}, not source run ${sourceRun.run_id}`
  });
}
```

An operator or automated runner cannot mount state from Run A into the context of Run B without triggering immediate pre-flight rejection (`CROSS_RUN_CHECKPOINT_REJECTED`).

---

## 5. State Immutability & Hash Verification

1. **Parent Run Protection**:
   Parent artifacts are treated as append-only legal and diagnostic evidence. The fork runtime deep-clones all structures and creates a fresh run artifact with a new ID (`run_<nanoid>`). The parent is never modified.
2. **Snapshot Hash Verification**:
   Before state is mounted into the host adapter, `sha256(canonicalJson(snapshot.state))` is computed and compared against `checkpoint.state_hash`. If hashes diverge, execution halts with `CHECKPOINT_CORRUPT`.
3. **Mutation Audit Trail**:
   Every mutation records:
   - `before_hash`: Cryptographic SHA-256 of the target state before modification.
   - `after_hash`: Cryptographic SHA-256 of the modified state.
   This guarantees complete auditability of intentional deviations.

---

## 6. Secret Redaction & Credential Containment

- All historical states stored in checkpoints have passed through the Reeprov secret redaction engine (redacting OpenAI, Anthropic, GitHub, database connection URLs, and bearer tokens).
- Fork plans and results contain no sensitive credentials.
- The UI `ForkDebuggerPanel` operates exclusively on sanitized payloads and does not accept or persist live credentials.
