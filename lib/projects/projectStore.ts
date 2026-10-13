/**
 * Canonical Project Store for AgentPulse.
 *
 * Implements full project CRUD, statistics calculation, and ingest key management
 * while maintaining 100% storage compatibility with existing integration records.
 */

import { getIntegrationStore, getRunStore } from "@/lib/db/getStores";
import type { ProjectIntegration } from "@/lib/integrations/integrationTypes";
import type {
  CreateProjectInput,
  Project,
  ProjectStats,
  UpdateProjectInput,
} from "./projectTypes";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";
}

function mapIntegrationToProject(
  integration: ProjectIntegration,
  extraStats?: Partial<ProjectStats>
): Project {
  return {
    id: integration.projectId,
    name: integration.projectName,
    description: integration.description,
    language: integration.language,
    framework: integration.framework,
    defaultWorkflowId: integration.defaultWorkflowId,
    repositoryUrl: integration.repositoryUrl,
    status: integration.status,
    ingestKeyPreview: integration.ingestKeyPreview,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
    stats: {
      totalRuns: extraStats?.totalRuns ?? integration.runCount ?? 0,
      lastRunId: extraStats?.lastRunId ?? integration.lastRunId,
      lastRunAt: extraStats?.lastRunAt ?? integration.lastEventAt,
      lastRunStatus: extraStats?.lastRunStatus ?? integration.lastRunStatus,
      evalSuitesCount: extraStats?.evalSuitesCount ?? 0,
      baselinesCount: extraStats?.baselinesCount ?? 0,
    },
    integrationId: integration.integrationId,
  };
}

export class ProjectStore {
  /**
   * Lists all projects with their runtime stats.
   */
  static async listProjects(): Promise<Project[]> {
    const integrationStore = getIntegrationStore();
    const runStore = getRunStore();

    const integrations = await integrationStore.listIntegrations();

    const projects: Project[] = [];
    for (const integ of integrations) {
      let runCount = integ.runCount ?? 0;
      let lastRunId = integ.lastRunId;
      let lastRunStatus = integ.lastRunStatus;
      let lastRunAt = integ.lastEventAt;

      try {
        const runs = await runStore.listRuns({ projectId: integ.projectId, limit: 1 });
        if (runs.length > 0) {
          const latest = runs[0];
          lastRunId = latest.run_id;
          lastRunStatus = latest.status;
          lastRunAt = latest.completed_at || latest.started_at;
        }
      } catch {
        // Fall back to integration values
      }

      projects.push(
        mapIntegrationToProject(integ, {
          totalRuns: runCount,
          lastRunId,
          lastRunStatus,
          lastRunAt,
        })
      );
    }

    return projects;
  }

  /**
   * Retrieves a project by ID or slug.
   */
  static async getProject(projectId: string): Promise<Project | null> {
    const integrationStore = getIntegrationStore();
    const integ =
      (await integrationStore.getIntegrationByProjectId(projectId)) ||
      (await integrationStore.getIntegration(projectId));

    if (!integ) return null;

    let runCount = integ.runCount ?? 0;
    let lastRunId = integ.lastRunId;
    let lastRunStatus = integ.lastRunStatus;
    let lastRunAt = integ.lastEventAt;

    try {
      const runs = await getRunStore().listRuns({ projectId: integ.projectId, limit: 10 });
      runCount = Math.max(runCount, runs.length);
      if (runs.length > 0) {
        const latest = runs[0];
        lastRunId = latest.run_id;
        lastRunStatus = latest.status;
        lastRunAt = latest.completed_at || latest.started_at;
      }
    } catch {
      // Fallback
    }

    return mapIntegrationToProject(integ, {
      totalRuns: runCount,
      lastRunId,
      lastRunStatus,
      lastRunAt,
    });
  }

  /**
   * Creates a new project and issues its initial scoped ingest key.
   */
  static async createProject(
    input: CreateProjectInput
  ): Promise<{ project: Project; rawIngestKey: string }> {
    const integrationStore = getIntegrationStore();
    const projectId = input.id ? slugify(input.id) : slugify(input.name);

    // Verify uniqueness
    const existing = await integrationStore.getIntegrationByProjectId(projectId);
    if (existing) {
      throw new Error(`Project with ID '${projectId}' already exists.`);
    }

    const integration = await integrationStore.createIntegration({
      projectId,
      projectName: input.name,
      description: input.description,
      language: input.language ?? "typescript",
      framework: input.framework,
      defaultWorkflowId: input.defaultWorkflowId,
      repositoryUrl: input.repositoryUrl,
      mode: "trace_sdk",
    });

    // Generate initial scoped ingest key
    const keyResult = await integrationStore.generateIngestKey(integration.integrationId);
    if (!keyResult) {
      throw new Error(`Failed to generate scoped ingest key for project '${projectId}'.`);
    }

    const project = mapIntegrationToProject(keyResult.integration, { totalRuns: 0 });
    return { project, rawIngestKey: keyResult.rawKey };
  }

  /**
   * Updates project metadata.
   */
  static async updateProject(
    projectId: string,
    patch: UpdateProjectInput
  ): Promise<Project | null> {
    const integrationStore = getIntegrationStore();
    const integ = await integrationStore.getIntegrationByProjectId(projectId);
    if (!integ) return null;

    const updated = await integrationStore.updateIntegration(integ.integrationId, {
      projectName: patch.name,
      description: patch.description,
      language: patch.language,
      framework: patch.framework,
      defaultWorkflowId: patch.defaultWorkflowId,
      repositoryUrl: patch.repositoryUrl,
      status: patch.status,
    });

    if (!updated) return null;
    return mapIntegrationToProject(updated);
  }

  /**
   * Generates or rotates a scoped ingest key for a project.
   */
  static async rotateIngestKey(
    projectId: string
  ): Promise<{ project: Project; rawIngestKey: string } | null> {
    const integrationStore = getIntegrationStore();
    const integ = await integrationStore.getIntegrationByProjectId(projectId);
    if (!integ) return null;

    const keyResult = await integrationStore.generateIngestKey(integ.integrationId);
    if (!keyResult) return null;

    return {
      project: mapIntegrationToProject(keyResult.integration),
      rawIngestKey: keyResult.rawKey,
    };
  }

  /**
   * Revokes a scoped ingest key.
   */
  static async revokeIngestKey(projectId: string): Promise<Project | null> {
    const integrationStore = getIntegrationStore();
    const integ = await integrationStore.getIntegrationByProjectId(projectId);
    if (!integ) return null;

    const revoked = await integrationStore.revokeIngestKey(integ.integrationId);
    if (!revoked) return null;

    return mapIntegrationToProject(revoked);
  }

  /**
   * Deletes a project.
   */
  static async deleteProject(projectId: string): Promise<boolean> {
    const integrationStore = getIntegrationStore();
    const integ = await integrationStore.getIntegrationByProjectId(projectId);
    if (!integ) return false;

    return integrationStore.deleteIntegration(integ.integrationId);
  }
}
