# AgentPulse — Open Source Beta Publication Readiness Report

**Project:** AgentPulse  
**Target Release:** `v0.1.0-beta.1` (Core App & TypeScript SDK) / `v0.1.0b1` (Python SDK)  
**Date:** 2026-10-15  
**Audit Posture:** External Stranger / Fresh Machine Verification  
**Evaluation Status:** **BLOCKED** (Namespace Ownership Blocker on npm)  

---

## Executive Summary & Publication Gate Verdict

```text
========================================================================
 FINAL RELEASE GATE VERDICT: BLOCKED
========================================================================
 REASON: npm scope "@agentpulse" is owned by an external third party.
         Publication of "@agentpulse/client" is impossible without
         either acquiring the scope or renaming the published packages.
========================================================================
```

While the codebase, CI pipelines, Docker self-host execution, privacy scans, version consistency automation, and stranger onboarding proofs are **100% verified and functional**, the repository cannot be published under its intended package namespaces due to active third-party registry ownership.

Per release gate policy: **STOP before publication, propose package naming alternatives, and wait for explicit owner decision. Do not make GitHub public, publish to npm, publish to PyPI, or create GitHub releases.**

---

## 1. Registry & Name Pre-Flight Verification Evidence

A thorough registry verification was conducted against npm and PyPI:

### npm Registry Status
- **npm Scope `@agentpulse`:** **TAKEN & UNAVAILABLE**.
  - Registered and owned by third-party maintainer (`helpannouncementbar@gmail.com` / npm user `sru4ka`).
  - Active published package: `@agentpulse/agentpulse@0.5.0` (AI Agent Observability).
  - Scope creation/publication test: HTTP 404 on `@agentpulse/client`, but publishing any package under the `@agentpulse` scope requires organization membership which the repository owner does not possess.
- **Other Active npm Collisions:**
  - `@agentpulselabs/*` (active)
  - `@agentpulsehq/*` (active)
  - `@agent-pulse/*` (active)

### PyPI Registry Status
- **PyPI Project `agentpulse`:** **TAKEN & UNAVAILABLE**.
  - Published on 2026-03-24 by user `chkoutam` (version `0.1.0`, GitHub repo `chkoutam/agentpulse`).
- **PyPI Project `agentpulse-client`:** **AVAILABLE (404)**.
  - Currently unclaimed on PyPI, but presents potential brand confusion with the existing `agentpulse` package.

### Proposed Package Naming Alternatives for Owner Decision
To resolve the registry namespace collision without silently renaming the core project, the following package naming alternatives are presented for explicit owner selection:

| Option | TypeScript npm Package | Python PyPI Package | Notes |
|---|---|---|---|
| **Option 1 (Recommended)** | `@agentpulse-dev/client` | `agentpulse-client` | Clean scope for organization, standard developer namespace. |
| **Option 2** | `@agentpulse-ai/client` | `agentpulse-ai-client` | Aligns both ecosystems with AI domain suffix. |
| **Option 3** | `@agentpulse-io/client` | `agentpulse-io-client` | Aligns with standard `.io` infrastructure domains. |
| **Option 4** | `@raulm/agentpulse-client` | `agentpulse-client` | User-scoped npm package under personal maintainer handle. |

---

## 2. Docker Self-Host Execution Proof

The containerized self-hosted path was completely corrected and executed live in the local environment:

### Corrections Made
1. **Removed Invalid Optional COPY:** Replaced broken Dockerfile instruction `COPY ... public ... 2>/dev/null || true` with clean conditional handling.
2. **Eliminated Missing `public/` Directory Reference:** Cleaned up multi-stage runner references.
3. **Decoupled Launcher Script:** Made `scripts/start-agentpulse.ts` standalone by internalizing operating mode resolution rather than importing `@/lib/auth/operatingMode`.
4. **Standalone Compiled Runtime:** Configured Next.js with `output: "standalone"` in `next.config.ts`. The runner stage packages only compiled standalone server assets (`.next/standalone`, `.next/static`) rather than copying raw source.
5. **Storage Root Enforcement:** Configured `AGENTPULSE_STORE_DIR=/home/nextjs/.agentpulse` and `AGENTPULSE_HOME=/home/nextjs/.agentpulse` with volume mount `/home/nextjs/.agentpulse` to ensure persistence across restarts.

