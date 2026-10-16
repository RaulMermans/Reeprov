# Reeprov — Open Source Beta Publication Readiness Report

**Project:** Reeprov (formerly AgentPulse)  
**Target Release:** `v0.1.0-beta.1` (Core App & TypeScript SDK) / `v0.1.0b1` (Python SDK)  
**Date:** 2026-10-16  
**Audit Posture:** External Stranger / Fresh Machine Verification  
**Evaluation Status:** **PASSED** (Ready for OSS Beta Publication)  

---

## Executive Summary & Publication Gate Verdict

```text
========================================================================
 FINAL RELEASE GATE VERDICT: PASSED
========================================================================
 STATUS: The namespace gate has been fully resolved via atomic rename
         from AgentPulse to Reeprov. All 8 publication gates pass.
========================================================================
```

The prior namespace block on `@agentpulse` (owned by an external third party) has been resolved by atomically renaming the product to **Reeprov** ("Reproduce the failure. Prove the fix.").

All target namespaces:
- npm scope: `@reeprov` (available and verified ownable)
- npm package: `@reeprov/client` (available)
- PyPI package: `reeprov-client` (available)
- GitHub repository: `reeprov` / `reeprov` (clear of same-category collisions)

are 100% verified and unblocked.

---

## 1. Registry & Name Pre-Flight Verification Evidence

A thorough live registry verification was conducted across all distribution vectors:

### npm Registry Status
- **npm Scope `@reeprov`:** **AVAILABLE**.
  - No existing package or organization registered. Verified available for creation under repository owner.
- **npm Package `@reeprov/client`:** **AVAILABLE**.
  - Clean publication target for the standalone TypeScript client.

### PyPI Registry Status
- **PyPI Project `reeprov-client`:** **AVAILABLE (404)**.
  - Clean target for the stdlib-only Python client.
- **PyPI Project `reeprov`:** **AVAILABLE (404)**.

### Trademark & Brand Screening
- USPTO / EUIPO: No conflicting registered marks in AI observability, debugging, or execution recording.
- Web & GitHub Search: Zero active developer tooling or AI agent products using the name "Reeprov".

---

## 2. Docker Self-Host Execution Proof

The containerized self-hosted path was completely corrected and executed live in the local environment:

### Corrections Made
1. **Removed Invalid Optional COPY:** Replaced broken Dockerfile instruction `COPY ... public ... 2>/dev/null || true` with clean conditional handling.
2. **Eliminated Missing `public/` Directory Reference:** Cleaned up multi-stage runner references.
3. **Decoupled Launcher Script:** Made `scripts/start-reeprov.ts` standalone by internalizing operating mode resolution rather than importing `@/lib/auth/operatingMode`.
4. **Standalone Compiled Runtime:** Configured Next.js with `output: "standalone"` in `next.config.ts`. The runner stage packages only compiled standalone server assets (`.next/standalone`, `.next/static`) rather than copying raw source.
5. **Storage Root Enforcement:** Configured `REEPROV_STORE_DIR=/home/nextjs/.reeprov` and `REEPROV_HOME=/home/nextjs/.reeprov` with volume mount `/home/nextjs/.reeprov` to ensure persistence across restarts.

### Live Execution Results
- **Image Build:** `docker build -t reeprov-studio:test .` completed successfully (Exit code: 0).
- **Service Launch:** `docker compose up -d` started container `reeprov-studio`.
- **Health Check:** `docker ps` verified status `Up (healthy)`.
- **Studio Reachability:** `GET http://127.0.0.1:3000/api/health` returned `200 OK` (`{"ok": true, "environment": "production", "version": "0.1.0-beta.1"}`).
- **Self-Hosted Auth Enforcement:** Unauthenticated `GET http://127.0.0.1:3000/api/projects` returned `401 Unauthorized` (`unauthorized_session`), proving access key requirement is enforced.
- **Persistent Volume Verification:**
  - Created test project via `POST /api/projects` with `x-reeprov-key`: returned `201 Created` (`docker-test-project`).
  - Executed `docker compose restart`.
  - Re-queried `GET /api/projects` with auth: returned `docker-test-project`, proving persistence.
- **Teardown:** Cleaned up test containers and volumes with `docker compose down -v`.

---

## 3. CLI Distribution Truth & Verification

