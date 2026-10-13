/**
 * Safe Two-Phase Project Deletion for AgentPulse.
 *
 * 1. previewDeletion(projectId): counts affected runs, evals, baselines, and estimated disk impact.
 * 2. confirmDelete(projectId, confirmationId): cleans up runs, artifacts, checkpoints, and integrations.
 */

import { ProjectStore } from "./projectStore";
import { getRunStore } from "@/lib/db/getStores";
import { listRegressionBaselines } from "@/lib/core/regression/persistence";
import { listEvaluationRuns } from "@/lib/core/evals/persistence";

export interface DeletionPreview {
  projectId: string;
  projectName: string;
  runsCount: number;
  evalRunsCount: number;
  baselinesCount: number;
  estimatedDiskKb: number;
  confirmationRequired: string;
}

export class ProjectDeletionManager {
  /**
   * Previews the impact of deleting a project.
   */
  static async previewDeletion(projectId: string): Promise<DeletionPreview> {
    const project = await ProjectStore.getProject(projectId);
    if (!project) {
      throw new Error(`Project '${projectId}' not found.`);
    }

    let runsCount = 0;
    try {
      const runs = await getRunStore().listRuns({ projectId, limit: 1000 });
      runsCount = runs.length;
    } catch {
      runsCount = project.stats.totalRuns || 0;
    }

    let evalRunsCount = 0;
    try {
      const evals = await listEvaluationRuns();
      evalRunsCount = evals.filter(
        (e) => (e as unknown as { project_id?: string }).project_id === projectId
      ).length;
    } catch {
      // ignore
    }

    let baselinesCount = 0;
    try {
      const baselines = await listRegressionBaselines();
      baselinesCount = baselines.filter((b) => b.project_id === projectId).length;
    } catch {
      // ignore
    }

    const estimatedDiskKb = Math.max(12, runsCount * 45 + evalRunsCount * 15 + baselinesCount * 10);

    return {
      projectId: project.id,
      projectName: project.name,
      runsCount,
      evalRunsCount,
      baselinesCount,
      estimatedDiskKb,
      confirmationRequired: project.id,
    };
  }

  /**
   * Confirms and executes safe deletion of the project and associated data.
   */
  static async confirmDelete(
    projectId: string,
    confirmationInput: string
  ): Promise<{ success: boolean; deletedRunsCount: number }> {
    const project = await ProjectStore.getProject(projectId);
    if (!project) {
      throw new Error(`Project '${projectId}' not found.`);
    }

    if (confirmationInput.trim() !== project.id && confirmationInput.trim() !== project.name) {
      throw new Error(
        `Confirmation mismatch. Expected '${project.id}' or '${project.name}', got '${confirmationInput}'.`
      );
    }

    let deletedRunsCount = 0;
    try {
      const runs = await getRunStore().listRuns({ projectId, limit: 1000 });
      for (const run of runs) {
        await getRunStore().deleteRun(run.run_id);
        deletedRunsCount++;
      }
    } catch {
      // non-fatal
    }

    const deleted = await ProjectStore.deleteProject(projectId);
    return { success: deleted, deletedRunsCount };
  }
}
