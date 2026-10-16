# Privacy Guarantees & Zero-Telemetry Posture

Reeprov is built from the ground up on a **local-first, privacy-guaranteed** architecture.

## Guarantees

1. **Zero External Telemetry**: Reeprov does not phone home, transmit usage statistics, or send analytics pings to external servers.
2. **Local Data Residence**: All traces, checkpoints, configurations, and evaluation metrics remain strictly inside your machine or private self-hosted storage.
3. **Loopback Network Isolation**: In `personal_local` mode, network traffic is confined to the loopback interface (`127.0.0.1` and `::1`). External network connections to the Studio dashboard are blocked.
4. **Secret Redaction**: Sensitive credentials (API keys, GitHub tokens, database passwords) are redacted prior to persistence or rendering in reports.
5. **Sanitized Export**: Project exports generated via `GET /api/projects/[projectId]/export` omit secret keys and sensitive operational tokens.
