/**
 * Workflow Registry types.
 *
 * A SavedWorkflowSpec is a WorkflowSpec that has been promoted into the registry.
 * Sources:
 *   - example:             built-in static example specs (non-editable)
 *   - scan_reconstruction: promoted from a static proof reconstruction
 *   - manual:              manually authored and saved via API
 *   - runtime_observed:    spec inferred from runtime trace events (future)
 *
 * Status lifecycle: draft → needs_review → active (or archived)
 *   - draft:        incomplete spec, not ready for proof validation
 *   - needs_review: has missing fields or low/medium confidence
 *   - active:       high confidence, no critical missing fields
 *   - archived:     explicitly removed from active use
 */

import type { WorkflowSpec } from "@/lib/proof-layer/schemas";

// ── Source and status enums ───────────────────────────────────────────────────

export type WorkflowRegistrySource =
  | "example"
  | "scan_reconstruction"
  | "manual"
  | "runtime_observed";

export type WorkflowRegistryStatus =
  | "draft"
  | "active"
  | "needs_review"
  | "archived";

export type WorkflowRegistryConfidence = "high" | "medium" | "low";

// ── SavedWorkflowSpec — the unit of persistence ───────────────────────────────

export interface SavedWorkflowSpec {
  registryId: string;
  workflowId: string;
  projectId: string;
  projectName: string;
  name: string;
  description?: string;
  version: string;
  architectureType: string;
  source: WorkflowRegistrySource;
  confidence: WorkflowRegistryConfidence;
  status: WorkflowRegistryStatus;
  sourceReportId?: string;
  sourceReconstructionId?: string;
  evidencePaths: string[];
  missingFields: string[];
  missingLinks?: unknown[];
  createdAt: string;
  updatedAt: string;
  spec: WorkflowSpec;
}

// ── SavedWorkflowSummary — stored in the registry index ──────────────────────

export interface SavedWorkflowSummary {
  registryId: string;
  workflowId: string;
  projectId: string;
  projectName: string;
  name: string;
  source: WorkflowRegistrySource;
  confidence: WorkflowRegistryConfidence;
  status: WorkflowRegistryStatus;
  architectureType: string;
  nodeCount: number;
  edgeCount: number;
  toolCount: number;
  evalCount: number;
  missingFieldCount: number;
  sourceReportId?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Store input ───────────────────────────────────────────────────────────────

export interface SaveWorkflowInput {
  workflowId: string;
  projectId: string;
  projectName: string;
  name: string;
  description?: string;
  source: WorkflowRegistrySource;
  confidence: WorkflowRegistryConfidence;
  status: WorkflowRegistryStatus;
  sourceReportId?: string;
  sourceReconstructionId?: string;
  evidencePaths: string[];
  missingFields: string[];
  missingLinks?: unknown[];
  spec: WorkflowSpec;
}

export interface SaveWorkflowResult {
  saved: boolean;
  registryId: string;
  warning?: string;
}

// ── Store interface ───────────────────────────────────────────────────────────

export interface WorkflowStore {
  saveWorkflow(input: SaveWorkflowInput): Promise<SavedWorkflowSpec>;
  listWorkflows(filters?: {
    projectId?: string;
    source?: WorkflowRegistrySource;
    status?: WorkflowRegistryStatus;
    confidence?: WorkflowRegistryConfidence;
    workflowId?: string;
    limit?: number;
  }): Promise<SavedWorkflowSummary[]>;
  getWorkflow(registryId: string): Promise<SavedWorkflowSpec | null>;
  getWorkflowByWorkflowId(workflowId: string): Promise<SavedWorkflowSpec | null>;
  updateWorkflowStatus(registryId: string, status: WorkflowRegistryStatus): Promise<SavedWorkflowSpec | null>;
  deleteWorkflow(registryId: string): Promise<boolean>;
}

// ── Summary builder ───────────────────────────────────────────────────────────

export function buildWorkflowSummary(saved: SavedWorkflowSpec): SavedWorkflowSummary {
  return {
    registryId: saved.registryId,
    workflowId: saved.workflowId,
    projectId: saved.projectId,
    projectName: saved.projectName,
    name: saved.name,
    source: saved.source,
    confidence: saved.confidence,
    status: saved.status,
    architectureType: saved.architectureType,
    nodeCount: saved.spec.nodes.length,
    edgeCount: saved.spec.edges?.length ?? 0,
    toolCount: saved.spec.allowed_tools?.length ?? 0,
    evalCount: saved.spec.evals?.length ?? 0,
    missingFieldCount: saved.missingFields.length,
    sourceReportId: saved.sourceReportId,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
  };
}
