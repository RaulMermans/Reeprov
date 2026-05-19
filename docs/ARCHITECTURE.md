# Architecture

AgentPulse has five layers: dashboard, API routes, ingestion, static scanner, and auditor layer.

## Workflow

1. The dashboard requests a scan for `owner/repo` or uploads a GitHub ZIP.
2. `/api/scan` reads `GITHUB_TOKEN` server-side, while `/api/scan-zip` accepts multipart ZIP input.
3. GitHub ingestion loads selected text blobs, or ZIP ingestion parses entries in memory.
4. Both ingestion paths normalize files into the same `RepoFile[]` pipeline.
5. Ignore rules remove dependency folders, generated outputs, binaries, private keys, and environment files.
6. The static scanner classifies files, derives file context, and redacts secret-like values.
7. Placeholder auditors review the static report and add structured findings.
8. Scores are calculated and returned to the dashboard.

## Repo Ingestion

The GitHub layer uses Octokit. It fetches repository tree metadata first, applies ignore rules, then fetches text blob content for eligible files.

ZIP ingestion accepts `.zip` uploads through `/api/scan-zip`, validates size limits, rejects unsafe paths, strips the common GitHub top-level folder, ignores binaries and scanner-ignored files, and returns normalized file entries without writing the archive to permanent storage.

Both paths converge through `runScanPipeline`: `files -> prepareRepoFiles -> staticScanFromFiles -> runAuditors -> ScanReport`.

## File Classification and Context

Every file receives two independent labels after ingestion:

**FileClassification** — structural type of the file:
- `agent_config`, `workflow_config`, `prompt`, `tool`, `eval`, `workflow`, `ci`, `documentation`, `environment`, `package_config`, `source_code`, `test`, `unknown`
- `.github/workflows/*`, `.gitlab-ci.yml`, and `.circleci/` files are classified as `ci`, not `workflow`.

**FileContext** — operational context, used to calibrate secret severity:
- `production`, `test`, `documentation`, `ci`, `example`, `config`, `migration`, `unknown`
- Derived from path patterns (e.g., `src/` → production, `tests/` → test, `docs/` → documentation).

## Static Scan

The scanner classifies files by path, extension, filename, and light content heuristics. It detects likely agents, prompts, tools, evals, workflows, docs, and common risks.

### Agent Detection

Agent configs (`agents.yaml`, `agents.yml`, `agents.json`, `agent.yaml`, etc.) are parsed to extract individual agents. Each `DetectedAgent` now includes:
- `source`: `explicit` (from agents.yaml) or `inferred` (from prompts without a config).
- `confidence`: `high` (manifest entry), `medium` (agent dir files), `low` (prompt-only inference).
- `evidenceReason`: short description of why the agent was detected.

Inferred agents (no manifest) do not have repo-level prompts, tools, or evals auto-attributed to them. The dashboard shows "Not mapped" for those links.

### Workflow Detection

**AI/product workflows**: `workflow.yaml`, `workflows.yaml`, `workflow.json`, `workflows.json`, `pipeline.yaml` are classified as `workflow_config` and parsed into `DetectedWorkflow` records. A `/workflows/` directory outside `.github/` without a manifest produces an inferred workflow record.

**CI workflows**: `.github/workflows/*`, `.gitlab-ci.yml`, `.circleci/` are classified as `ci` and reported separately in `detectedCIWorkflows`. CI workflows do NOT contribute to `detectedWorkflowsDetailed` and do NOT set the project type to `workflow_system`.

Project type is derived from agents, AI/product workflows, and AI signals:
- `agent_system`: explicit or file-based agents detected.
- `workflow_system`: AI/product workflow manifest detected, no agents.
- `hybrid_workflow_agent`: both agents and product workflows detected.
- `ai_application`: AI-related code detected (model imports, AI env vars, AI function patterns) but no explicit agent or workflow manifest found.
- `unknown_ai_project`: no AI signals detected.

`ai_application` is set when the scanner finds AI SDK imports (`openai`, `@anthropic-ai`, `langchain`, etc.), AI API env variable names, or AI function call patterns without an explicit manifest. This covers repos with model-powered features that haven't been structured as agent or workflow systems.

### Eval vs Test Detection

- **detectedEvals**: files in `/evals/`, `/evaluations/`, `/evaluators/`, promptfoo configs, and YAML/JSON eval manifests. These are dedicated AI evaluation assets.
- **detectedTests**: files in `/tests/`, `/__tests__/`, `*.test.*`, `*.spec.*`. These are standard software tests.

Generic test files are never counted as AI evals. If tests exist but no explicit evals, the finding reads "No dedicated AI eval suite detected" at medium severity. If neither exists, it reads "No tests or evals detected" at high severity.

### Prompt Detection

Only genuine prompt assets are classified as `prompt`:
- Files in `/prompts/`
- Files named `system-prompt*` or `system-persona.md`
- Files with explicit prompt language in content (`you are an ai`, `system prompt`, etc.) that are not in source/test directories

Test files with "prompt" in the filename (e.g., `prompt-input.test.ts`) are classified as `test`, not `prompt`.

## Redaction and Secret Calibration

Secret redaction runs before report output and before any future LLM auditor input. Matches are classified into high, medium, or low confidence. Only high- and medium-confidence matches are redacted and reported as findings.

### Severity Calibration by File Context

Secret finding severity is calibrated by file context at report generation time:

