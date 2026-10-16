# Offline Replay Proof & Divergence Test Matrix

## 1. Reference Vertical Slice Fixture (`fixture-h-vertical-slice.json`)

The canonical reference fixture embodies a realistic 4-step, 5-boundary customer support triage agent:

- **Step 0**: Planning (`model_call` — Anthropic Claude 3.5 Sonnet)
- **Step 1**: Policy Retrieval (`retrieval_call` — Pinecone KB) + Reasoning (`model_call` — Anthropic Claude 3.5 Sonnet)
- **Step 2**: Account Lookup (`tool_call` — `get_customer_account`)
- **Step 3**: Synthesis (`model_call` — Anthropic Claude 3.5 Sonnet)

All boundaries have monotonic sequence indices 0..4, distinct IDs, real state snapshots, and causal step linkages.

---

## 2. Test Matrix Coverage

| Scenario | Trigger / Test Mutation | Expected Divergence / Outcome | Test Suite Verification |
| :--- | :--- | :--- | :--- |
| **Happy Path Replay** | Identical inputs & execution path | `status: "MATCHED"`, `deterministic_match: true` | `replayRuntime.test.ts` (13ms, 5/5 sub) |
| **Prompt Mutation** | Prompt altered by 1 char (`.` to `!`) | `INPUT_HASH_MISMATCH` | `replayRuntime.test.ts` |
| **Order Divergence** | Tool called before retrieval | `BOUNDARY_TYPE_MISMATCH` | `replayRuntime.test.ts` |
| **Identity Divergence** | Tool name changed (`get_customer_profile`) | `BOUNDARY_IDENTITY_MISMATCH` | `replayRuntime.test.ts` |
| **Missing Payload** | Output payload marked `UNAVAILABLE` | `MISSING_PAYLOAD` | `replayRuntime.test.ts` |
| **Corrupted State** | State snapshot hash corrupted | `StateRestorationError` | `replayRuntime.test.ts` |
| **Extra Boundary** | Additional unrecorded tool call invoked | `EXTRA_BOUNDARY` | `replayRuntime.test.ts` |
| **Missing Boundary** | Logic finishes early leaving unconsumed bounds | `MISSING_BOUNDARY` | `replayRuntime.test.ts` |
| **Live Side Effect** | Tool requests `execute_live` | `SIDE_EFFECT_ATTEMPT_BLOCKED`, `status: "BLOCKED"` | `replayRuntime.test.ts` |
| **Live Network Attempt** | Logic invokes `fetch()` directly | `NETWORK_ATTEMPT_BLOCKED`, `live_calls_blocked: 1` | `replayRuntime.test.ts` |
| **Pre-flight Corruption** | Incompatible schema version `99.0.0` | `NOT_REPLAYABLE`, `status: "UNSUPPORTED"` | `replayRuntime.test.ts` |
| **Clock & Random** | Seeded random & frozen time | Exact deterministic equivalence | `replayRuntime.test.ts` |
| **Persistence Parity** | `saveReplayResult()` invoked | Written to `.reeprov/replays/` with JSON parity | `replayRuntime.test.ts` |
