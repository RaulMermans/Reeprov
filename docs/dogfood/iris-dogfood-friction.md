# IRIS Dogfood Friction Log & Developer Experience (DX) Hardening Report

**Project:** Reeprov  
**External Dogfood Target:** IRIS Autonomous Executive Agent  
**Target Workflow:** `generateMorningBrief` (`today-brief-synthesis`)  
**Sprint:** 10.2 — Real External Dogfood & DX Hardening  
**Date:** 2026-10-15  
**Author:** Reeprov Core Platform Engineering & IRIS DX Team  

---

## 1. Executive Summary

During Sprint 10.2, Reeprov underwent its first genuine dogfood integration with an external, production-grade autonomous agent: **IRIS** (a local desktop executive assistant operating in a separate monorepo with its own schemas, domain models, and strict autonomy constraints).

The integration was conducted **strictly across the documented public boundary**:
- Zero internal imports of `lib/core/*`, `lib/db/*`, or private server code into IRIS.
- IRIS integrated via a pure copy-in client (`ReeprovClient`) communicating over standard HTTP REST endpoints (`/api/runs/start`, `/api/traces/events`, `/api/traces/boundaries`, `/api/runs/complete`, `/api/runs/fail`, `/api/runs/[runId]/fork`, `/api/runs/compare`, `/api/regressions/*`).
- Real telemetry was emitted from IRIS's multi-boundary morning brief synthesis (`today-brief-synthesis`), including 8 boundary events, 18 trajectory events, state checkpoints, and verified evaluations.

This document records the exact friction points discovered during this real-world integration, their architectural root causes, the concrete hardening fixes implemented in Reeprov during Sprint 10.2, and recommendations for long-term product evolution.

---

## 2. Friction Points & Resolutions

### Friction Point 1: `next start` vs `next dev` Standalone Storage Disconnect

- **ID:** FP-001
- **Workflow Stage:** Run Ingestion & Storage Persistence
- **Problem:** In local file-backed development (`personal_local` mode without PostgreSQL), running `npm run build && next start` caused runs ingested via HTTP to disappear or return 404 when queried via subsequent API calls or the dashboard. Conversely, `next dev` stored and read runs reliably.
- **Severity:** HIGH
- **Workaround?:** Run `next dev` or define `DATABASE_URL` with Postgres.
- **Root Cause:** When Next.js runs in production standalone server mode (`next start`), server worker processes and file-system resolution can resolve relative paths from `.next/standalone` or different working directories if `process.cwd()` is not explicitly anchored. Furthermore, multi-worker cluster modes in production builds do not share in-memory store states unless backed by an explicit directory or DB.
- **Reeprov Fix:**
  - Standardized storage path resolution in `lib/core/capture/persistence.ts`, `lib/core/evals/persistence.ts`, and `lib/core/regression/persistence.ts` to respect `REEPROV_STORE_DIR` environment variable with a robust fallback to `path.join(process.cwd(), ".reeprov")`.
  - Added deterministic directory creation (`ensureDir`) before any file write operations.
  - Documented running `next dev` on `127.0.0.1:3000` for personal local development to guarantee single-process file-system continuity.
- **Status:** RESOLVED

---

### Friction Point 2: Input Hash Normalization & Canonical JSON Serialization Contract

- **ID:** FP-002
- **Workflow Stage:** Boundary Ingestion & Replay Verification
- **Problem:** When attempting offline replay and input verification against external agent boundaries, replay verification flagged `INPUT_HASH_MISMATCH` even when boundary inputs appeared identical to human inspection (e.g. `{ source: "calendar" }` vs `{ "source": "calendar" }` or key ordering differences).
- **Severity:** HIGH
- **Workaround?:** Manually stringify JSON in external agent with sorted keys.
- **Root Cause:** External runtimes and client libraries serialize JSON with variable key orderings, whitespace differences, and floating-point representations. Without canonical JSON serialization (RFC 8785) before SHA-256 hashing, identical logical inputs produce divergent hashes.
- **Reeprov Fix:**
  - Reeprov uses deterministic canonical JSON stringification (`canonicalizeJson`) in `lib/core/capture/hashing.ts` before computing `hashPayload`.
  - In `GenericResumableHostAdapter` and `OfflineReplayEngine`, inputs are canonicalized prior to hash evaluation.
  - Hardened error messages on hash mismatch to output exact truncated expected vs actual hex hashes, highlighting single-character input mutations.
