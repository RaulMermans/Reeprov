# Offline Replay Safety Model

## 1. Zero Live Network Guarantee (`NetworkKillSwitch`)

During `STRICT_OFFLINE` replay, Reeprov activates a strict `NetworkKillSwitch`.

### Interception Seam:
- Global `fetch` is patched to reject immediately with `NetworkAccessDeniedError`.
- Node `http.request`, `http.get`, `https.request`, and `https.get` are trapped and emit error events without opening OS sockets.
- All blocked attempts are counted under `live_calls_blocked` and recorded in the divergence report under `NETWORK_ATTEMPT_BLOCKED`.

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

- Secret redaction (OpenAI keys, Anthropic keys, GitHub tokens, database connection strings, bearer tokens) runs during initial capture before payloads are hashed or stored.
- Content availability follows a strict canonical vocabulary:
  `CAPTURED`, `REDACTED`, `HASH_ONLY`, `TRUNCATED`, `NOT_CAPTURED`, `UNAVAILABLE`.
- In `STRICT_OFFLINE`, boundaries missing necessary output payloads are detected prior to execution by the `ReplayPlanner`, preventing incomplete or insecure offline runs.
