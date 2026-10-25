# Security Policy

Reeprov takes the security of agent execution evidence, trace data, and private developer environments seriously.

## Supported Versions

Only the latest beta and release candidate versions receive active security updates.

| Version | Supported |
|---------|-----------|
| `0.1.x` (Beta) | :white_check_mark: |
| `< 0.1.0` | :x: |

## Reporting a Vulnerability

**Do NOT report security vulnerabilities via public GitHub issues, pull requests, or public discussions.**

To report a vulnerability:
1. Go to the **Security** tab of the [Reeprov GitHub repository](https://github.com/RaulMermans/Reeprov/security).
2. Click **Report a vulnerability** to create a private GitHub Security Advisory.
3. Provide a detailed summary, including:
   - Operating mode (`PERSONAL_LOCAL`, `PRIVATE_SELF_HOSTED`, or `HEADLESS_CI`)
   - Attack vector and reproduction steps
   - Potential impact
   - Any remediation suggestions

### Response Posture
- **Acknowledgment:** We aim to acknowledge reports within 72 hours.
- **Assessment:** Vulnerabilities are triaged and assessed within 7 business days.
- **Fix & Disclosure:** We target releasing a patch within 30 days of confirmed vulnerability receipt. Coordinated public disclosure follows after the fix is available.

---

## Sensitive Trace Data & Privacy Warning

Execution traces captured from AI agents may contain prompts, responses, model completions, tool arguments, or environment details.

> [!WARNING]
> When opening public bug reports or feature requests, **NEVER attach raw trace payloads, production logs, or API keys**. Use synthetic reproduction data only.

Reeprov enforces local-first security boundaries:
- **`PERSONAL_LOCAL` mode:** Bound strictly to loopback (`127.0.0.1` / `::1`). Zero external telemetry or cloud sync.
- **`PRIVATE_SELF_HOSTED` mode:** Requires session authentication via `REEPROV_ACCESS_KEY` (or legacy `AGENTPULSE_ACCESS_KEY`) generating HttpOnly, SameSite=Lax signed cookies.
- **Redaction Engine:** Server-side secret scrubbing engine masks OpenAI, Anthropic, GitHub, database connection strings, bearer tokens, and private keys before persistence or export.

Offline replay intercepts known Node network and subprocess APIs within its process. It does not provide operating-system isolation or a comprehensive zero-egress guarantee for untrusted host code. See [Sprint 12 privacy and replay review](docs/security/S12-privacy-and-replay-review.md) for the current verification limits.

---

## Security Architecture & References

For deep dives into Reeprov's security model, refer to our architecture specifications:
- [Capture & Secret Redaction](docs/security/capture-and-redaction.md)
- [Fork Safety & Execution Isolation](docs/security/fork-safety.md)
- [Offline Replay Safety](docs/security/offline-replay-safety.md)
- [Deployment Modes & Threat Model](docs/architecture/deployment-modes.md)
- [Access Control & Session Hardening](docs/architecture/access-control.md)
- [Migration Guide](docs/migration/agentpulse-to-reeprov.md)
