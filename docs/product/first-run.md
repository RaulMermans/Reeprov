# First-Run Onboarding Experience

When an operator launches Reeprov for the first time, the Studio automatically detects that no projects or traces exist and presents the **First-Run Onboarding Experience**.

## Onboarding Flow

1. **Storage Initialization**: Reeprov initializes the local root directory `~/.reeprov/` and provisions its subdirectories (`runs/`, `comparisons/`, `blobs/`, `evals/`, `baselines/`, `backups/`).
2. **Demo Project Seeding**: The operator is invited to click **"Explore Demo Project"**, which invokes `POST /api/demo`. This provisions a complete demonstration project ("Campaign Sandbox Agent") with realistic multi-step traces, tool executions, state checkpoints, and eval assertions.
3. **Connect Your First Agent**: Alternatively, the operator can click **"Connect Agent"** to open the Connect Agent Wizard, register a new project, receive an ingest key, and obtain ready-to-run code snippets for their framework.

## Zero Setup Friction

- In Personal Local mode, no accounts or passwords need to be created.
- The onboarding screen stays hidden once projects exist, but demo data can always be reset from the Settings view.