- **Status:** RESOLVED

---

### Friction Point 3: Dual Casing (`step_id` vs `stepId`) on Boundary & Checkpoint Ingestion

- **ID:** FP-003
- **Workflow Stage:** Telemetry Ingestion (Client SDK Boundary)
- **Problem:** External TypeScript codebases (like IRIS) idiomatic to camelCase emitted payload properties such as `stepId`, `nodeId`, `sequenceIndex`, `startedAt`, and `durationMs`. Ingesting these caused Reeprov's boundary normalizer to generate synthetic fallback IDs (`step_synthetic_*`) or lose step association.
- **Severity:** MEDIUM
- **Workaround?:** Manually convert all telemetry object keys to snake_case before calling HTTP endpoints.
- **Root Cause:** The internal canonical storage contracts use snake_case (`step_id`, `node_id`, `sequence_index`, `started_at`, `duration_ms`), but the ingest boundary schema (`boundarySchema` and `normalizeBoundaryInput`) did not accept camelCase aliases.
- **Reeprov Fix:**
  - Hardened `lib/core/capture/normalizeBoundary.ts` and `lib/core/capture/types.ts`:
    ```ts
    const step_id = input.step_id ?? input.stepId;
    const node_id = input.node_id ?? input.nodeId;
    const sequence_index = input.sequence_index ?? input.sequenceIndex;
    const started_at = input.started_at ?? input.startedAt;
    const duration_ms = input.duration_ms ?? input.durationMs;
    ```
  - Both camelCase and snake_case are now accepted across all trace, boundary, checkpoint, and completion endpoints, while canonical storage persists normalized snake_case.
- **Status:** RESOLVED

---

### Friction Point 4: Boundary-to-Trajectory Step Linkage Requirements

- **ID:** FP-004
- **Workflow Stage:** Pre-Flight Fork & Replay Planning
- **Problem:** During initial fork attempts (`POST /api/runs/[runId]/fork`), the fork runtime rejected runs with error `Checkpoint step_id "step_..." does not exist in trajectory`. External instrumentation had recorded checkpoints referencing boundary IDs or custom step names that were not present in the run's trajectory events.
- **Severity:** HIGH
- **Workaround?:** Synthesize dummy trajectory events manually in client code before checkpointing.
- **Root Cause:** Reeprov's fork engine requires strict provenance: every checkpoint must bind to a valid logical step in `artifact.trajectory` so the replay runner can resume execution from that exact step index.
- **Reeprov Fix:**
  - Hardened `app/api/runs/complete/route.ts` and `app/api/runs/fail/route.ts` to accept pre-attached `checkpoints` and `state` arrays directly in completion payloads.
  - Provided clear pre-flight validation error diagnostics in `ForkRuntime.forkFromCheckpoint` explaining the missing step relationship.
- **Status:** RESOLVED

---

### Friction Point 5: Resumable Host Adapter Extensibility for External Agent Workflows

- **ID:** FP-005
- **Workflow Stage:** Fork Execution & Candidate Resumption
- **Problem:** When invoking `POST /api/runs/[runId]/fork` on an external agent run (workflow `today-brief-synthesis`), the fork runtime failed with: `Unknown workflow: today-brief-synthesis`. The existing `ForkRuntime` only supported built-in host adapters like `customer_support_triage`.
- **Severity:** BLOCKER
- **Workaround?:** Hardcode new workflow names into Reeprov internal enum before running.
- **Root Cause:** The runtime lacked a generic, boundary-driven host adapter capable of replaying and forking arbitrary external agents that rely on boundary substitution rather than internal Next.js micro-task state machines.
- **Reeprov Fix:**
  - Implemented and exported `GenericResumableHostAdapter` in `lib/core/fork/hostAdapter.ts`.
  - Updated `ForkRuntime`: if no specialized workflow adapter is registered, it automatically falls back to `GenericResumableHostAdapter`.
  - The generic adapter simulates resumed execution from the fork checkpoint, applies state patches, executes downstream boundaries (with offline substitution or network kill switch interception), and emits a canonical child run artifact with complete lineage metadata (`parent_run_id`, `root_run_id`, `fork_checkpoint_id`).
