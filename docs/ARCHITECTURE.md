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
- Files in `/prompts/` directory
- Files named `system-prompt*` or `system-persona.md`
- Files matching `*.prompt.{md,ts,txt,js}`
- Python prompt modules: `prompts.py` or `*_prompts.py` that contain uppercase `_PROMPT` constants (e.g., `RESEARCH_PLAN_PROMPT = "..."`)
- Files with explicit prompt language in content that are not in source/test/assistant-tooling directories

Not classified as prompt assets:
- Test files with "prompt" in the filename (e.g., `prompt-input.test.ts`) → classified as `test`
- LLM client/provider files (`llm/client.py`, `providers/openai.ts`) → classified as `source_code` and detected as LLM infrastructure
- Files under assistant tooling paths (`.claude/**`, `.cursor/**`) → classified by their own rules and reported as assistant tooling

### Assistant Tooling vs Product Scope

AgentPulse distinguishes **product AI system artifacts** from **developer-assistant tooling**:

**Assistant tooling paths** (excluded from product counts):
- `.claude/**` — Claude Code skills, hooks, settings
- `.cursor/**` — Cursor AI rules and configurations
- `.vscode/**` — VS Code editor settings
- `.windsurf/**` — Windsurf AI configurations
- `.github/copilot/**` — GitHub Copilot customizations

Files under these paths are reported in `detectedAssistantTooling` with a kind label (`claude_skill`, `cursor_rule`, `vscode_config`, `assistant_agent`, `assistant_prompt`, `other`). They do **not** contribute to `detectedAgents`, `detectedPrompts`, or project type determination.

**Product AI agent detection** (Python module patterns):
- `**/agents/*_agent.py` → e.g., `editor_agent.py` → `Editor Agent`
- `**/agents/*_evaluator.py` → e.g., `fact_check_evaluator.py` → `Fact Check Evaluator`
- `**/agents/*_judge.py`, `*_critic.py`, `*_planner.py`, `*_router.py`, `*_researcher.py`, `*_writer.py`, `*_editor.py`

These are detected as `agent_file` with `medium` confidence and title-case formatted names. Prompt/tool/eval links remain "Not mapped" unless a manifest explicitly links them.

**LLM infrastructure** (separate from prompt assets):
- Files in `/llm/` directories (e.g., `llm/client.py`)
- Provider files (e.g., `providers/openai.ts`) containing AI provider names
- Files named `modelProvider.ts`, `aiClient.py`, etc.

Reported in `detectedLLMInfrastructure`, not counted as prompts.

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

### Maintainability Auditor

`lib/auditors/maintainabilityAuditor.ts` is a fully deterministic auditor (no LLM calls) that measures how easy and safe the AI system is to evolve. It runs as part of the `runAuditors` pipeline.

Checks performed:
- **A. Large files** — source files (not tests/docs/lockfiles) flagged at 500+ (medium) and 800+ (high) lines
- **B. Scanner/router concentration** — large files in scanner/, reports/, routing/ paths with many exports
- **C. TODO/FIXME markers** — deferred-work markers across source files
- **D. Schema version** — checks for `reportVersion` field in type/schema files
- **E. Dashboard complexity** — UI components over 300 lines in components/, dashboard/ directories
- **F. Duplicate recommendation wording** — repeated recommendation phrases across auditor/report files
- **G. Golden fixtures** — tests present but no golden report fixtures detected
- **H. Documentation drift** — docs missing references to major project-type concepts

The maintainability auditor returns a `maintainabilityScore` (0–100, floor 20) and `MaintainabilityMetrics` that are attached to the `ScanReport`. The score is factored into the overall score at 10% weight.

## Scoring

Scores cover architecture, prompt quality, tool governance, eval coverage, security, and documentation. Overall score is weighted from those categories.

Security scoring uses confidence-aware penalties. Because secret severity is calibrated at finding creation time by file context, docs/test/example secrets no longer drive the security score to 0. Only production secrets with high confidence produce large penalties.

## Dashboard

The dashboard shows:
- Scan source, overall score, status, project type label
- Detected counts: agents, prompts, tools, AI evals, software tests, CI workflows, assistant tooling
- Score cards with explanations
- Agent cards with explicit/inferred/low-confidence badges and "Not mapped" for unlinked attributes
- AI/product workflow cards with explicit/inferred badges
- CI workflows section (separate from AI workflows)
- Assistant tooling section (separate from product agents)
- Findings with filters, confidence, and expandable evidence snippets
- Export controls (JSON and Markdown)
- De-duplicated recommended next actions