### Live Execution Results
- **Image Build:** `docker build -t agentpulse-studio:test .` completed successfully (Exit code: 0).
- **Service Launch:** `docker compose up -d` started container `agentpulse-studio`.
- **Health Check:** `docker ps` verified status `Up (healthy)`.
- **Studio Reachability:** `GET http://127.0.0.1:3000/api/health` returned `200 OK` (`{"ok": true, "environment": "production", "version": "0.1.0-beta.1"}`).
- **Self-Hosted Auth Enforcement:** Unauthenticated `GET http://127.0.0.1:3000/api/projects` returned `401 Unauthorized` (`unauthorized_session`), proving access key requirement is enforced.
- **Persistent Volume Verification:**
  - Created test project via `POST /api/projects` with `x-agentpulse-key`: returned `201 Created` (`docker-test-project`).
  - Executed `docker compose restart`.
  - Re-queried `GET /api/projects` with auth: returned `docker-test-project`, proving persistence.
- **Teardown:** Cleaned up test containers and volumes with `docker compose down -v`.

---

## 3. CLI Distribution Truth & Verification

- **Repository Root Posture:** Root maintains `"private": true` in `package.json`. It will never be published to npm.
- **Distribution Classification:** The `pulse` CLI is classified as **REPO-LOCAL PUBLIC/BETA** rather than a globally distributed npm binary.
- **Execution Contract:** All documentation directs users to invoke the CLI via `npm run pulse -- <command>` or `./bin/pulse.mjs <command>`.
- **Verified CLI Commands:** Every command documented in `README.md` was executed and verified:
  - `npm run pulse -- --version` → `AgentPulse v0.1.0-beta.1 (beta)`
  - `npm run pulse -- --help` → Formatted CLI command reference
  - `npm run pulse -- data-path` → Verified loopback binding and storage subdirectories
  - `npm run pulse -- data-path --json` → Validated JSON posture output
  - `npm run pulse -- demo setup` → Initialized deterministic demo project (`demo-support-agent`)
  - `npm run pulse -- projects list` → Enumerated configured projects and ingest key previews
  - `npm run pulse -- export project demo-support-agent --out ./backup.json` → Exported full sanitized bundle
  - `npm run pulse -- replay demo_run_success_001 --strict` → Deterministic offline match (0 live calls)
  - `npm run pulse -- diff demo_run_success_001 demo_run_failure_002 --first-divergence` → Isolated first divergence (`TOOL_OUTPUT`)
  - `npm run pulse -- regression check demo_run_failure_002 --baseline <baseline-id>` → Enforced pre-merge gate
  - `npm run pulse -- demo reset` → Wiped demo project back to clean slate

---

## 4. Release-Candidate Path & Privacy Scan

- **Root Cause of Prior Failure:** CI was running a naive `grep -rn '/Users/'` that tripped on benign rule documentation, tests, and PR templates.
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

- **Validation Gate:** `.github/workflows/release.yml` now executes deterministic release-version validation (`scripts/validate-release-version.mjs`), `npm run ci`, and `npm run audit:paths` before any publish step.
- **Artifact Promotion:** SDKs are built, packed, and verified once in the `validate` job (`agentpulse-client-*.tgz` and `packages/client-python/dist/*`), then promoted to `publish-packages`. The publish step never rebuilds from dirty source.
- **npm Provenance:** Configured with `id-token: write` and `npm publish "$TARBALL" --access public --provenance`.
- **PyPI Authentication Truth:** Explicitly documented that PyPI uses API-Token authentication (`TWINE_USERNAME: __token__` and `secrets.PYPI_API_TOKEN`). It does not claim OIDC/Trusted Publishing.
- **Approval Gating:** Job `publish-packages` is bound to GitHub Environment `production` requiring human manual approval.

