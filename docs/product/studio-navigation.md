# Studio Navigation & Workspace Structure

The Reeprov Studio UI provides a focused developer experience organized around debugging, evaluating, and governing autonomous AI agents.

## Core Navigation Modules

1. **Project Switcher**: Located in the top navigation bar (`components/layout/NavBar.tsx`), allowing operators to seamlessly switch active projects, view project health, or create new projects.
2. **Projects Overview** (`/dashboard/projects`): Comprehensive project management displaying capture readiness scores, run counts, active frameworks, and project export/deletion options.
3. **Run Debugger** (`/dashboard/runs/[runId]`): Execution trace inspection, interactive visual run graph, token attribution, memory intelligence, and checkpoint timelines.
4. **Run Comparison** (`/dashboard/runs/compare`): Diff view contrasting two run executions, highlighting divergent branches, prompt mutations, and output variances.
5. **Eval Studio** (`/dashboard/evals`): Systematic dataset evaluation, evaluation suites, test cases, and custom metric assertions.
6. **Experiment Lab** (`/dashboard/experiments`): Systematic experimentation matrix, parameter sweeps, and comparative trial scoring.
7. **Regression Studio** (`/dashboard/regressions`): Golden run baselines, regression gate checks, capability snapshots, and drift detection.
8. **Settings & Privacy** (`/dashboard/settings`): Storage directory inspection, active operating mode indicator, demo project reset, and zero-telemetry verification.
