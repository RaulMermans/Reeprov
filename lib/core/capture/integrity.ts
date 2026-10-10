/**
 * Execution Trajectory and Boundary Integrity Validation.
 *
 * Verifies that a RunArtifact represents an unbroken, causal execution graph:
 * - Boundaries have strictly unique IDs and monotonically increasing sequence indices (0..n).
 * - Trajectory steps have strictly unique IDs and deterministic step indices (0..m).
 * - Bidirectional step <-> boundary linkages are intact with no orphaned or multiply-assigned boundaries.
 * - Invocation references (models, tools, retrievals, memories, contexts, states) exist.
 * - Retrieval boundaries conform to canonical boundary types.
 */

import type { RunArtifact } from "../contracts/runArtifact";

export interface ExecutionIntegrityReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  boundaryCount: number;
  stepCount: number;
  linkedBoundaryCount: number;
}

export class ExecutionIntegrityError extends Error {
  constructor(public readonly errors: string[]) {
    super(`[ExecutionIntegrityError] Integrity violations found:\n  - ${errors.join("\n  - ")}`);
    this.name = "ExecutionIntegrityError";
  }
}

/**
 * Validates causal execution integrity across trajectory steps, boundaries, and invocations.
 */
export function validateExecutionIntegrity(artifact: RunArtifact): ExecutionIntegrityReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const boundaries = artifact.boundaries ?? [];
  const steps = artifact.trajectory ?? [];
  const models = artifact.models ?? [];
  const tools = artifact.tools ?? [];
  const retrievals = artifact.retrieval ?? [];
  const memories = artifact.memory?.operations ?? [];
  const contexts = artifact.context ?? [];
  const states = artifact.state ?? [];

  // ── 1. Boundary Sequence & Uniqueness ──────────────────────────────────────
  const boundaryIdSet = new Set<string>();
  const boundarySequenceSet = new Set<number>();

  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    // Check ID uniqueness
    if (boundaryIdSet.has(b.boundary_id)) {
      errors.push(`Duplicate boundary_id detected: '${b.boundary_id}' at index ${i}`);
    } else {
      boundaryIdSet.add(b.boundary_id);
    }

    // Check sequence_index monotonicity (0..n)
    if (b.sequence_index === undefined) {
      errors.push(`Boundary '${b.boundary_id}' at index ${i} is missing sequence_index`);
    } else {
      if (b.sequence_index !== i) {
        errors.push(
          `Boundary sequence index mismatch: boundary '${b.boundary_id}' has sequence_index ${b.sequence_index}, expected monotonic index ${i}`
        );
      }
      if (boundarySequenceSet.has(b.sequence_index)) {
        errors.push(`Duplicate sequence_index ${b.sequence_index} on boundary '${b.boundary_id}'`);
      } else {
        boundarySequenceSet.add(b.sequence_index);
      }
    }

    // Check retrieval type canonicalization
    if (b.boundary_type === "retrieval_service") {
      warnings.push(
        `Boundary '${b.boundary_id}' uses legacy 'retrieval_service' instead of canonical 'retrieval_call'`
      );
    }
  }

  // ── 2. Step Sequence & Uniqueness ──────────────────────────────────────────
  const stepIdSet = new Set<string>();
  const stepMap = new Map<string, typeof steps[0]>();

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (stepIdSet.has(s.step_id)) {
      errors.push(`Duplicate step_id detected: '${s.step_id}' at index ${i}`);
    } else {
      stepIdSet.add(s.step_id);
      stepMap.set(s.step_id, s);
    }

    if (s.step_index !== i) {
      errors.push(`Step '${s.step_id}' has step_index ${s.step_index}, expected ${i}`);
    }
  }

  // ── 3. Step <-> Boundary Linkage Integrity ─────────────────────────────────
  const boundaryToStepMap = new Map<string, string>();
  let linkedBoundaryCount = 0;

  for (const s of steps) {
    for (const bId of s.boundary_ids ?? []) {
      if (!boundaryIdSet.has(bId)) {
        errors.push(`Step '${s.step_id}' references non-existent boundary_id '${bId}'`);
      }
      if (boundaryToStepMap.has(bId)) {
        errors.push(
          `Boundary '${bId}' belongs to multiple steps: '${boundaryToStepMap.get(bId)}' and '${s.step_id}'`
        );
      } else {
        boundaryToStepMap.set(bId, s.step_id);
        linkedBoundaryCount++;
      }
    }
  }

  for (const b of boundaries) {
    if (b.step_id) {
      if (!stepIdSet.has(b.step_id)) {
        errors.push(
          `Boundary '${b.boundary_id}' references non-existent step_id '${b.step_id}'`
        );
      } else {
        const step = stepMap.get(b.step_id);
        if (step && !step.boundary_ids.includes(b.boundary_id)) {
          errors.push(
            `Boundary '${b.boundary_id}' points to step '${b.step_id}', but step does not include this boundary in its boundary_ids`
          );
        }
      }
    }
  }

  // ── 4. Invocation & Snapshot Linkage ────────────────────────────────────────
  const modelIdSet = new Set(models.map((m) => m.invocation_id));
  const toolIdSet = new Set(tools.map((t) => t.tool_call_id));
  const retrievalIdSet = new Set(retrievals.map((r) => r.operation_id));
  const memoryIdSet = new Set(memories.map((m) => m.operation_id));
  const contextIdSet = new Set(contexts.map((c) => c.snapshot_id));
  const stateIdSet = new Set(states.map((s) => s.snapshot_id));

  for (const s of steps) {
    for (const mId of s.model_invocation_ids ?? []) {
      if (!modelIdSet.has(mId)) {
        errors.push(`Step '${s.step_id}' references non-existent model invocation '${mId}'`);
      }
    }
    for (const tId of s.tool_invocation_ids ?? []) {
      if (!toolIdSet.has(tId)) {
        errors.push(`Step '${s.step_id}' references non-existent tool invocation '${tId}'`);
      }
    }
    for (const rId of s.retrieval_operation_ids ?? []) {
      if (!retrievalIdSet.has(rId)) {
        errors.push(`Step '${s.step_id}' references non-existent retrieval operation '${rId}'`);
      }
    }
    for (const memId of s.memory_operation_ids ?? []) {
      if (!memoryIdSet.has(memId)) {
        errors.push(`Step '${s.step_id}' references non-existent memory operation '${memId}'`);
      }
    }
    if (s.context_snapshot_id && !contextIdSet.has(s.context_snapshot_id)) {
      errors.push(`Step '${s.step_id}' references non-existent context snapshot '${s.context_snapshot_id}'`);
    }
    if (s.state_snapshot_id && !stateIdSet.has(s.state_snapshot_id)) {
      errors.push(`Step '${s.step_id}' references non-existent state snapshot '${s.state_snapshot_id}'`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    boundaryCount: boundaries.length,
    stepCount: steps.length,
    linkedBoundaryCount,
  };
}

/**
 * Asserts execution integrity, throwing an ExecutionIntegrityError if invalid.
 */
export function assertExecutionIntegrity(artifact: RunArtifact): void {
  const report = validateExecutionIntegrity(artifact);
  if (!report.valid) {
    throw new ExecutionIntegrityError(report.errors);
  }
}
