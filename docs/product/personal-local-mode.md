# Personal Local Operating Mode

Reeprov operates in **Personal Local Mode** (`personal_local`) by default. This mode is tailored for individual developers, AI researchers, and engineers debugging agents on their local machines.

## Core Characteristics

- **Zero-Login Experience**: No login page, no credentials required for local dashboard access, and no user accounts.
- **Loopback Privacy Guarantee**: Strictly bound to local loopback interfaces (`127.0.0.1`, `::1`, `localhost`).
- **Remote Access Rejected**: Any non-loopback connection attempting to reach dashboard or administrative endpoints is rejected with HTTP `403 Forbidden` (`loopback_required`).
- **Local Data Storage**: All data is written to the local filesystem (`~/.reeprov/` or custom `REEPROV_STORE_DIR`). Zero cloud telemetry is transmitted.

## Configuration

Personal Local mode is active by default when `REEPROV_MODE` is unset or explicitly configured:

```bash
# Default (automatic)
npm run dev

# Or explicitly set
export REEPROV_MODE=personal_local
npm run dev
```

## Security Invariants

1. **Loopback Binding**: Process must only bind to `127.0.0.1` or `::1`. Binding to `0.0.0.0` or public network adapters is rejected at startup.
2. **Ingest Key Isolation**: Ingest keys (`ree_live_...` or legacy `ap_live_...`) are strictly prohibited from accessing dashboard read/write endpoints or administration APIs.
3. **Header Spoofing Prevention**: Even if the `Host` header is spoofed to `localhost`, request headers such as `X-Forwarded-For` or `X-Real-IP` indicating external client IPs will trigger loopback rejection.