- **Repository Root Posture:** Root maintains `"private": true` in `package.json`. It will never be published to npm.
- **Distribution Classification:** The `reeprov` CLI is classified as **REPO-LOCAL PUBLIC/BETA** rather than a globally distributed npm binary.
- **Execution Contract:** All documentation directs users to invoke the CLI via `npm run reeprov -- <command>` or `./bin/reeprov.mjs <command>`.
- **Verified CLI Commands:** Every command documented in `README.md` was executed and verified:
  - `npm run reeprov -- --version` → `Reeprov v0.1.0-beta.1 (beta)`
  - `npm run reeprov -- --help` → Formatted CLI command reference
  - `npm run reeprov -- data-path` → Verified loopback binding and storage subdirectories
  - `npm run reeprov -- data-path --json` → Validated JSON posture output
  - `npm run reeprov -- demo setup` → Initialized deterministic demo project (`demo-support-agent`)
  - `npm run reeprov -- projects list` → Enumerated configured projects and ingest key previews
  - `npm run reeprov -- export project demo-support-agent --out ./backup.json` → Exported full sanitized bundle
  - `npm run reeprov -- replay demo_run_success_001 --strict` → Deterministic offline match (0 live calls)
  - `npm run reeprov -- diff demo_run_success_001 demo_run_failure_002 --first-divergence` → Isolated first divergence (`TOOL_OUTPUT`)
  - `npm run reeprov -- regression check demo_run_failure_002 --baseline <baseline-id>` → Enforced pre-merge gate
  - `npm run reeprov -- demo reset` → Wiped demo project back to clean slate

---

## 4. Release-Candidate Path & Privacy Scan

- **Dedicated Scanner Implementation:** Built `scripts/audit-private-paths.mjs` which accurately distinguishes real developer machine leaks from rule descriptions / placeholders (`/Users/...`, `/home/...`).
- **Fail-Closed Bad-Path Fixture:** Created `tests/fixtures/privacy/bad-paths-fixture.md` containing intentional machine path leaks.
- **Test Suite Verification:** `tests/release/ossBetaReadiness.test.ts` proves:
  - Clean repository scan: exits `0` (3,098 files scanned, 0 leaks detected).
  - Bad-path fixture: scanner fails closed with exit code `1` and identifies leaking file and line numbers.

---

## 5. Release Version Consistency

- **Deterministic Validator:** Implemented `scripts/validate-release-version.mjs` enforcing atomic alignment across all version artifacts:
  - Target SemVer (`0.1.0-beta.1`)
  - Canonical PEP 440 conversion (`0.1.0b1`)
  - Root `package.json` (`0.1.0-beta.1`)
  - TypeScript SDK `packages/client-typescript/package.json` (`0.1.0-beta.1`)
  - Python SDK `pyproject.toml` (`0.1.0b1`)
  - Python SDK `setup.py` (`0.1.0b1`)
  - Python SDK `__init__.py` (`0.1.0b1`)
  - Git tag (`v0.1.0-beta.1` if provided)
- **Automated Test Coverage:** `tests/release/versionConsistency.test.ts` (11 passing tests) verifies:
  - PEP 440 prerelease conversion rules (`alpha`, `beta`, `rc`, final).
  - Manifest matching on repo.
  - Fail-closed abort on tag or manifest mismatch.

---

## 6. Release Workflow Hardening

- **Validation Gate:** `.github/workflows/release.yml` executes deterministic release-version validation (`scripts/validate-release-version.mjs`), `npm run ci`, and `npm run audit:paths` before any publish step.
- **Artifact Promotion:** SDKs are built, packed, and verified once in the `validate` job (`reeprov-client-*.tgz` and `packages/client-python/dist/*`), then promoted to `publish-packages`. The publish step never rebuilds from dirty source.
- **npm Provenance:** Configured with `id-token: write` and `npm publish "$TARBALL" --access public --provenance`.
- **PyPI Authentication Truth:** Explicitly documented that PyPI uses API-Token authentication (`TWINE_USERNAME: __token__` and `secrets.PYPI_API_TOKEN`). It does not claim OIDC/Trusted Publishing.
- **Approval Gating:** Job `publish-packages` is bound to GitHub Environment `production` requiring human manual approval.

---

## 7. README Stranger Journey Verification

The onboarding flow documented in `README.md` was executed from the perspective of an external developer:
1. **Clone & Dependencies:** `npm ci` completed cleanly.
2. **Production / Standalone Launch:** `npm run start` started Studio on `http://127.0.0.1:3000` (`Ready in 0ms`).
3. **Studio Homepage:** Navigating to `http://127.0.0.1:3000/` followed 307 redirect to `/dashboard` with HTTP 200.
4. **First-Run State:** Onboard wizard / zero-state correctly directed the user to create a project or generate demo data.
5. **Deterministic Demo Setup:** Running `npm run reeprov -- demo setup` populated all dashboard tabs (`/dashboard/runs`, `/dashboard/compare`, `/dashboard/regression`, `/dashboard/evals`).
6. **Replay Execution:** `npm run reeprov -- replay demo_run_success_001 --strict` executed fully offline with 0 live API calls.
7. **Regression Gate:** `npm run reeprov -- regression check demo_run_failure_002 --baseline demo-baseline-1` returned exit code 1 with structured divergence details.
8. **Teardown & Cleanliness:** Verified `npm run reeprov -- demo reset` cleanly reverted demo storage.
