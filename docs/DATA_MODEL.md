# Data Model

## RepoFile

Represents one repository file after manifest construction. It includes `path`, `name`, `extension`, `size`, optional redacted `content`, `classification`, `fileContext`, `redacted`, optional `secretMatches` (pattern names list), optional `secretMatchDetails` (structured match objects), `ignored`, and optional `reason`.

## FileClassification

One of `agent_config`, `workflow_config`, `prompt`, `tool`, `eval`, `workflow`, `ci`, `documentation`, `environment`, `package_config`, `source_code`, `test`, or `unknown`.

- `workflow_config`: AI/product workflow manifests (`workflow.yaml`, `workflows.yaml`, `pipeline.yaml`, etc.).
- `ci`: CI infrastructure files (`.github/workflows/*`, `.gitlab-ci.yml`, `.circleci/`). These are NOT AI/product workflows.
- `prompt`: only genuine prompt assets (`/prompts/`, `system-prompt*`, or files with explicit prompt language in content). Test files with "prompt" in the name are `test`, not `prompt`.

## FileContext

Describes the operational context of a file. Used to calibrate secret finding severity.

- `production`: files in `app/`, `src/`, `lib/`, `backend/`, `worker/`, `server/`, `services/`, `api/`.
- `test`: files in `tests/`, `__tests__/`, `test/`, `cypress/`, `playwright/`, or with `.test.*`/`.spec.*` extensions.
- `documentation`: markdown files and `docs/` directory contents.
- `ci`: CI infrastructure files (`.github/workflows/`, `.circleci/`, `.gitlab-ci.*`).
- `example`: files in `examples/`, `fixtures/`, `mocks/`, `stubs/`, `demo/`, `sample/`.
- `config`: build configs, tsconfig, agent/workflow manifests, `.env.example`.
- `migration`: files in `migrations/` or `.sql` schema/seed files.
- `unknown`: anything that does not match the above.

## ScanSource

Identifies where a scan came from:

- `type`: `"github"`, `"zip"`, or `"mock"`.
- `label`: display label such as `owner/repo`, `repo-main.zip`, or `Mock scan`.
- `owner` and `repo`: GitHub metadata when available.
- `filename`: uploaded ZIP filename when available.

## ZipScanStats

Attached to ZIP scan reports as `zipStats`. It includes `totalEntries`, `totalFiles`, `candidateFiles`, `scannedFiles`, `skippedByFileLimit`, and optional `strippedRootFolder`. These fields distinguish the hard ZIP entry safety limit from the prioritized scanned-file cap.

## SecretMatch

A structured record of one detected secret-like value:

- `kind`: pattern name (e.g. "GitHub token", "API key assignment").
- `confidence`: `"high"` | `"medium"` | `"low"`.
- `reason`: human-readable description of why this matched.
- `matchedPreview`: optional truncated preview (redacted values only, never raw secrets).

High confidence: matches a known key format (sk-ant-, ghp_, private key block, database URL with credentials).
Medium confidence: matches a named variable (API_KEY, SECRET, PASSWORD) with a long, high-entropy value.
Low confidence: generic word match without credential-looking value — not reported as a finding.

Placeholder values (`ci-stub`, `changeme`, `your-key-here`, etc.) always produce `info` severity regardless of confidence.

## DetectedAgent

Represents an agent detected from explicit config or inferred from evidence:

- `id`: slugified identifier.
- `name`: display name. Inferred low-confidence agents are named "Inferred agent candidate".
- `promptPaths`: prompt files mapped by the agent manifest (empty for inferred agents without manifest).
- `toolNames`: tool names mapped by the manifest (empty for inferred).
- `evalPaths`: eval paths mapped by the manifest (empty for inferred).
- `configPath`: source config file path (optional).
- `risks`: risk notes.
- `source`: `"explicit"` (from agents.yaml entry) or `"inferred"` (from prompts or directory structure).
- `confidence`: `"high"` (manifest entry), `"medium"` (agent dir files), `"low"` (prompt-only inference).
- `evidenceReason`: short description of evidence (optional).

Inferred agents do NOT automatically receive all repo-level prompts/tools/evals as attributed links.

## DetectedWorkflow

Represents an AI/product workflow (not a CI pipeline):

- `id`: slugified identifier.
- `name`: display name.
- `type`: `"deterministic_workflow"` | `"workflow_with_tools"` | `"hybrid_workflow_agent"` | `"unknown"`.
- `stages`, `tools`, `evals`: from the manifest (optional).
- `configPath`: source manifest path (optional).
- `risks`: risk notes (optional).
- `source`: `"explicit"` (from manifest) or `"inferred"` (from directory structure).
- `confidence`: `"high"` (manifest), `"medium"` (inferred from directory), `"low"` (weak inference).
- `evidenceReason`: short description of evidence (optional).

## DetectedCIWorkflow

Represents a CI pipeline file (not an AI/product workflow):

- `name`: workflow filename without extension.
- `path`: file path.
- `provider`: `"github_actions"` | `"gitlab"` | `"circleci"` | `"unknown"`.

CI workflows are stored in `detectedCIWorkflows` and are shown separately on the dashboard. They do NOT contribute to the `detectedWorkflowsDetailed` list and do NOT influence the `projectType` derivation.

## ProjectType

Describes the AI project type derived from agents and AI/product workflows only (CI workflows excluded):

- `agent_system`: only agents detected.
- `workflow_system`: only AI/product workflows detected.
- `hybrid_workflow_agent`: both agents and AI/product workflows detected.
- `unknown_ai_project`: neither detected.

## EvidenceSnippet

An optional short code excerpt attached to a finding:

- `path`: source file path.
- `excerpt`: a short redacted excerpt (max 240 chars).
- `redacted`: whether values have been redacted.

## Finding

Represents one audit issue or note with `id`, `category`, `severity`, `title`, `summary`, `evidencePaths`, `recommendation`, `confidence`, and optional `evidenceSnippets`.

## Scores

Category scores for architecture, prompt quality, tool governance, eval coverage, security, documentation, and overall. Security penalties are calibrated by file context (production vs. test/docs/example) at finding creation time.

## ScanReport

Complete audit output:

- Repository name, optional `scanSource`, optional ZIP stats, scan timestamp, file counts.
- `projectType`.
- `detectedAgents`: agents with source/confidence.
- `detectedWorkflowsDetailed`: AI/product workflows with source/confidence.
- `detectedCIWorkflows`: CI pipeline files (separate from product workflows).
- `detectedPrompts`: actual prompt asset paths.
- `detectedTools`, `detectedWorkflows` (paths).
- `detectedEvals`: explicit AI eval files only.
- `detectedTests`: software test files.
- `findings`, `scores`, `recommendations`.
- Optional `auditorStatus`.
