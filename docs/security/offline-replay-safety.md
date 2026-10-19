# Offline Replay Safety Model

## 1. Application-Level Network Guard (`NetworkKillSwitch`)

During `STRICT_OFFLINE` replay, Reeprov activates `NetworkKillSwitch` to block calls through known Node APIs. It is process-global interception, not an OS network sandbox or a comprehensive zero-egress guarantee. Run arbitrary or untrusted host logic only in a separately network-isolated process or container.

### Interception Seam:
- Global `fetch` is patched to reject immediately with `NetworkAccessDeniedError`.
- Node `http`/`https`, direct `net`/`tls` sockets, UDP socket creation, DNS lookup/resolve, and `child_process` entry points are patched to reject synchronously before those APIs perform I/O.
- Blocked calls through these patches are counted under `live_calls_blocked` and reported as `NETWORK_ATTEMPT_BLOCKED`. The count cannot detect calls that bypass the patches.
- A second guard cannot activate while one is active. Other concurrent code in the same process is affected by the process-global patches, so dedicated replay processes remain the safe deployment boundary.
- Modules that captured original functions before activation, native addons, and other unpatched communication paths may bypass this guard. Reeprov does not currently provide process/container network isolation.

---

## 2. Side-Effect Substitution vs Live Re-execution

A historical agent run may have performed non-idempotent or external side-effects (e.g., sending an email, refunding a credit card, writing to production database).

### Policy Distinction:
1. **Substituting Recorded Output** (`SUBSTITUTE_RECORDED`):
   - The replay engine supplies recorded outputs (`{ message_id: 123, status: "sent" }`) to the host agent logic so execution can proceed deterministically.
   - The real side effect is **never** executed.
2. **Authorizing Live Execution** (`AUTHORIZE_LIVE_EXECUTION`):
   - In offline replay, live execution is **strictly forbidden**.
   - If an agent or tool wrapper requests live execution (`sideEffectIntent === "execute_live"`), the resolver immediately halts execution with `SIDE_EFFECT_ATTEMPT_BLOCKED`, marks status as `BLOCKED`, and logs the attempt.
   - There is no ambiguous `allowSideEffects: boolean` flag that could accidentally authorize real side effects.

---

## 3. Secret Redaction & Content Privacy

- Secret redaction (OpenAI keys, Anthropic keys, GitHub tokens, database connection strings, bearer tokens) runs during initial capture before boundary payloads are hashed or stored. Canonical boundary summaries, errors, identities, and metadata are also scrubbed before persistence.
- Content availability follows a strict canonical vocabulary:
  `CAPTURED`, `REDACTED`, `HASH_ONLY`, `TRUNCATED`, `NOT_CAPTURED`, `UNAVAILABLE`.
- In `STRICT_OFFLINE`, boundaries missing necessary output payloads are detected prior to execution by the `ReplayPlanner`, preventing incomplete or insecure offline runs.
