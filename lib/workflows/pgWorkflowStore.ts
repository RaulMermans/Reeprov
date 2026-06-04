/**
 * Postgres-backed workflow registry store.
 *
 * Implements the same WorkflowStore interface as fileWorkflowStore.
 * Used in production when DATABASE_URL is set.
 *
 * Deduplication: if a workflow with the same workflowId + sourceReportId
 * already exists, saveWorkflow() updates/replaces the existing entry.
 */

import { getDb } from "@/lib/db/client";
import { ensureSchema } from "@/lib/db/migrate";
import { generateRegistryId } from "./workflowId";
import {
  buildWorkflowSummary,
  type SavedWorkflowSpec,
  type SavedWorkflowSummary,
  type SaveWorkflowInput,
  type WorkflowRegistryStatus,
  type WorkflowStore,
} from "./workflowTypes";

// ── Row → Domain mapping ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToSavedWorkflowSpec(row: Record<string, any>): SavedWorkflowSpec {
  const specData = typeof row["spec_data"] === "string"
    ? JSON.parse(row["spec_data"])
    : row["spec_data"];
  const evidencePaths = typeof row["evidence_paths"] === "string"
    ? JSON.parse(row["evidence_paths"])
    : (row["evidence_paths"] ?? []);
  const missingFields = typeof row["missing_fields"] === "string"
    ? JSON.parse(row["missing_fields"])
    : (row["missing_fields"] ?? []);
  const missingLinks = row["missing_links"]
    ? (typeof row["missing_links"] === "string" ? JSON.parse(row["missing_links"]) : row["missing_links"])
    : undefined;

  return {
    registryId: row["registry_id"] as string,
    workflowId: row["workflow_id"] as string,
    projectId: row["project_id"] as string,
    projectName: row["project_name"] as string,
    name: row["name"] as string,
    description: (row["description"] as string | null) ?? undefined,
    version: (row["version"] as string) ?? "1.0",
    architectureType: row["architecture_type"] as string,
    source: row["source"] as SavedWorkflowSpec["source"],
    confidence: row["confidence"] as SavedWorkflowSpec["confidence"],
    status: row["status"] as SavedWorkflowSpec["status"],
    sourceReportId: (row["source_report_id"] as string | null) ?? undefined,
    sourceReconstructionId: (row["source_reconstruction_id"] as string | null) ?? undefined,
    evidencePaths,
    missingFields,
    missingLinks,
    createdAt: (row["created_at"] as Date).toISOString(),
    updatedAt: (row["updated_at"] as Date).toISOString(),
    spec: specData,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToSummary(row: Record<string, any>): SavedWorkflowSummary {
  return {
    registryId: row["registry_id"] as string,
    workflowId: row["workflow_id"] as string,
    projectId: row["project_id"] as string,
    projectName: row["project_name"] as string,
    name: row["name"] as string,
    source: row["source"] as SavedWorkflowSummary["source"],
    confidence: row["confidence"] as SavedWorkflowSummary["confidence"],
    status: row["status"] as SavedWorkflowSummary["status"],
    architectureType: row["architecture_type"] as string,
    nodeCount: Number(row["node_count"]),
    edgeCount: Number(row["edge_count"]),
    toolCount: Number(row["tool_count"]),
    evalCount: Number(row["eval_count"]),
    missingFieldCount: Number(row["missing_field_count"]),
    sourceReportId: (row["source_report_id"] as string | null) ?? undefined,
    createdAt: (row["created_at"] as Date).toISOString(),
    updatedAt: (row["updated_at"] as Date).toISOString(),
  };
}

// ── Postgres implementation ───────────────────────────────────────────────────

export const pgWorkflowStore: WorkflowStore = {

  async saveWorkflow(input: SaveWorkflowInput): Promise<SavedWorkflowSpec> {
    await ensureSchema();
    const sql = getDb();
    const now = new Date();

    // Check for existing entry by workflowId + sourceReportId (deduplication).
    let registryId: string;
    let createdAt: Date = now;

    if (input.sourceReportId) {
      const existing = await sql`
        SELECT registry_id, created_at FROM ap_workflow_specs
        WHERE workflow_id = ${input.workflowId}
          AND source_report_id = ${input.sourceReportId}
        LIMIT 1
      `;
      if (existing.length > 0) {
        registryId = existing[0]!["registry_id"] as string;
        createdAt = existing[0]!["created_at"] as Date;
      } else {
        registryId = generateRegistryId();
      }
    } else {
      registryId = generateRegistryId();
    }

    const summary = buildWorkflowSummary({
      registryId,
      workflowId: input.workflowId,
      projectId: input.projectId,
      projectName: input.projectName,
      name: input.name,
      description: input.spec.description,
      version: input.spec.version ?? "1.0",
      architectureType: input.spec.architecture_type,
      source: input.source,
      confidence: input.confidence,
      status: input.status,
      sourceReportId: input.sourceReportId,
      sourceReconstructionId: input.sourceReconstructionId,
      evidencePaths: input.evidencePaths,
      missingFields: input.missingFields,
      missingLinks: input.missingLinks,
      createdAt: createdAt.toISOString(),
      updatedAt: now.toISOString(),
      spec: input.spec,
    });

    const rows = await sql`
      INSERT INTO ap_workflow_specs (
        registry_id, workflow_id, project_id, project_name, name, description,
        version, architecture_type, source, confidence, status,
        source_report_id, source_reconstruction_id,
        evidence_paths, missing_fields, missing_links,
        node_count, edge_count, tool_count, eval_count, missing_field_count,
        spec_data, created_at, updated_at
      ) VALUES (
        ${registryId},
        ${input.workflowId},
        ${input.projectId},
        ${input.projectName},
        ${input.name},
        ${input.spec.description ?? null},
        ${input.spec.version ?? "1.0"},
        ${input.spec.architecture_type},
        ${input.source},
        ${input.confidence},
        ${input.status},
        ${input.sourceReportId ?? null},
        ${input.sourceReconstructionId ?? null},
        ${JSON.stringify(input.evidencePaths)},
        ${JSON.stringify(input.missingFields)},
        ${input.missingLinks ? JSON.stringify(input.missingLinks) : null},
        ${summary.nodeCount},
        ${summary.edgeCount},
        ${summary.toolCount},
        ${summary.evalCount},
        ${summary.missingFieldCount},
        ${JSON.stringify(input.spec)},
        ${createdAt},
        ${now}
      )
      ON CONFLICT (registry_id) DO UPDATE SET
        name                    = EXCLUDED.name,
        description             = EXCLUDED.description,
        source                  = EXCLUDED.source,
        confidence              = EXCLUDED.confidence,
        status                  = EXCLUDED.status,
        evidence_paths          = EXCLUDED.evidence_paths,
        missing_fields          = EXCLUDED.missing_fields,
        missing_links           = EXCLUDED.missing_links,
        node_count              = EXCLUDED.node_count,
        edge_count              = EXCLUDED.edge_count,
        tool_count              = EXCLUDED.tool_count,
        eval_count              = EXCLUDED.eval_count,
        missing_field_count     = EXCLUDED.missing_field_count,
        spec_data               = EXCLUDED.spec_data,
        updated_at              = EXCLUDED.updated_at
      RETURNING *
    `;

    return rowToSavedWorkflowSpec(rows[0] as Record<string, unknown>);
  },

  async listWorkflows(filters): Promise<SavedWorkflowSummary[]> {
    try {
      await ensureSchema();
      const sql = getDb();
      const limit = filters?.limit && filters.limit > 0 ? filters.limit : 50;

      const rows = await sql`
        SELECT registry_id, workflow_id, project_id, project_name, name,
               source, confidence, status, architecture_type,
               node_count, edge_count, tool_count, eval_count,
               missing_field_count, source_report_id, created_at, updated_at
        FROM ap_workflow_specs
        ORDER BY updated_at DESC
        LIMIT ${limit * 5}
      `;

      let items = rows.map((r) => rowToSummary(r as Record<string, unknown>));

      if (filters?.projectId) {
        items = items.filter((i) => i.projectId === filters.projectId);
      }
      if (filters?.source) {
        items = items.filter((i) => i.source === filters.source);
      }
      if (filters?.status) {
        items = items.filter((i) => i.status === filters.status);
      }
      if (filters?.confidence) {
        items = items.filter((i) => i.confidence === filters.confidence);
      }
      if (filters?.workflowId) {
        items = items.filter((i) => i.workflowId === filters.workflowId);
      }

      return items.slice(0, limit);
    } catch {
      return [];
    }
  },

  async getWorkflow(registryId: string): Promise<SavedWorkflowSpec | null> {
    try {
      await ensureSchema();
      const sql = getDb();
      const rows = await sql`
        SELECT * FROM ap_workflow_specs WHERE registry_id = ${registryId} LIMIT 1
      `;
      if (rows.length === 0) return null;
      return rowToSavedWorkflowSpec(rows[0] as Record<string, unknown>);
    } catch {
      return null;
    }
  },

  async getWorkflowByWorkflowId(workflowId: string): Promise<SavedWorkflowSpec | null> {
    try {
      await ensureSchema();
      const sql = getDb();
      const rows = await sql`
        SELECT * FROM ap_workflow_specs
        WHERE workflow_id = ${workflowId}
        ORDER BY updated_at DESC
        LIMIT 1
      `;
      if (rows.length === 0) return null;
      return rowToSavedWorkflowSpec(rows[0] as Record<string, unknown>);
    } catch {
      return null;
    }
  },

  async updateWorkflowStatus(
    registryId: string,
    status: WorkflowRegistryStatus,
  ): Promise<SavedWorkflowSpec | null> {
    try {
      await ensureSchema();
      const sql = getDb();
      const rows = await sql`
        UPDATE ap_workflow_specs
        SET status = ${status}, updated_at = NOW()
        WHERE registry_id = ${registryId}
        RETURNING *
      `;
      if (rows.length === 0) return null;
      return rowToSavedWorkflowSpec(rows[0] as Record<string, unknown>);
    } catch {
      return null;
    }
  },

  async deleteWorkflow(registryId: string): Promise<boolean> {
    try {
      await ensureSchema();
      const sql = getDb();
      const result = await sql`
        DELETE FROM ap_workflow_specs WHERE registry_id = ${registryId}
      `;
      return (result.count ?? 0) > 0;
    } catch {
      return false;
    }
  },
};
