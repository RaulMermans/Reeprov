# Reeprov Governance Auditor

This document explains how Reeprov v2.0 classifies repositories, scores them, and what the new governance fields mean.

---

## Repository Modes

Reeprov now classifies every scanned repository into one of five **modes** before scoring. The mode determines which scoring dimensions apply and how strictly the scanner evaluates the repo.

| Mode | Meaning | Scored as |
|------|---------|-----------|
| `ai_application` | Deployed or deployable AI product with agent or workflow behavior | Full AI system scoring |
| `ai_framework_library` | SDK, framework, or library (e.g. LangChain, CrewAI, LlamaIndex) | General hygiene only |
| `example_template` | Dominated by samples, demos, tutorials, or template starter kits | General hygiene only |
| `non_ai` | No meaningful AI system detected | General hygiene only |
| `unknown_ai` | AI signals present but insufficient evidence to classify confidently | Limited AI scoring |

### Why modes matter

Without mode classification, a framework repo with dozens of sample agents and no production manifest would score 75–80 even though it's not a deployed AI system. Mode classification prevents this by:

- Setting `ai_system_health` to `null` for non-application repos
- Applying structural score caps appropriate to each mode
- Labeling the mode and confidence in the report

### Classification signals

**`ai_framework_library`** is detected from:
- `package.json` keywords including `library`, `sdk`, `framework`, `toolkit`
- `package.json` declaring `peerDependencies`
- Library entry-point pattern: has `main`/`exports` but no `start`/`dev` scripts
- Many files in example/sample directories (≥25% of files)
- No deployment configuration found

**`example_template`** is detected from:
- ≥50% of repository files in example/sample/demo/tutorial directories
- No explicit agent or workflow manifest

**`non_ai`** is detected when:
- No AI SDK imports (openai, @anthropic-ai, langchain, etc.)
- No AI API environment variable names (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)
- No AI function call patterns (generateText, createCompletion, etc.)
- No AI-related filenames

**`ai_application`** is detected from:
- Explicit agent manifest (`agents.yaml`) or workflow manifest (`workflow.yaml`)
- Deployment configuration (Vercel, Docker, Netlify, Railway, Render)
- Application directory structure (`/app/`, `/src/`, `/api/`, etc.)

**`unknown_ai`** is the fallback when AI signals are present but insufficient to classify confidently.

---

## Score Dimensions (v2)

Reeprov now reports **four score dimensions** alongside the legacy category scores.

| Dimension | Range | Description |
|-----------|-------|-------------|
| `aiSystemHealth` | 0–100 or `null` | Overall health of the AI system. `null` for non-AI repos. |
| `generalRepoHygiene` | 0–100 | Security, documentation, and basic structure — always computed. |
| `governanceCompleteness` | 0–100 or `null` | Tool policy, approval gates, and manifest completeness. |
| `graphMappingCompleteness` | 0–100 | How well agents, prompts, tools, and evals are linked. |
| `confidence` | high/medium/low | Scanner confidence in the classification and scoring. |
| `legacyOverallScore` | 0–100 | The original weighted overall score (preserved for backward compat). |

### AI System Health formula

```
aiSystemHealth = (
  architecture × 0.25 +
  promptQuality × 0.20 +
  toolGovernance × 0.15 +
  evalCoverage × 0.15 +
  security × 0.15 +
  graphCompleteness × 0.10
)
```

With hard gates (see below).

---

## Score Caps and Gates

Deterministic caps constrain scores when structural requirements are not met. Every cap is recorded in `scoreCapsApplied` so the report shows exactly why a score is limited.

### Gate table

| Condition | Dimension capped | Cap value |
|-----------|-----------------|-----------|
| No explicit agent or workflow manifest | `architecture` | 70 |
| No dedicated AI eval suite | `evalCoverage` | 60 |
| Write/destructive tools without approval policy | `toolGovernance` | 65 |
| Agent manifest exists but no model/provider mapping | `architecture` | 75 |
| All AI artifacts are in example/sample directories | `architecture` | 65 |
| No graph edges (no linked prompt/tool/eval) | `aiSystemHealth` | 74 |
| No dedicated AI eval suite | `aiSystemHealth` | 82 |
| No agent or workflow manifest | `aiSystemHealth` | 79 |
| Repository mode is non-AI, framework, or example | `architecture`, `evalCoverage`, `toolGovernance` | 60 |

Caps do not replace finding-based penalties — they supplement them. A repo with many high-severity findings AND missing manifest will be constrained by both.

---

## Graph Mapping Completeness

Graph completeness measures linked relationships between artifacts, not raw artifact counts.

**Formula:**
```
graphCompleteness = (
  (mappedAgents / totalManifestAgents) × 0.35 +
  (mappedPrompts / totalPrompts) × 0.25 +
  (mappedTools / totalTools) × 0.20 +
  (mappedEvals / totalEvals) × 0.20
) × 100
```

