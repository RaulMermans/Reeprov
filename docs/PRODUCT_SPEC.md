# Product Spec

## User

The user is the owner of private GitHub repositories that contain AI agents, prompts, tools, evals, and workflows.

## Problem

AI-agent repositories become hard to trust when prompts are implicit, tools are risky, evals are missing, secrets leak into files, or documentation falls behind implementation.

## Core Use Case

The user opens a private dashboard, selects or enters a GitHub repository, runs a scan, and receives a health report with evidence-backed findings and recommended fixes.

## Main Screens

- Dashboard: repository selector, health score, detected asset counts, score cards, agent cards, findings table, and recommendations.
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

## Success Criteria

- Scanner runs in mock mode without secrets.
- Server routes keep GitHub token private.
- Static scanner redacts secrets and ignores unsafe paths.
- Report schema is typed and validated.
- Dashboard communicates health, findings, evidence, and next actions.
