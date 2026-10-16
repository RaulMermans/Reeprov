/**
 * Canonical Project Model for Reeprov.
 *
 * "Project" is the top-level product object.
 * An "integration" is how a project sends evidence (TypeScript SDK, Python, REST ingest).
 *
 * Perfectly reconciled with existing ProjectIntegration storage for 100% backward compatibility.
 */

import type { IntegrationLanguage, IntegrationStatus } from "@/lib/integrations/integrationTypes";

export type ProjectLanguage = IntegrationLanguage;
export type ProjectStatus = IntegrationStatus;

export interface ProjectStats {
  totalRuns: number;
  lastRunId?: string;
  lastRunAt?: string;
  lastRunStatus?: string;
  evalSuitesCount?: number;
  baselinesCount?: number;
}

export interface Project {
  /** Canonical project identifier (e.g. "customer-support-agent", "iris") */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Optional project description */
  description?: string;
  /** Target language */
  language?: ProjectLanguage;
  /** Framework (e.g. "langgraph", "pydanticai", "crewai", "custom") */
  framework?: string;
  /** Default workflow identifier */
  defaultWorkflowId?: string;
  /** Associated repository URL */
  repositoryUrl?: string;
  /** Live connection status */
  status: ProjectStatus;
  /** Non-secret preview of ingest key (e.g. "ree_live_...9f2a" or legacy "ap_live_...9f2a") */
  ingestKeyPreview?: string;
  /** Timestamp when project was created */
  createdAt: string;
  /** Timestamp when project was last updated */
  updatedAt: string;
  /** Aggregate runtime statistics */
  stats: ProjectStats;
  /** Backing integration ID in store */
  integrationId: string;
}

export interface CreateProjectInput {
  id?: string;
  name: string;
  description?: string;
  language?: ProjectLanguage;
  framework?: string;
  defaultWorkflowId?: string;
  repositoryUrl?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  language?: ProjectLanguage;
  framework?: string;
  defaultWorkflowId?: string;
  repositoryUrl?: string;
  status?: ProjectStatus;
}
