# Maintainer Release Process & Governance

This document outlines the strict release procedure for Reeprov core releases and public SDK packages.

---

## 1. Principles

1. **No Unattended Auto-Publishing:** Merging a pull request to `main` must **never** automatically publish packages to public registries.
2. **Provenance & Least Privilege:** Package publishing relies on GitHub OIDC / npm provenance where supported. Long-lived credentials must never be committed to repository code.
3. **Artifact Verification:** Built tarballs and wheels must be inspected locally before triggering production publication.

---

## 2. Release Steps

### Step 1: Version Bumping
Coordinate versions across packages following Semantic Versioning:
- **Core / Studio:** `package.json` (e.g. `0.1.0-beta.1`)
- **TypeScript Client:** `packages/client-typescript/package.json` (`0.1.0-beta.1`)
- **Python Client:** `packages/client-python/pyproject.toml` (`0.1.0b1`)

### Step 2: Update Documentation & Changelog
1. Update `CHANGELOG.md` with the release notes, grouping by `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, and `Security`.
2. Confirm all links and version examples in `README.md` are accurate.

### Step 3: Run Full Local Verification
Run the complete CI suite:
```bash
npm run ci
```

Verify that the CLI executable works without error:
```bash
./bin/reeprov.mjs --help
```

### Step 4: Audit Distributable Artifacts

#### TypeScript SDK
```bash
cd packages/client-typescript
npm install
npm run build
npm pack --dry-run
```
Verify the output contains **only** `dist/`, `package.json`, `README.md`, and `LICENSE`. No tests, private fixtures, or `.env` files.

#### Python SDK
```bash
cd packages/client-python
python -m build
twine check dist/*
```
Verify the contents of the built tarball and wheel.

### Step 5: Trigger Manual Release Workflow
1. Navigate to **Actions** → **Release Publish** in the GitHub repository.
2. Select **Run workflow**, specify the version string, and verify `dry_run` is set to `false` only when ready.
3. The workflow requires human approval via the protected `production` environment.

---

## 3. Rollback & Yanking

If a critical flaw or security vulnerability is discovered after publication:
- **npm:** Deprecate the package version immediately:
  ```bash
  npm deprecate @reeprov/client@0.1.0-beta.1 "Critical defect in telemetry queue. Upgrade to 0.1.0-beta.2"
  ```
- **PyPI:** Yank the release on PyPI to prevent new installs while preserving reproducibility for pinned builds:
  ```bash
  # Via PyPI management UI or API
  ```
- **GitHub:** Mark the GitHub release as pre-release or edit release notes to warn users.