- "Mapped" = the agent manifest explicitly names the path/name
- Total counts from the `agents.yaml` manifest only (inferred agents don't count)
- If no items exist in a category, that category has no penalty (ratio = 1)

### Example

A repo with:
- 2 manifest agents, 1 mapped (50%)
- 3 prompt files, 1 referenced by manifest (33%)
- 4 tool names, 4 referenced (100%)
- 2 eval files, 0 referenced (0%)

Graph completeness = (0.50 × 0.35) + (0.33 × 0.25) + (1.0 × 0.20) + (0 × 0.20) = 0.46 = **46/100**

---

## Manifest Schema

### agents.yaml

```yaml
agents:
  - id: my_agent                      # unique identifier (slug)
    name: My Agent                    # human-readable name
    description: "..."               # what this agent does
    prompt_path: prompts/my-agent.md # path to system prompt
    tools:
      - search_web                    # tool names or paths
      - send_email
    evals:
      - evals/my-agent.yaml          # eval file paths
    model:
      provider: anthropic            # anthropic | openai | google | etc.
      name: claude-3-5-sonnet        # model name/version
    permissions:
      - read:database
      - write:drafts
    approval_policy: require_human_approval_for_writes
    safety_boundaries:
      - never_send_pii
      - never_delete_records
```

### workflow.yaml

```yaml
workflows:
  - id: my_workflow
    name: My Workflow
    type: deterministic_workflow     # or workflow_with_tools, hybrid_workflow_agent
    stages:
      - id: intake
        name: Data Intake
        agent: intake_agent
        prompt: prompts/intake.md
        tools:
          - fetch_data
        model:
          provider: anthropic
          name: claude-haiku-4-5
        evals:
          - evals/intake.yaml
        retry_policy: 3_attempts
        approval_gate: none
      - id: analyze
        name: Analysis
        agent: analysis_agent
        tools:
          - analyze_data
        approval_gate: require_human   # gates before destructive actions
```

### Permission classes

| Class | Meaning |
|-------|---------|
| `read_only` | Can only read data |
| `write_draft` | Can write drafts/staging, not publish |
| `external_side_effect` | Calls external APIs (webhooks, emails) |
| `destructive` | Can delete or overwrite records |
| `sensitive_data` | Handles PII or credentials |

---

## Eval Performance Result Schema

Reeprov detects and parses eval result files automatically.

**Detected file names/paths:**
- `eval-results.json`, `eval-results.jsonl`
- `benchmark-results.json`, `benchmarks.json`
- `model-comparison.json`, `performance-results.json`
- `runs/*.json`, `evals/results/*.json`, `evaluations/results/*.jsonl`

**Expected record format:**
```json
{
  "agent": "my_agent",
  "workflow": "my_workflow",
  "model": "claude-3-5-sonnet",
  "provider": "anthropic",
  "score": 0.92,
  "latency_ms": 1800,
  "tokens_input": 3200,
  "tokens_output": 650,
  "cost_usd": 0.008,
  "pass": true
}
```

All fields are optional. JSONL format (one record per line) is also supported.

---

## Artifact Context

Every detected AI artifact is classified by its operational context:

| Context | Meaning | Score impact |
|---------|---------|-------------|
| `production` | Live product code in `/src/`, `/app/`, `/api/` | Full severity |
| `example` | Sample/demo code in `/examples/`, `/demos/` | Reduced severity |
| `test` | Test code in `/tests/`, `*.test.ts` | Reduced severity |
| `documentation` | Markdown, `/docs/` | Reduced severity |
| `ci` | GitHub Actions, GitLab CI, CircleCI | Moderate severity |
| `asset` | SVG, images, CSS — never counted as agents | No AI classification |
| `unknown` | Cannot determine context | Default treatment |

SVG files and other binary assets inside `/agents/` directories are never classified as agent configs, even if their name suggests an agent.

---

## What Reeprov Cannot Determine (Static Mode)

Reeprov is a **static scanner** — it reads files but never executes code. This means:

- It cannot determine runtime behavior (what tools are actually called)
- It cannot verify that approval policies are actually enforced in code
- It cannot measure actual latency or cost (only from eval result files if present)
- It cannot assess prompt quality beyond structure (LLM auditor is separate and disabled by default)
- It cannot detect dynamically assembled prompts (only file-based prompts)
- It cannot fully verify that a listed tool name actually maps to the correct implementation

Scanner findings are **evidence-based estimates** — the confidence field on each finding reflects how certain the static analysis is.

---

## A Well-Mapped AI System

The highest governance scores come from repos that:

1. Have `agents.yaml` or `workflow.yaml` with explicit entries
2. Map each agent to specific prompt paths, tool names, and eval paths
3. Classify tools by permission class and set `approval_policy` for write/destructive tools
4. Have a dedicated `/evals/` directory with eval manifest files
5. Have `eval-results.json` or JSONL files with pass/fail scores
6. Have `AGENTS.md` explaining agent responsibilities and constraints
7. Keep AI API keys out of committed files (use env variables)
8. Use `model:` fields in agent entries to declare provider and model name

A repo meeting all of these will receive:
- `mode: ai_application` with high confidence
- `aiSystemHealth: ≥90`
- `graphMappingCompleteness: ≥85`
- No score caps applied
- Minimal findings

---

## Framework and Example Repos

Reeprov does not penalize framework repos (CrewAI, LangChain, etc.) for not having app-level manifests. If a repo is classified as `ai_framework_library` or `example_template`:

- `ai_system_health` is `null` — not applicable
- `governanceCompleteness` is `null` — not applicable
- Scoring focuses on general hygiene: secret safety, documentation quality, and example clarity
- Score caps at 60 for architecture/eval/tool dimensions reflect that these are not production app metrics

This prevents a framework repo with 200 sample agents from getting misleading high governance scores.
