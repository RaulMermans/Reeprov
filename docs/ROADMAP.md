# Roadmap

## Phase 0: Scaffold

Create the private dashboard, API routes, static scanner, placeholder auditors, docs, and prompt templates.

## Phase 1: GitHub Repo Scanner

Harden file fetching, handle rate limits, add repository search, improve file size controls, and surface scan errors clearly.

## Phase 2: Static Audit Engine

Improve detectors for agents, prompts, tools, evals, workflows, approval policies, memory use, dependency risk, and documentation gaps.

## Phase 3: AI Auditor Layer

Add real LLM auditor calls using redacted evidence, structured schemas, evidence citations, and prompt-injection defenses.

Commit 4 is complete when private Vercel deployment readiness is documented and the first real Prompt Auditor runs behind `ENABLE_LLM_AUDITORS`.

## Phase 4: Dashboard Polish — Scanner Precision + Workflow Support

**Commit 5: Scanner precision + workflow support + report UX (complete)**

- Secret scanner now classifies matches into high/medium/low confidence. Low-confidence token words are not flagged.
- Security scoring is confidence-aware: heuristic token mentions do not crater the score.
- Workflow projects are first-class: `workflow.yaml`, `workflows.yaml`, `workflow.json`, `pipeline.yaml`, and `/workflows/` directories are detected and shown on the dashboard.
- `DetectedWorkflow` type added with `id`, `name`, `type`, `stages`, `tools`, `evals`, `configPath`, and `risks`.
- Missing `agents.yaml` is not flagged for workflow-only projects.
- Findings include optional `evidenceSnippets` with short redacted excerpts (expandable in the UI).
- Recommendations are de-duplicated: multiple secret findings collapse into one rotation message.
- Dashboard shows project type (Agent system / Workflow system / Hybrid / Unknown) and a Detected workflows section.

**Commit 6: ZIP upload + report export + dashboard polish**

- ZIP upload support for GitHub archives, converging into the shared `RepoFile[]` scanner pipeline.
- Export scan report as JSON or Markdown.
- Finding severity grouping and filtering.
- Score explanations and per-category drilldowns.
- Evidence snippet expansion improvement.

**Commit 6A: Vercel ZIP limit alignment (complete)**

- Direct ZIP upload aligned with Vercel request body limits at 4 MB.
- Dashboard and `/api/scan-zip` both direct larger repositories to GitHub scanning.
- ZIP safety limits remain in place after upload: 50 MB uncompressed, 500 files, 1 MB per analyzed text file, and 240-character paths.
- Larger-ZIP options deferred: client-side extraction, Vercel Blob temporary upload/scan/delete, or local CLI scanner.

**Commit 7: deployed smoke-test fixes + dashboard/report polish**

- Run deployed staging smoke tests and fix any Vercel-specific route, rendering, timeout, or response-size issues.
- Polish dashboard and report UX based on real deployed scans.
- Add scan history only if persistence becomes necessary in a later commit.

**Commit 8: Scan history**

- Persist redacted reports in a simple store.
- Score trend chart per repository.
- Finding diff between scans.

**Commit 9: GitHub OAuth or GitHub App**

- Replace shared access key with GitHub OAuth restricted to the repo owner.
- Or: GitHub App installation for personal repos.

## Phase 5: Scan History

Persist redacted reports, track score trends, and compare findings over time.

## Phase 6: Optional GitHub App / CI Integration

Consider a GitHub App, CI checks, or PR annotations after the private dashboard is stable.
