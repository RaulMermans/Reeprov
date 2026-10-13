# Architecture: Studio-Core Boundary

AgentPulse maintains a strict separation between the **Studio Layer** (visual debugging interface) and the **Core Engine** (reproducibility and diagnostic substrate).

## Architectural Boundary

```text
┌────────────────────────────────────────────────────────┐
│                      Studio Layer                      │
│   Next.js App Router, React Components, Flow Graphs,    │
│   Project Views, Run Summaries, Connect Wizard         │
└───────────────────────────┬────────────────────────────┘
                            │ API Routes & Access Control
┌───────────────────────────▼────────────────────────────┐
│                    Access Control Layer                │
│   Operating Modes (PERSONAL_LOCAL, SELF_HOSTED, CI),   │
│   Loopback Verification, Ingest Key Isolation          │
└───────────────────────────┬────────────────────────────┘
                            │ Typed Contracts & Stores
┌───────────────────────────▼────────────────────────────┐
│                       Core Engine                      │
│   Canonical Run Contracts, Replay Planner, Evals,      │
│   Regression Engine, Storage Stores, Evidence Envelopes│
└────────────────────────────────────────────────────────┘
```

## Boundary Principles

1. **Decoupled Verification**: Core verification and capture algorithms do not depend on Next.js or React UI components.
2. **Deterministic Schemas**: All persisted entities adhere to versioned JSON schema contracts (`schema_version: "1.0.0-alpha"`).
3. **Headless Execution**: The core engine can run entirely headless inside CLI pipelines without loading the Studio.
