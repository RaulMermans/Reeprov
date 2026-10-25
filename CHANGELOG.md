# Changelog

All notable changes to Reeprov will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased — Sprint 12 hardening

- Patched the resolved Next.js and Zod versions and repaired the Linux npm lockfile for Docker builds.
- Made replay input verification distinguish exact from redacted evidence; strict replay rejects unverifiable and partially replayable runs.
- Applied capture redaction to sidecars, HTTP trace records, fork artifacts, and pre-persistence validation.
- Preserved distinct boundary records from the published SDK and detected rejected records in the SDK source.
- Made missing evaluation evidence fail closed and marked incomplete live results in Studio.
- Clarified that SDK checkpoint events are not restorable checkpoints. A full external replay and fork remains unverified.
- Added mobile navigation and corrected the connection wizard's SDK examples.

These changes are unreleased. No new beta package or GitHub release has been published.

## [0.1.0-beta.1] - 2026-10-15

Initial open-source public beta release of Reeprov (formerly AgentPulse).

> [!NOTE]
> Reeprov is in active public beta. APIs and data formats may evolve prior to 1.0.0.

### Added

#### Core Capabilities
- **Capture:** Replay-grade boundary capture engine with content-addressed deduplication, non-fatal failure isolation, and server-side secret scrubbing covering 8 credential families.
- **Offline Replay:** Deterministic boundary substitution verifying input hashes and sequence consistency without live model or tool dependencies.
- **Forking:** "Fork from Here" lineage trees allowing execution branches from intermediate steps and boundary states.
- **Comparison:** Side-by-side execution diffing, first-causal-divergence point detection, token consumption variance, and semantic trajectory alignment.
- **Context & Memory Diagnostics:** Provenance tracking for model inputs, context window ablation modeling, and memory lifecycle analysis.
- **Evaluations:** Configurable evaluation suites, dataset import/export, and automated model benchmarks.
- **Regressions:** Golden baseline management, policy and output drift detection, and pre-merge CI release gates.

#### User Interfaces & Tooling
- **Reeprov Studio:** Next.js local-first dashboard with project-scoped views for Runs, Compare, Evals, Regressions, and Privacy Settings.
- **`reeprov` CLI:** Command-line executable for data path inspection, project listing, demo initialization, offline replay, and regression checks (`npm run reeprov`). Backward-compatible `pulse` command preserved.
- **Brand Migration Utility:** Built-in `reeprov migrate-brand` for safely copying data from legacy `~/.agentpulse` to `~/.reeprov` with automatic backups.
- **Demo Project:** Instant zero-config demo (`demo-support-agent`) with pre-seeded baseline, drifted failure run, and regression report.

#### Client SDKs
- **TypeScript Client (`@reeprov/client`):** Standalone zero-runtime-dependency HTTP client supporting `startRun`, `emitTraceEvent`, `completeRun`, `failRun`, and boundary capture helpers (`captureModelCall`, `captureToolCall`, `captureCheckpoint`). Includes bounded timeouts, 401/403 fast-fail, and legacy `AgentPulseClient` export alias.
- **Python Client (`reeprov-client`):** Pure Python stdlib HTTP client with zero third-party dependencies supporting identical run lifecycle and boundary capture semantics, with legacy `agentpulse_client` import wrapper.

#### Architecture & Security
- **Operating Modes:** Support for `PERSONAL_LOCAL` (zero-auth loopback binding), `PRIVATE_SELF_HOSTED` (mandatory HttpOnly session cookie auth), and `HEADLESS_CI` (API/CLI credential gates).
- **Dual Persistence:** Zero-dependency file-based storage (`~/.reeprov/`) for local development, with optional PostgreSQL storage for multi-container deployments.
- **Project-Scoped Security:** Ingest keys (`ree_live_...` and legacy `ap_live_...`) limited strictly to trace ingestion for their specific project.
- **Documentation & Guidelines:** Comprehensive architecture specifications, contributor guide, security disclosure policy, migration guide, and community code of conduct.
