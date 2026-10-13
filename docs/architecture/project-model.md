# Architecture: Multi-Project Workspace Model

AgentPulse manages multiple agent projects within a unified local workspace, implemented in `lib/projects/projectStore.ts`.

## Project Entities

Each project record comprises:

- `id`: Unique slug identifying the project (e.g., `customer-support-agent`).
- `name`: Human-readable project display name.
- `description`: Optional project description.
- `language`: Primary implementation language (`python`, `typescript`, `other`).
- `framework`: Agent framework used (`langchain`, `llamaindex`, `autogen`, `crewai`, `custom`).
- `createdAt` / `updatedAt`: ISO-8601 timestamps.
- `defaultWorkflowId`: Optional default workflow identifier.
- `repositoryUrl`: Optional link to source code repository.

## Project Management Operations

1. **Project Listing & Creation**: Handled via `GET /api/projects` and `POST /api/projects`.
2. **Project Detail & Mutation**: Handled via `GET`, `PATCH`, and `DELETE` on `/api/projects/[projectId]`.
3. **Delete Preview**: `GET /api/projects/[projectId]/delete-preview` computes dependent run, comparison, and eval counts before destructive deletion.
4. **Sanitized Export**: `GET /api/projects/[projectId]/export` bundles runs and configurations into a portable JSON package with credentials stripped.