---

## 7. README Stranger Journey Verification

The onboarding flow documented in `README.md` was executed from the perspective of an external developer:
1. **Clone & Dependencies:** `npm ci` completed cleanly.
2. **Production / Standalone Launch:** `npm run start` started Studio on `http://127.0.0.1:3000` (`Ready in 0ms`).
3. **Studio Homepage:** Navigating to `http://127.0.0.1:3000/` followed 307 redirect to `/dashboard` with HTTP 200.
4. **Project Creation:** Created project `stranger-test-project` via `POST /api/projects` returning 201 Created and ingest key.
5. **Packaged TypeScript SDK Verification:** Executed ESM script importing from built `@agentpulse/client`:
   - Started run (`run_mv9yn9rn_dbe8`).
   - Emitted model boundary call.
   - Emitted tool execution boundary.
   - Completed run.
   - Result: 100% SUCCESS.
6. **Packaged Python SDK Verification:** Executed Python script importing from built `agentpulse_client`:
   - Started run (`stranger-test-project-tm0yeudz`).
   - Emitted model boundary call.
   - Emitted tool execution boundary.
   - Completed run.
   - Result: 100% SUCCESS.
7. **Studio Trace Verification:** `GET /api/runs?projectId=stranger-test-project` confirmed both runs were received and persisted with completed status and full boundary events.

---

## 8. Full Quality Gate Status

```text
========================================================================
 QUALITY GATE VERIFICATION RESULTS
========================================================================
ESLint:                   PASS (0 errors, 0 warnings across all files)
TypeScript (tsc --noEmit): PASS (0 type errors)
Vitest Test Suites:       PASS (121 / 121 test files passed)
Total Tests:              PASS (1,886 / 1,886 tests passed)
Next.js Production Build: PASS (59 routes compiled, 0 errors)
TypeScript SDK Build:     PASS (dist generated, npm pack verified)
Python SDK Build:         PASS (sdist generated, pure stdlib verified)
Path & Privacy Audit:     PASS (3,098 files scanned, 0 leaks detected)
Version Consistency:      PASS (SemVer 0.1.0-beta.1 <-> PEP 440 0.1.0b1)
IRIS Packaged Dogfood:    PASS (13 / 13 tests passed)
Docker Self-Host Proof:   PASS (Build, Up, Health, Auth, Persistence)
========================================================================
```

---

## 9. Required External Actions (Awaiting Owner Action)

Because the release gate is **`BLOCKED`** on registry namespace availability, the following actions **CANNOT AND MUST NOT BE EXECUTED AUTOMATICALLY**:

1. **DO NOT make GitHub repository public.**
2. **DO NOT publish npm packages.**
3. **DO NOT publish PyPI packages.**
4. **DO NOT create GitHub releases or push release tags.**
5. **DO NOT use browser automation or Playwright to manipulate repository settings or visibility.**

### Required Decisions from Repository Owner:
1. **Select Package Naming Alternative:**
   - Choose from `@agentpulse-dev/client`, `@agentpulse-ai/client`, `@agentpulse-io/client`, or `@raulm/agentpulse-client`.
   - Once chosen, package manifests in `packages/client-typescript` and `packages/client-python` can be updated atomically.
2. **Acknowledge/Resolve PyPI Project Collision:**
   - Confirm whether to publish Python SDK as `agentpulse-client` (unclaimed) or match the selected npm namespace (e.g. `agentpulse-dev-client` or `agentpulse-ai-client`).
3. **Explicit Publication Authorization:**
   - External visibility changes and registry publishing must only be executed manually by the repository owner following namespace resolution.

---

## 10. Final Gate Determination

```text
BLOCKED
```
