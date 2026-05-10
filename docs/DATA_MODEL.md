# Data Model

## RepoFile

Represents one repository file after manifest construction. It includes `path`, `name`, `extension`, `size`, optional redacted `content`, `classification`, `redacted`, optional `secretMatches` (pattern names list), optional `secretMatchDetails` (structured match objects), `ignored`, and optional `reason`.

## FileClassification

One of `agent_config`, `workflow_config`, `prompt`, `tool`, `eval`, `workflow`, `documentation`, `environment`, `package_config`, `source_code`, `test`, or `unknown`.

The `workflow_config` classification covers structured workflow manifests such as `workflow.yaml`, `workflows.yaml`, `workflow.json`, `pipeline.yaml`, and similar files. These are analogous to `agents.yaml` for workflow projects.

## SecretMatch

A structured record of one detected secret-like value. It includes:

- `kind`: pattern name (e.g. "GitHub token", "API key assignment").
- `confidence`: `"high"` | `"medium"` | `"low"`.
- `reason`: human-readable description of why this matched.
- `matchedPreview`: optional truncated preview (redacted values only, never raw secrets).

High confidence: matches a known key format (sk-ant-, ghp_, private key block, database URL).
Medium confidence: matches a named variable (API_KEY, SECRET, PASSWORD) with a long, high-entropy value.
Low confidence: generic word match without credential-looking value — not reported as a finding.

## DetectedAgent

Represents an inferred or configured agent with `id`, `name`, `promptPaths`, `toolNames`, `evalPaths`, optional `configPath`, and `risks`.

## DetectedWorkflow

Represents a detected workflow manifest or inferred workflow with:

- `id`: slugified identifier.
- `name`: display name.
- `type`: `"deterministic_workflow"` | `"workflow_with_tools"` | `"hybrid_workflow_agent"` | `"unknown"`.
- `stages`: ordered stage name list (optional).
- `tools`: tool names referenced by the workflow (optional).
- `evals`: eval paths or identifiers (optional).
- `configPath`: source file path (optional).
- `risks`: risk notes (optional).

## ProjectType

Describes the AI project type derived from detected agents and workflows:

- `agent_system`: only agents detected.
- `workflow_system`: only workflows detected.
- `hybrid_workflow_agent`: both agents and workflows detected.
- `unknown_ai_project`: neither agents nor workflows detected.

## EvidenceSnippet

An optional short code excerpt attached to a finding. It includes:

- `path`: source file path.
- `excerpt`: a short redacted excerpt (max 240 chars).
- `redacted`: whether values have been redacted.

Evidence snippets are never shown for raw secrets. Excerpts come from the already-redacted file content only.

## Finding

Represents one audit issue or note with `id`, `category`, `severity`, `title`, `summary`, `evidencePaths`, `recommendation`, `confidence`, and optional `evidenceSnippets`.

## Scores

Represents category scores for architecture, prompt quality, tool governance, eval coverage, security, documentation, and overall health. Security scores use confidence-aware penalties: high-confidence secret findings apply a larger penalty than medium- or low-confidence matches.

## ScanReport

Represents the complete audit output: repository name, scan timestamp, scanned and ignored file counts, `projectType`, `detectedAgents`, `detectedWorkflowsDetailed`, detected prompts/tools/evals/workflow paths, findings, scores, recommendations, and optional auditor status.
