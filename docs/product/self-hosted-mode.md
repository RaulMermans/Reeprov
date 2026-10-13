# Self-Hosted Operating Mode

AgentPulse supports **Self-Hosted Mode** (`self_hosted`, alias `private_self_hosted`) for private team servers, dedicated VMs, Docker containers, or internal cloud instances.

## Core Characteristics

- **Mandatory Instance Authentication**: All dashboard and management endpoints require authentication.
- **Single Instance Owner Model**: Configured via a single shared instance secret (`AGENTPULSE_ACCESS_KEY`).
- **Bounded HttpOnly Sessions**: The Studio UI provides an unlock screen where entering the access key issues a cryptographically signed, bounded HttpOnly session cookie (`agentpulse_session`).
- **Remote Host Binding Allowed**: Binding to `0.0.0.0` or public network interfaces is permitted, provided authentication is enforced.

## Configuration

Enable self-hosted mode by configuring the environment:

```bash
export AGENTPULSE_MODE=self_hosted
export AGENTPULSE_ACCESS_KEY=your-secure-instance-access-key
npm start
```

## Authentication Options

1. **HttpOnly Session Cookie**: Issued via `POST /api/auth/unlock` upon supplying the correct instance access key. Cleared via `POST /api/auth/lock`.
2. **Access Key Header**: API clients can supply `x-agentpulse-key: <key>` or `Authorization: Bearer <key>`.

## Ingest Key Isolation

Even in self-hosted mode, ingest keys (`ap_live_...`) remain isolated to trace ingestion and cannot be used to unlock the dashboard or read reports.
