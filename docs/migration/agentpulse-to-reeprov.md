# Migration Guide: AgentPulse → Reeprov

This guide provides step-by-step instructions for upgrading existing environments, configurations, and agent instrumentation from **AgentPulse** to **Reeprov**.

---

## 1. Overview & Naming

AgentPulse has been renamed to **Reeprov** (pronounced *"ree-proove"* — combining *Reproduce* and *Prove*).

The canonical product release is **Reeprov 0.1.0-beta.1**.

### Key Changes at a Glance

| Component | Legacy (AgentPulse) | Canonical (Reeprov) | Compatibility Status |
|---|---|---|---|
| Product Name | AgentPulse | **Reeprov** | Active rename |
| Data Directory | `~/.agentpulse/` | `~/.reeprov/` | Automated migration script provided |
| CLI Executable | `bin/pulse.mjs` / `npm run pulse` | `bin/reeprov.mjs` / `npm run reeprov` | `pulse` preserved as alias |
| TypeScript SDK | `@agentpulse/client` | `@reeprov/client` | `AgentPulseClient` exported as alias |
| Python SDK | `agentpulse-client` | `reeprov-client` | `agentpulse_client` module alias provided |
| Ingest Key Prefix | `ap_live_` | `ree_live_` | Both accepted by server |
| Auth Header | `x-agentpulse-key` | `x-reeprov-key` | Both accepted by server |
| Env: Mode | `AGENTPULSE_MODE` | `REEPROV_MODE` | Automatic fallback with warning |
| Env: Home | `AGENTPULSE_HOME` | `REEPROV_HOME` | Automatic fallback with warning |
| Env: Access Key | `AGENTPULSE_ACCESS_KEY` | `REEPROV_ACCESS_KEY` | Automatic fallback with warning |
| Env: Ingest Key | `AGENTPULSE_INGEST_KEY` | `REEPROV_INGEST_KEY` | Automatic fallback with warning |
| Env: Store Dir | `AGENTPULSE_STORE_DIR` | `REEPROV_STORE_DIR` | Automatic fallback with warning |
| Env: Server URL | `AGENTPULSE_URL` | `REEPROV_URL` | SDKs support both |
| Database Tables | `ap_*` | `ap_*` | **Unchanged** (preserves DB migration integrity) |

---

## 2. Local Data Migration (`~/.agentpulse` → `~/.reeprov`)

Reeprov includes a built-in migration utility that copies your stored runs, checkpoints, projects, and evidence from the legacy directory to the new directory while preserving a safety backup.

### Dry Run First
To inspect what will be copied without making changes:

```bash
npm run reeprov -- migrate-brand --dry-run
```

### Run Migration
To perform the migration:

```bash
npm run reeprov -- migrate-brand
```

What the migration script does:
1. Verifies `~/.agentpulse` exists.
2. Creates a timestamped safety backup: `~/.agentpulse.backup-<timestamp>`.
3. Copies all data safely to `~/.reeprov/`.
4. Validates that all files are intact in the destination.
5. Preserves `~/.agentpulse` so existing scripts or fallbacks remain functional.

### Rollback Procedure
If you need to revert or restore:
```bash
# If ~/.reeprov needs to be removed:
rm -rf ~/.reeprov

# Restore legacy directory from backup if needed:
cp -r ~/.agentpulse.backup-<timestamp> ~/.agentpulse
```

---

## 3. Environment Variables Migration

Update your `.env`, CI configuration, or deployment environment:

```diff
- AGENTPULSE_MODE=personal_local
+ REEPROV_MODE=personal_local

- AGENTPULSE_HOME=/path/to/data
+ REEPROV_HOME=/path/to/data

- AGENTPULSE_ACCESS_KEY=your-private-access-key
+ REEPROV_ACCESS_KEY=your-private-access-key

- AGENTPULSE_INGEST_KEY=ree_live_...
+ REEPROV_INGEST_KEY=ree_live_...

- AGENTPULSE_URL=http://127.0.0.1:3000
+ REEPROV_URL=http://127.0.0.1:3000
```

> [!NOTE]
> Reeprov automatically falls back to `AGENTPULSE_*` variables if `REEPROV_*` is unset, emitting a non-fatal deprecation warning.

---

## 4. TypeScript Client Migration

### Update Package Dependency
```bash
npm uninstall @agentpulse/client
npm install @reeprov/client
```

### Update Code
```diff
- import { AgentPulseClient } from "@agentpulse/client";
+ import { ReeprovClient } from "@reeprov/client";

- const pulse = new AgentPulseClient({
+ const reeprov = new ReeprovClient({
-   endpoint: process.env.AGENTPULSE_URL,
-   apiKey: process.env.AGENTPULSE_INGEST_KEY,
+   endpoint: process.env.REEPROV_URL,
+   apiKey: process.env.REEPROV_INGEST_KEY,
    projectId: "my-project",
  });
```

> [!TIP]
> `@reeprov/client` exports `AgentPulseClient` as an alias to `ReeprovClient` for seamless gradual transitions.

---

## 5. Python Client Migration

### Update Package Dependency
```bash
pip uninstall agentpulse-client
pip install ./packages/client-python  # from a Reeprov repository checkout; PyPI publication pending
```

### Update Code
```diff
- from agentpulse_client import AgentPulseClient
+ from reeprov_client import ReeprovClient

- pulse = AgentPulseClient(
+ reeprov = ReeprovClient(
-     url=os.environ.get("AGENTPULSE_URL"),
-     ingest_key=os.environ.get("AGENTPULSE_INGEST_KEY"),
+     url=os.environ.get("REEPROV_URL"),
+     ingest_key=os.environ.get("REEPROV_INGEST_KEY"),
      project_id="my-project",
  )
```

> [!TIP]
> `reeprov-client` includes an `agentpulse_client` module shim exporting `AgentPulseClient` for existing scripts.

---

## 6. CLI Usage Migration

Update terminal commands and CI scripts:

```diff
- npm run pulse -- --version
+ npm run reeprov -- --version

- npm run pulse -- data-path
+ npm run reeprov -- data-path

- npm run pulse -- replay <run-id>
+ npm run reeprov -- replay <run-id>

- npm run pulse -- regression check <candidate-id> --baseline <baseline-id>
+ npm run reeprov -- regression check <candidate-id> --baseline <baseline-id>
```

> [!NOTE]
> `bin/pulse.mjs` and `npm run pulse` remain functional as transparent delegating wrappers to `bin/reeprov.mjs`.

---

## 7. Ingest Keys & Authentication Headers

- **Ingest Keys:** Newly generated project ingest keys use the prefix `ree_live_...`. The server continues to accept existing `ap_live_...` ingest keys without modification.
- **HTTP Header:** The canonical authentication header is `x-reeprov-key`. The legacy header `x-agentpulse-key` is accepted seamlessly with identical security posture.

---

## 8. Database Tables Notice

For users deploying with Postgres (`DATABASE_URL`), **no database schema migrations or table renames are required**. Internal database tables retain their existing `ap_*` prefixes (`ap_projects`, `ap_runs`, `ap_checkpoints`, `ap_eval_suites`, `ap_regression_baselines`, etc.) to eliminate data loss risks during minor version upgrades.