| Confidence | Production/Config | Test/Docs/Example | CI | Placeholder |
|---|---|---|---|---|
| High | high / 0.95 | medium / 0.6 | medium / 0.65 | info / 0.25 |
| Medium | medium / 0.75 | low / 0.45 | low / 0.65 | info / 0.25 |

Placeholder values (stub, changeme, ci-stub, your-key-here, etc.) are always `info` severity regardless of context.

Credential-free or localhost database URLs (e.g., `postgres://localhost/db`) are always `info` severity.

Recommendations reflect the context:
- Production: "Remove this value from the repository and rotate it if it was real."
- Test/docs: "Review this test/example value. If it is real, move it to environment variables and rotate it."
- Placeholder: "Placeholder/stub value detected; no rotation required unless this represents a real credential."

## Auditor Layer

Auditors are typed interfaces that accept a `ScanReport` and return structured findings. Current auditors are placeholders; future versions can call LLMs with redacted evidence only.

The architecture auditor does not flag missing agent boundaries for workflow-only projects.

## Scoring

Scores cover architecture, prompt quality, tool governance, eval coverage, security, and documentation. Overall score is weighted from those categories.

Security scoring uses confidence-aware penalties. Because secret severity is calibrated at finding creation time by file context, docs/test/example secrets no longer drive the security score to 0. Only production secrets with high confidence produce large penalties.

## AI System Graph

AgentPulse reconstructs a typed AI system graph after detection.

Nodes: `agent`, `workflow`, `workflow_step`, `prompt`, `tool`, `model`, `provider`, `eval`, `data_source`, `approval_gate`, `artifact`, `external_side_effect`, `assistant_tooling`, `unknown`.

Edges: `uses_prompt`, `calls_tool`, `uses_model`, `provided_by`, `evaluated_by`, `contains_step`, `depends_on`, `produces`, `reads_from`, `writes_to`, `requires_approval`, `has_permission`, `related_to`, `inferred_from`.

Confidence rules:
- Manifest entries: high confidence.
- File-path matches: medium confidence.
- Prompt-only inference: low confidence.

Detected ≠ mapped. A detected prompt becomes a prompt node, but only an explicit `agents.yaml` entry or workflow stage produces a `uses_prompt` edge to an agent or step. The same applies to tools, evals, and models.

Graph warnings cover: `agent_missing_prompt`, `agent_missing_tools`, `agent_missing_evals`, `agent_missing_model`, `workflow_missing_steps`, `tool_missing_permission`, `eval_not_mapped`, `prompt_not_mapped`, `model_not_mapped`, `performance_data_missing`, `assistant_tooling_not_product`.

## Model / Provider Detection

Deterministic model detection runs after agent/workflow detection.

Sources:
- **Manifest** (high confidence): `model: { provider, name }` in agents.yaml or workflow stages.
- **Code** (medium): explicit model strings like `gpt-4o`, `claude-3-5-sonnet`, `gemini-2.5-flash`, `mixtral-8x7b`, etc.
- **Env** (low): provider env var names in `.env.example` (e.g. `OPENAI_API_KEY`). No model name is inferred.
- **Import** (low): provider SDK imports (`openai`, `@anthropic-ai/sdk`, `@google/genai`, `groq-sdk`, etc.) with no model name.

Secret values are never exposed in `detectedModels` — only provider names and env-var names.

## Performance Data (optional)

If the repository ships eval/run metrics in well-known files (`eval-results.json`, `runs.json`, `metrics.json`, `traces.json`, `model-comparison.json`, `reports/evals/*.json`, `evals/results/*.json`), AgentPulse parses them into `modelPerformance` entries with `provider`, `model`, `eval_id`, `score`, `latency_ms`, `input_tokens`, `output_tokens`, and `cost_usd`.

AgentPulse does not claim one model is better than another unless these metrics exist in the scanned repository.

## Dashboard

The dashboard shows:
- Scan source, overall score, status, project type label
- Detected counts: agents, prompts, tools, AI evals, software tests, CI workflows
- Score cards with explanations
- AI System Graph view (columns: workflows/steps, agents, prompts/tools/models, evals/artifacts/gates) with mapping summary
- Model / Provider Matrix: provider, model, source, confidence, eval coverage, performance availability
- Mapping Gaps panel with agent_missing_prompt/tool/eval/model warnings
- Agent cards with explicit/inferred/low-confidence badges, mapped prompts/tools/evals, model/provider, owner, and permissions
- AI/product workflow cards with explicit/inferred badges
- CI workflows section (separate from AI workflows)
- Findings with filters, confidence, and expandable evidence snippets
- Export controls (JSON and Markdown)
- De-duplicated recommended next actions

## Recommended Manifest Fields

For best results, agents.yaml should map each agent's `prompts`, `tools`, `evals`, and `model: { provider, name }`. For example:

```yaml
agents:
  - id: editor_agent
    name: Editor Agent
    source: blogagent/agents/editor_agent.py
    prompts:
      - blogagent/agents/prompts.py#DRAFT_PROMPT
    tools:
      - web_search
      - citation_lookup
    evals:
      - blogagent/evals/editor_quality.yaml
    model:
      provider: google
      name: gemini-2.5-flash
      temperature: 0.3
```

For workflows, stages should declare `agent`, `prompt`, `tools`, `model`, `evals`, and any `approval_gate`:

```yaml
workflow:
  id: blog_generation
  stages:
    - id: draft
      agent: editor_agent
      prompt: blogagent/agents/prompts.py#DRAFT_PROMPT
      model:
        provider: google
        name: gemini-2.5-flash
      evals:
        - blogagent/evals/editor_quality.yaml
```
