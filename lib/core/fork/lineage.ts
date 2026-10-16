/**
 * Canonical Run Lineage Queries & View Materialization.
 *
 * Reconstructs complete execution history across fork ancestries
 * without falsifying which steps executed in parent vs child runs.
 *
 * Implements strict cycle protection across arbitrary lineage depths.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunArtifact } from "../contracts/runArtifact";
import { runArtifactSchema } from "../contracts/runArtifact";
import { getCanonicalRun } from "../capture/persistence";
import { getDb, hasDatabaseUrl } from "../../db/client";
import type { CheckpointReference, ExperimentMutation } from "../contracts/lineage";

export class LineageCycleError extends Error {
  constructor(public readonly cycleRunId: string, message?: string) {
    super(message ?? `[LineageCycleError] Detected cyclic lineage reference at run '${cycleRunId}'.`);
    this.name = "LineageCycleError";
  }
}

export interface MaterializedLineageStep {
  step_id: string;
  logical_index: number;
  name: string;
  source: "historical_prefix" | "checkpoint_marker" | "fork_execution";
  origin_run_id: string;
  status: string;
  state_snapshot_id?: string;
  output_summary?: string;
}

export interface MaterializedLineageView {
  root_run_id: string;
  parent_run_id: string;
  child_run_id: string;
  checkpoint_id: string;
  fork_step_id: string;
  checkpoint?: CheckpointReference;
  steps: MaterializedLineageStep[];
  mutations: ExperimentMutation[];
}

/**
 * Produces a unified lineage view for debugger/UI inspection:
 * Historical Prefix (from parent) + Fork Checkpoint Marker + New Execution Suffix (from child).
 */
export function materializeLineageView(
  parent: RunArtifact,
  child: RunArtifact
): MaterializedLineageView {
  const checkpointId = child.lineage?.fork_checkpoint_id ?? "unknown_checkpoint";
  const forkStepId = child.lineage?.fork_step_id;
  const checkpoint =
    parent.checkpoints?.find((c) => c.checkpoint_id === checkpointId) ??
    parent.lineage?.checkpoint_reference;

  const steps: MaterializedLineageStep[] = [];
  let logicalIndex = 0;

  // 1. Historical Prefix Steps from parent up to checkpoint step
  let checkpointStepFound = false;
  for (const step of parent.trajectory) {
    steps.push({
      step_id: step.step_id,
      logical_index: logicalIndex++,
      name: step.name,
      source: "historical_prefix",
      origin_run_id: parent.identity.run_id,
      status: step.status,
      state_snapshot_id: step.state_snapshot_id,
      output_summary: step.output_summary,
    });

    if (step.step_id === forkStepId || (checkpoint && step.step_id === checkpoint.step_id)) {
      checkpointStepFound = true;
      break;
    }
  }

  // 2. Checkpoint Marker
  steps.push({
    step_id: `marker_${checkpointId}`,
    logical_index: logicalIndex++,
    name: `Checkpoint: ${checkpointId}`,
    source: "checkpoint_marker",
    origin_run_id: parent.identity.run_id,
    status: "completed",
    state_snapshot_id: checkpoint?.state_snapshot_id,
    output_summary: `Fork branch point (Cursor: ${checkpoint?.boundary_cursor ?? 0})`,
  });

  // 3. Newly Executed Suffix Steps from child
  for (const step of child.trajectory) {
    steps.push({
      step_id: step.step_id,
      logical_index: logicalIndex++,
      name: step.name,
      source: "fork_execution",
      origin_run_id: child.identity.run_id,
      status: step.status,
      state_snapshot_id: step.state_snapshot_id,
      output_summary: step.output_summary,
    });
  }

  return {
    root_run_id: child.lineage?.root_run_id ?? parent.identity.run_id,
    parent_run_id: parent.identity.run_id,
    child_run_id: child.identity.run_id,
    checkpoint_id: checkpointId,
    fork_step_id: forkStepId ?? checkpoint?.step_id ?? "unknown",
    checkpoint,
    steps,
    mutations: child.lineage?.mutations ?? [],
  };
}