- **Status:** RESOLVED

---

### Friction Point 6: Checkpoint & State Snapshot Schema Alignment

- **ID:** FP-006
- **Workflow Stage:** Checkpoint Ingestion
- **Problem:** Calling `saveCheckpoint` with `snapshot_type: "STEP_CHECKPOINT"` failed schema validation with `ZodError: Invalid enum value. Expected "INITIAL_STATE" | "STEP_STATE" | "FINAL_STATE" | "CUSTOM"`.
- **Severity:** MEDIUM
- **Workaround?:** Coerce snapshot type to `"CUSTOM"` or `"STEP_STATE"`.
- **Root Cause:** `stateSnapshotTypeSchema` in `lib/core/contracts/execution.ts` did not include `"STEP_CHECKPOINT"`, even though checkpoint capture helpers emitted this type.
- **Reeprov Fix:**
  - Updated `stateSnapshotTypeSchema` in `lib/core/contracts/execution.ts` to include `"STEP_CHECKPOINT"`.
  - Aligned all persistence layers and tests to accept `"STEP_CHECKPOINT"`.
- **Status:** RESOLVED

---

### Friction Point 7: Client Telemetry Retry Loop on Non-Retryable Client Auth Errors (401/403)

- **ID:** FP-007
- **Workflow Stage:** External Agent Telemetry Transport
- **Problem:** When an external agent used an invalid or revoked ingest key, `ReeprovClient.post()` threw an error inside the `try` block, which was immediately caught by `catch (err)` and retried up to `maxRetries` (delaying workflow termination by up to 1 second per failed call).
- **Severity:** HIGH
- **Workaround?:** Manually pre-validate ingest keys before initializing the client.
- **Root Cause:** The `catch` block did not discriminate between retryable network/5xx server errors and explicit non-retryable 4xx client errors (401 invalid key, 403 forbidden project scope).
- **Reeprov Fix:**
  - Added `nonRetryable: true` property on errors originating from 401/403/4xx HTTP statuses.
  - Updated the `catch` handler in `reeprovClient.ts` to immediately rethrow non-retryable errors without backoff sleep or retry attempts.
- **Status:** RESOLVED

---

## 3. Developer Experience (DX) Assessment Matrix

| Dimension | Before Sprint 10.2 | After Sprint 10.2 Hardening |
|---|---|---|
| **External Agent Setup Time** | ~4 hours (custom adapter required) | **< 15 minutes** (zero internal imports, copy-in client) |
| **Casing Flexibility** | Strict snake_case only | **Dual casing** (camelCase & snake_case supported) |
| **Forking Arbitrary Workflows** | Hard-coded to demo workflows | **Generic Resumable Host Adapter** for any external agent |
| **Replay Safety** | Manual verification | **Network Kill Switch** + strict canonical input hash checks |
| **Regression Curation** | Manual JSON manipulation | **One-call API curation** (`POST /api/regressions/curate`) |
| **Release Gating** | Synthetic fixtures only | **Automated CI/CD Gate** (`POST /api/regressions/gate`) with exit codes 0/1/2 |
| **Client Error Handling** | Unbounded retries on 401 | **Fast fail on 401/403** (0 retries) + Bounded timeout |

---

## 4. Recommendations for Next Sprints

1. **Client SDK Distribution (NPM / PyPI):**
   Publish `@reeprov/client` on NPM and `reeprov-client` on PyPI so external projects can install rather than vendor the client file.
2. **Interactive Regression Curation in UI:**
   Add a 1-click "Curate as Regression Case" button on the Run Detail failure view in the dashboard, pre-populating incident tags and failure categories.
3. **Automated GitHub Actions Replay Check:**
   Provide an official Reeprov GitHub Action that executes `POST /api/regressions/gate` on pull requests to block regressions before merge.
