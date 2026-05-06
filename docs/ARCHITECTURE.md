# Architecture

AgentPulse has five layers: dashboard, API routes, GitHub ingestion, static scanner, and auditor layer.

## Workflow

1. The dashboard requests a scan for `owner/repo`.
2. `/api/scan` reads `GITHUB_TOKEN` server-side.
3. GitHub ingestion loads the default branch tree and selected text blobs.
4. Ignore rules remove dependency folders, generated outputs, binaries, private keys, and environment files.
5. The static scanner classifies files and redacts secret-like values.
6. Placeholder auditors review the static report and add structured findings.
7. Scores are calculated and returned to the dashboard.

## Repo Ingestion

The GitHub layer uses Octokit. It fetches repository tree metadata first, applies ignore rules, then fetches text blob content for eligible files.

## Static Scan

The scanner classifies files by path, extension, filename, and light content heuristics. It detects likely agents, prompts, tools, evals, workflows, docs, and common risks.

## Redaction

Secret redaction runs before report output and before any future LLM auditor input. Redacted files are flagged as security findings.

## Auditor Layer

Auditors are typed interfaces that accept a `ScanReport` and return structured findings. Current auditors are placeholders; future versions can call LLMs with redacted evidence only.

## Scoring

Scores cover architecture, prompt quality, tool governance, eval coverage, security, and documentation. Overall score is weighted from those categories.

## Dashboard

The dashboard shows overall score, status, counts, score cards, agent cards, findings, and recommended next actions.
