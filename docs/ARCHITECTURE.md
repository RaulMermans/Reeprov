# Architecture

AgentPulse has five layers: dashboard, API routes, ingestion, static scanner, and auditor layer.

## Workflow

1. The dashboard requests a scan for `owner/repo` or uploads a GitHub ZIP.
2. `/api/scan` reads `GITHUB_TOKEN` server-side, while `/api/scan-zip` accepts multipart ZIP input.
3. GitHub ingestion loads selected text blobs, or ZIP ingestion parses entries in memory.
4. Both ingestion paths normalize files into the same `RepoFile[]` pipeline.
5. Ignore rules remove dependency folders, generated outputs, binaries, private keys, and environment files.
6. The static scanner classifies files and redacts secret-like values.
7. Placeholder auditors review the static report and add structured findings.
8. Scores are calculated and returned to the dashboard.

## Repo Ingestion

The GitHub layer uses Octokit. It fetches repository tree metadata first, applies ignore rules, then fetches text blob content for eligible files.

ZIP ingestion accepts `.zip` uploads through `/api/scan-zip`, validates size limits, rejects unsafe paths, strips the common GitHub top-level folder, ignores binaries and scanner-ignored files, and returns normalized file entries without writing the archive to permanent storage.

Both paths converge through `runScanPipeline`: `files -> prepareRepoFiles -> staticScanFromFiles -> runAuditors -> ScanReport`.

## Static Scan

The scanner classifies files by path, extension, filename, and light content heuristics. It detects likely agents, prompts, tools, evals, workflows, docs, and common risks.

### Agent Detection

Agent configs (`agents.yaml`, `agents.yml`, `agents.json`, `agent.yaml`, etc.) are parsed to extract individual agents with ids, names, prompt paths, tool names, and eval paths.

### Workflow Detection

Workflow manifests (`workflow.yaml`, `workflows.yaml`, `workflow.json`, `workflows.json`, `pipeline.yaml`) are classified as `workflow_config` and parsed to extract `DetectedWorkflow` records with stages, tools, evals, and type. A `/workflows/` directory without a manifest produces an inferred workflow record.

Project type is derived from the combination of detected agents and workflows: `agent_system`, `workflow_system`, `hybrid_workflow_agent`, or `unknown_ai_project`.

## Redaction

Secret redaction runs before report output and before any future LLM auditor input. Matches are classified into high, medium, or low confidence. Only high- and medium-confidence matches are redacted and reported as findings. Low-confidence matches (generic token words, loop variables, short placeholder values) are discarded.

Security findings include the confidence level, which drives scoring: high-confidence secrets apply a large penalty; medium-confidence applies a moderate penalty; low-confidence observations apply no penalty.

## Auditor Layer

Auditors are typed interfaces that accept a `ScanReport` and return structured findings. Current auditors are placeholders; future versions can call LLMs with redacted evidence only.

The architecture auditor does not flag missing agent boundaries for workflow-only projects.

## Scoring

Scores cover architecture, prompt quality, tool governance, eval coverage, security, and documentation. Overall score is weighted from those categories. Security scoring uses confidence-aware penalties for secret findings.

## Dashboard

The dashboard shows scan source, overall score, status, project type label, counts, score cards with explanations, agent cards, workflow cards, findings with filters and expandable evidence snippets, export controls, and de-duplicated recommended next actions.
