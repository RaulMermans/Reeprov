# Product Spec

## User

The user is the owner of private GitHub repositories that contain AI agents, prompts, tools, evals, and workflows.

## Problem

AI-agent and AI-workflow repositories become hard to trust when prompts are implicit, tools are risky, evals are missing, secrets leak into files, or documentation falls behind implementation.

## Core Use Case

The user opens a private dashboard, selects or enters a GitHub repository or uploads a GitHub ZIP archive, runs a scan, and receives a health report with evidence-backed findings and recommended fixes.

## Supported Project Types

AgentPulse supports both agent-based and workflow-based AI project layouts:

- **Agent systems**: organized around explicit agent configs (`agents.yaml`, `agents.json`), prompt files, tools, and evals.
- **Workflow systems**: organized around workflow manifests (`workflow.yaml`, `workflows.yaml`, `workflow.json`, `pipeline.yaml`) with defined stages, tools, and safety properties.
- **Hybrid systems**: use both agent configs and workflow manifests.
- **Unknown AI projects**: AI activity detected but no formal inventory.

Workflow projects are first-class. A missing `agents.yaml` is not flagged as a problem for workflow-only repositories.

## Main Screens

- Dashboard: GitHub/ZIP scan mode selector, repository selector, ZIP upload control, health score, project type label, detected asset counts, score cards, agent cards, workflow cards, findings table, report export, and recommendations.
- Future scan detail: evidence drilldowns and score explanations.
- Future history: previous scans and trend comparison.

## Non-Goals

- Public SaaS.
- Multi-user accounts.
- Authentication.
- Database persistence.
- Executing repository code.
- Installing scanned repository dependencies.
- GitHub App integration.
- PR comments.
- Real LLM calls in the scaffold.
- Persisting uploaded ZIPs.

## Success Criteria

- Scanner runs in mock mode without secrets.
- Server routes keep GitHub token private.
- Static scanner redacts secrets and ignores unsafe paths.
- Secret redaction uses confidence levels; low-confidence matches do not crash the security score.
- Workflow projects are detected and shown; missing agent config is not flagged for them.
- Report schema is typed and validated.
- Dashboard communicates health, project type, findings with evidence snippets, and de-duplicated next actions.
- ZIP scans reuse the same static scanner, redaction, workflow detection, scoring, and report pipeline as GitHub scans.
- Direct ZIP uploads are honest about Vercel limits: compressed uploads are capped at 4 MB, larger repositories are directed to GitHub repository scanning, and uploaded archives are never persisted.
- ZIP entries are treated as untrusted input: path traversal is blocked, uploaded code is never executed, and uploaded dependencies are never installed.

## Future Larger-ZIP Options

1. Client-side ZIP extraction.
2. Vercel Blob client upload with temporary scan/delete.
3. Local CLI scanner.
