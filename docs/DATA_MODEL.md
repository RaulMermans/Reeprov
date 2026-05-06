# Data Model

## RepoFile

Represents one repository file after manifest construction. It includes `path`, `name`, `extension`, `size`, optional redacted `content`, `classification`, `redacted`, `ignored`, and optional `reason`.

## FileClassification

One of `agent_config`, `prompt`, `tool`, `eval`, `workflow`, `documentation`, `environment`, `package_config`, `source_code`, `test`, or `unknown`.

## DetectedAgent

Represents an inferred or configured agent with `id`, `name`, `promptPaths`, `toolNames`, `evalPaths`, optional `configPath`, and `risks`.

## Finding

Represents one audit issue or note with `id`, `category`, `severity`, `title`, `summary`, `evidencePaths`, `recommendation`, and `confidence`.

## Scores

Represents category scores for architecture, prompt quality, tool governance, eval coverage, security, documentation, and overall health.

## ScanReport

Represents the complete audit output: repository name, scan timestamp, scanned and ignored file counts, detections, findings, scores, and recommendations.
