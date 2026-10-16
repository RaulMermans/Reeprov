/**
 * Safe Project Export for Reeprov.
 *
 * Exports a project bundle for backup, transfer, or CI reproducibility.
 * Strictly redacts and excludes all secret credentials (ingest keys, hashes, env secrets).
 */

import { ProjectStore } from "./projectStore";
import { getRunStore } from "@/lib/db/getStores";
import { listEvalSuites, listEvalDatasets, listEvaluationRuns } from "@/lib/core/evals/persistence";
import { listRegressionBaselines, listRegressionReports } from "@/lib/core/regression/persistence";
import { listCapabilitySnapshots, listCapabilityDriftReports } from "@/lib/core/capability/persistence";
import { listPolicyDriftReports } from "@/lib/core/policyDrift/persistence";
import { listReleaseEvidenceSnapshots } from "@/lib/core/releases/persistence";
import type { Project } from "./projectTypes";

export interface ProjectExportBundle {
  version: "1.0.0";
  exportedAt: string;
  project: Omit<Project, "ingestKeyPreview">;
  runs: unknown[];
  evalSuites: unknown[];
  evalDatasets: unknown[];
  evalRuns: unknown[];
  baselines: unknown[];
  regressionReports: unknown[];
  capabilitySnapshots: unknown[];
  capabilityDriftReports: unknown[];
  policyDriftReports: unknown[];
  releaseEvidence: unknown[];
}

export class ProjectExporter {
  /**
   * Generates a sanitized project export bundle.
   */
  static async exportProject(projectId: string): Promise<ProjectExportBundle> {
    const project = await ProjectStore.getProject(projectId);
    if (!project) {
      throw new Error(`Project '${projectId}' not found.`);
    }

    // Sanitize project: remove all credentials and previews
    const sanitizedProject: Omit<Project, "ingestKeyPreview"> = {
      id: project.id,
      name: project.name,
      description: project.description,
      language: project.language,
      framework: project.framework,
      defaultWorkflowId: project.defaultWorkflowId,
      repositoryUrl: project.repositoryUrl,
      status: project.status,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      stats: project.stats,
      integrationId: project.integrationId,
    };

    // Gather runs
    let runs: unknown[] = [];
    try {
      const runSummaries = await getRunStore().listRuns({ projectId, limit: 200 });
      for (const summary of runSummaries) {
        const fullRun = await getRunStore().getRun(summary.run_id);
        if (fullRun) runs.push(fullRun);
      }
    } catch {
      // Runs store error fallback
    }

    // Gather evals
    const allSuites = await listEvalSuites().catch(() => []);
    const evalSuites = allSuites.filter((s) => {
      const pid = (s as unknown as { project_id?: string }).project_id;
      return !pid || pid === projectId;
    });

    const allDatasets = await listEvalDatasets().catch(() => []);
    const evalDatasets = allDatasets.filter((d) => {
      const pid = (d as unknown as { project_id?: string }).project_id;
      return !pid || pid === projectId;
    });

    const allEvalRuns = await listEvaluationRuns().catch(() => []);
    const evalRuns = allEvalRuns.filter((e) => {
      const pid = (e as unknown as { project_id?: string }).project_id;
      return !pid || pid === projectId;
    });

    // Baselines & Reports
    const allBaselines = await listRegressionBaselines().catch(() => []);
    const baselines = allBaselines.filter((b) => b.project_id === projectId);

    const allReports = await listRegressionReports().catch(() => []);
    const regressionReports = allReports.filter((r) => r.baseline?.project_id === projectId);

    // Capabilities & Policy Drift
    const allCapSnaps = await listCapabilitySnapshots().catch(() => []);
    const capabilitySnapshots = allCapSnaps.filter((c) => c.project_id === projectId);

    const allCapDrifts = await listCapabilityDriftReports().catch(() => []);
    const capabilityDriftReports = allCapDrifts.filter(
      (c) => (c as unknown as { project_id?: string }).project_id === projectId
    );

    const allPolicyDrifts = await listPolicyDriftReports().catch(() => []);
    const policyDriftReports = allPolicyDrifts.filter(
      (p) => (p as unknown as { project_id?: string }).project_id === projectId
    );

    // Release Dossiers
    const allReleases = await listReleaseEvidenceSnapshots().catch(() => []);
    const releaseEvidence = allReleases.filter((r) => r.project_id === projectId);

    return {
      version: "1.0.0",
      exportedAt: new Date().toISOString(),
      project: sanitizedProject,
      runs,
      evalSuites,
      evalDatasets,
      evalRuns,
      baselines,
      regressionReports,
      capabilitySnapshots,
      capabilityDriftReports,
      policyDriftReports,
      releaseEvidence,
    };
  }
}