/**
 * Returns immediate parent RunArtifact if this run is derived.
 */
export async function getParentRun(runId: string): Promise<RunArtifact | null> {
  const current = await getCanonicalRun(runId);
  if (!current?.lineage?.parent_run_id) return null;
  return getCanonicalRun(current.lineage.parent_run_id);
}

/**
 * Returns root ancestral RunArtifact, with cycle detection.
 */
export async function getRootRun(runId: string): Promise<RunArtifact | null> {
  const visited = new Set<string>();
  let currentId = runId;
  let currentRun = await getCanonicalRun(runId);

  if (!currentRun) return null;

  while (currentRun?.lineage?.parent_run_id) {
    if (visited.has(currentId)) {
      throw new LineageCycleError(currentId);
    }
    visited.add(currentId);

    const nextId = currentRun.lineage.parent_run_id;
    const parentRun = await getCanonicalRun(nextId);
    if (!parentRun) break;
    currentId = nextId;
    currentRun = parentRun;
  }

  return currentRun;
}

/**
 * Returns all direct children of a given run.
 */
export async function getChildren(runId: string): Promise<RunArtifact[]> {
  // 1. Try Postgres if available
  if (hasDatabaseUrl()) {
    try {
      const sql = getDb();
      const rows = await sql`
        SELECT c.artifact_data
        FROM ap_runs r
        JOIN ap_canonical_runs c ON r.run_id = c.run_id
        WHERE r.parent_run_id = ${runId}
      `;
      if (rows.length > 0) {
        return rows.map((row: any) => {
          const raw = typeof row.artifact_data === "string" ? JSON.parse(row.artifact_data) : row.artifact_data;
          return runArtifactSchema.parse(raw);
        });
      }
    } catch {
      // Fall through to file store
    }
  }

  // 2. Scan file store
  const { getReeprovEnv } = await import("@/lib/config/env");
  const { getReeprovHome } = await import("@/lib/storage/dataPath");
  const base =
    getReeprovEnv("REEPROV_STORE_DIR") ??
    getReeprovEnv("REEPROV_HOME") ??
    getReeprovHome();
  const storeDir = join(base, "runs");
  const children: RunArtifact[] = [];

  try {
    const files = await readdir(storeDir);
    const canonicalFiles = files.filter((f) => f.endsWith(".canonical.json"));

    for (const file of canonicalFiles) {
      try {
        const raw = await readFile(join(storeDir, file), "utf8");
        const parsed = runArtifactSchema.parse(JSON.parse(raw));
        if (parsed.lineage?.parent_run_id === runId) {
          children.push(parsed);
        }
      } catch {
        // Skip unparseable files
      }
    }
  } catch {
    // Directory may not exist
  }

  return children;
}

/**
 * Returns ordered list of ancestors: [parent, grandParent, ..., root].
 * Guards against cycles.
 */
export async function getAncestors(runId: string): Promise<RunArtifact[]> {
  const ancestors: RunArtifact[] = [];
  const visited = new Set<string>([runId]);
  let currentRun = await getCanonicalRun(runId);

  while (currentRun?.lineage?.parent_run_id) {
    const parentId = currentRun.lineage.parent_run_id;
    if (visited.has(parentId)) {
      throw new LineageCycleError(parentId);
    }
    visited.add(parentId);

    const parent = await getCanonicalRun(parentId);
    if (!parent) break;
    ancestors.push(parent);
    currentRun = parent;
  }

  return ancestors;
}

/**
 * Returns all transitive descendants of a given run.
 * Guards against cycles.
 */
export async function getDescendants(runId: string): Promise<RunArtifact[]> {
  const descendants: RunArtifact[] = [];
  const visited = new Set<string>([runId]);
  const queue = [runId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const directChildren = await getChildren(currentId);

    for (const child of directChildren) {
      const childId = child.identity.run_id;
      if (visited.has(childId)) {
        throw new LineageCycleError(childId);
      }
      visited.add(childId);
      descendants.push(child);
      queue.push(childId);
    }
  }

  return descendants;
}
