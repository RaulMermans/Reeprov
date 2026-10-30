# Reeprov Documentation Index

Welcome to the Reeprov documentation. Reeprov is local-first debugging, offline replay, and reproducibility infrastructure for external AI agents.

---

## 1. Getting Started
- [Quick Start Guide](../README.md#quick-start) — Local clone, installation, and first launch.
- [Migration Guide](migration/reeprov-to-reeprov.md) — Upgrading from Reeprov to Reeprov.
- [Connect Your Agent](product/connect-agent.md) — 3-step project onboarding and framework instrumentation.
- [First Run Experience](product/first-run.md) — Walkthrough of what to expect on initial execution.

## 2. Product Guides
- [Studio Navigation](product/studio-navigation.md) — Exploration of the product views: Projects, Runs, Compare, Evals, Regressions.
- [Run Debugger](product/run-debugger.md) — Trajectory inspection, step graphs, token usage, and boundary analysis.
- [Eval Studio](product/eval-studio.md) — Test suites, evaluation datasets, and automated model benchmarks.
- [Experiment Lab](product/experiment-lab.md) — Hypothesis tracking, lineage trees, and "Fork from Here".
- [Regression Studio](product/regression-studio.md) — Release baselines, drift detection, and pre-merge release gates.
- [Context Intelligence](product/context-intelligence.md) — Model prompt provenance and token breakdown analysis.
- [Memory Intelligence](product/memory-intelligence.md) — State lifecycle, memory read/write boundaries, and ablation.

## 3. Operating Modes & Privacy
- [Personal Local Mode](product/personal-local-mode.md) — Zero-login loopback bound mode (`127.0.0.1` / `::1`).
- [Self-Hosted Mode](product/self-hosted-mode.md) — Private server hosting with HttpOnly session authentication.
- [Privacy Model](product/privacy.md) — Local-first guarantees, zero cloud uploads, and operator data ownership.
- [Deployment Modes Specification](architecture/deployment-modes.md) — In-depth architectural threat models and environment triggers.

## 4. Integration & SDKs
- [Integration Overview](INTEGRATION_GUIDE.md) — Broad telemetry and trace ingestion guide.
- [TypeScript Client SDK (`@reeprov/client`)](../packages/client-typescript/README.md) — Official Node.js/TypeScript SDK.
- [Python Client SDK (`reeprov-client`)](../packages/client-python/README.md) — Official pure-stdlib Python SDK.
- [REST Ingest API](../examples/integrations/rest/README.md) — Direct HTTP endpoints for custom runtimes.
- [Framework Integration Strategy](integrations/frameworks.md) — Generic SDK status and community adapter contracts.

## 5. Architecture Specifications
- [System Architecture](ARCHITECTURE.md) — Core component overview and data flows.
- [Data Model & Entities](DATA_MODEL.md) — Projects, runs, steps, boundaries, evals, and baselines.
- [Product Specification](PRODUCT_SPEC.md) — Product definition and requirements.
- [Execution Boundary Model](architecture/boundary-model.md) — Canonical boundary structure and classification tiers.
- [Replay-Grade Capture](architecture/replay-grade-capture.md) — Content deduplication and server-side secret scrubbing.
- [Offline Replay Runtime](architecture/offline-replay-runtime.md) — Deterministic boundary substitution without live APIs.
- [Fork Runtime & Lineage](architecture/fork-runtime.md) — Branching execution from arbitrary intermediate boundaries.
- [Run Comparison Model](architecture/run-comparison-model.md) — Divergence detection and causal difference analysis.
- [Evaluation Model](architecture/evaluation-model.md) — Metrics, scoring functions, and automated assertions.
- [Regression Gates](architecture/regression-gates.md) — Drift detection and release gate enforcement.
- [Project Model & Scoping](architecture/project-model.md) — Project-scoped credentials and tenant isolation.
- [Access Control](architecture/access-control.md) — Authentication, session cookies, and loopback enforcement.
- [Local Data Layout](architecture/local-data-layout.md) — Directory layout in `~/.reeprov/`.
- [API Stability & Classification](architecture/api-stability.md) — Public, experimental, and internal stability contracts.

## 6. Security
- [Security Policy](../SECURITY.md) — Supported versions and vulnerability disclosure process.
- [Capture & Secret Redaction](security/capture-and-redaction.md) — Multi-family secret scrubbing rules.
- [Fork Safety](security/fork-safety.md) — Side-effect tier gates during replay and branching.
- [Offline Replay Safety](security/offline-replay-safety.md) — Preventing accidental external side effects during replay.
- [Security Telemetry](architecture/security-telemetry.md) — Audit logging and policy enforcement.

## 7. Contributing & Maintenance
- [Contributing Guide](../CONTRIBUTING.md) — Dev environment, quality gates (`npm run ci`), and PR conventions.
- [Code of Conduct](../CODE_OF_CONDUCT.md) — Contributor Covenant v2.1.
- [Governance](GOVERNANCE.md) — Project governance model.
- [Release Process](maintainers/release-process.md) — Maintainer instructions for packaging and releasing.
- [Production QA Checklist](production-qa-checklist.md) — Manual verification procedures.

## 8. Specifications & Schemas
- [Trace Schema](trace_schema.md) — Canonical trace event schema.
- [Workflow Specification](workflow_spec.md) — Declarative agent workflow schemas.
- [Evaluation Plan](evaluation_plan.md) — Evaluation framework design.
- [Deployment Guide](DEPLOYMENT.md) — Infrastructure deployment options.
- [Roadmap](ROADMAP.md) — Project roadmap and priorities.
- [Sprint P2 Multi-Agent Testbed](sprints/P2-universal-multi-agent-testbed.md) — Research laboratory (not SwarmGuard).
- [P2 verification](testing/p2-multi-agent-testbed.md) — Offline / live-guard reproduction.
- [Sprint P3 Research Infrastructure](sprints/P3-research-infrastructure.md) — Capture, isolation, baselines, evaluation (not SwarmGuard).
- [P3 verification](testing/p3-research-infrastructure.md) — Observability matrix and reproduction.
- [SwarmGuard methodology](research/swarmguard-methodology.md) — Frozen experimental protocol.

## 9. Historical & Internal
- [North Star Vision](architecture/reeprov-north-star.md) — Initial project vision.
- [North Star Reconciliation](architecture/north-star-reconciliation.md) — Milestone reconciliation.
- [Capability History](architecture/capability-history.md) — Sprint-by-sprint development history.
- [Release Evidence](architecture/release-evidence.md) — Dogfood verification and test artifacts.
- [Auditor Agents](AUDITOR_AGENTS.md) — Historical static scanning specs.
