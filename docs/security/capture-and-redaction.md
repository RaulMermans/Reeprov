# Reeprov Security: Telemetry Minimization & Secret Redaction

> **Security Mandate:** Rich execution capture introduces sensitive data risk. Reeprov enforces a strict, server-side sanitization and telemetry minimization pipeline before any boundary record or payload is persisted or rendered.

---

## 1. Security Architecture & Threat Model

Reeprov is a private single-user Next.js dashboard. All repository indexing and GitHub API interactions remain server-side using read-only credentials.

### Non-Negotiable Invariants

1. **No Raw Secrets in Storage or Logs:** Secrets are scrubbed in-memory prior to persistence or logging. Even in `FULL_CONTENT` capture mode, mandatory secret patterns are scrubbed.
2. **Untrusted Evidence Isolation:** All scanned files, agent prompts, and model completions are treated as untrusted data. Instructions discovered inside scanned files or agent contexts are never obeyed by Reeprov scanners or auditors.
3. **Prompt Injection Immunity:** Prompt injection attacks targeting scanned repositories cannot manipulate Reeprov control flow, storage, or telemetry ingestion.
4. **Zero Client-Side Secret Exposure:** Server tokens (`GITHUB_TOKEN`, `DATABASE_URL`, `REEPROV_INGEST_KEY`) are never prefixed with `NEXT_PUBLIC_` and are never serialized into client responses.

---

## 2. Server-Side Secret Scrubbing Engine

Implemented in [`lib/core/capture/redaction.ts`](../../lib/core/capture/redaction.ts), the engine evaluates all boundary inputs, outputs, arguments, and headers across eight distinct pattern classes:

```mermaid
flowchart TD
    RawInput["Raw Boundary Payload\n(Prompt, Args, Output, Headers)"] --> StringSanitizer["1. String Pattern Scrubber"]
    StringSanitizer --> EnvScrubber["2. Process Environment Scrubber"]
    EnvScrubber --> KeyScrubber["3. Sensitive Object Key Scrubber"]
    KeyScrubber --> HeaderScrubber["4. HTTP Header Scrubber"]
    HeaderScrubber --> RedactionResult["Sanitized Payload + Redaction Metadata"]
```

### Supported Pattern Classes

| Pattern Category | Target Format / Signature | Redaction Token |
|---|---|---|
| **Anthropic Keys** | `sk-ant-[a-zA-Z0-9_-]{20,}` | `[REDACTED_ANTHROPIC_KEY]` |
| **OpenAI Keys** | `sk-[a-zA-Z0-9_-]{20,}` | `[REDACTED_OPENAI_KEY]` |
| **GitHub Tokens** | `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_` | `[REDACTED_GITHUB_TOKEN]` |
| **AWS Access Keys** | `AKIA[0-9A-Z]{16}` | `[REDACTED_AWS_KEY]` |
| **Bearer Tokens** | `Bearer [a-zA-Z0-9_.~+/-]{16,}=*` | `Bearer [REDACTED_BEARER_TOKEN]` |
| **Private Keys** | `-----BEGIN PRIVATE KEY----- ... -----END PRIVATE KEY-----` | `[REDACTED_PRIVATE_KEY]` |
| **Database URLs** | `postgres://user:password@host` (also mysql, redis, mongo) | `proto://user:[REDACTED_CREDENTIALS]@host` |
| **Query Credentials** | `?api_key=...`, `&token=...`, `&secret=...` | `?param=[REDACTED_QUERY_PARAM]` |
| **Environment Secrets** | Values of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `DATABASE_URL`, etc. | `[REDACTED_ENV_SECRET]` |
| **Sensitive Headers** | `authorization`, `cookie`, `set-cookie`, `x-api-key`, etc. | `[REDACTED_HEADER]` |
| **Sensitive Keys** | Object keys matching `password`, `secret`, `apiKey`, `authToken`, etc. | `[REDACTED_SECRET]` |

---

## 3. Configurable Capture Modes

Telemetry minimization is governed by three capture modes defined in [`lib/core/capture/types.ts`](../../lib/core/capture/types.ts):

### 1. `STRUCTURE_ONLY`
- Omit all prompt text, document content, and output strings.
- Compute SHA-256 cryptographic hashes and byte counts for verification.
- Stores metadata: model names, token counts, latency, tool schemas, boundary sequences.
- Payload availability marked as `HASH_ONLY`.
- **Intended use:** Highly regulated enterprise environments where prompt text cannot leave isolated agent nodes.

### 2. `SAFE_CONTENT` (Default)
- Retain complete prompt texts and tool arguments up to size thresholds (4KB inline, 512KB total).
- Recursively sanitize all secrets, authorization headers, credentials, and environment values.
- Payloads exceeding inline thresholds are deduplicated into the content-addressed blob store.
- **Intended use:** Standard developer workflows balancing high replay fidelity with strict data protection.

### 3. `FULL_CONTENT`
- Captures extended payload text and diagnostic metadata.
- **Security Invariant:** `FULL_CONTENT` still strictly executes mandatory secret scrubbers. Raw API keys, database URLs, and credentials are **never** persisted under any capture policy.

---

## 4. Replay with Redacted Boundaries

A common concern in agent debugging is whether scrubbed payloads break replay reproducibility.

Reeprov resolves this through **cryptographic separation**:
1. When a secret is redacted, the boundary stores `redaction_status: "redacted"` along with the names of the redacted fields.
2. In strict replay mode, the [`BoundaryReplayHarness`](../../lib/core/capture/replayHarness.ts) verifies the **persisted sanitized hash**.
3. During offline replay, the harness substitutes the recorded output directly without needing the original live API keys.
4. If an agent step depends on a secret that was scrubbed and not available in recorded output, the boundary is classified as `SIDE_EFFECT_GATED` or `NON_REPLAYABLE`, failing closed and preventing silent corruption.
