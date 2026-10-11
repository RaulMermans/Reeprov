/**
 * Deterministic Mutation Applier.
 *
 * Implements safe, auditable mutation application against restored state snapshots
 * and execution dependencies.
 *
 * Every mutation records:
 * - mutation_id
 * - mutation_type
 * - target
 * - original_value and original_hash
 * - mutated_value and mutated_hash
 * - application status
 */

import type { ExperimentMutation } from "../contracts/lineage";
import { hashPayload } from "../capture/hashing";
import type { AppliedMutationRecord } from "./contracts";
import { applyStatePatch, type JsonPatchOperation } from "./patch";

export class MutationApplicationError extends Error {
  constructor(
    public readonly code: "UNSUPPORTED_MUTATION" | "MUTATION_TARGET_NOT_FOUND" | "STATE_VALIDATION_FAILED",
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(`[MutationApplier: ${code}] ${message}`);
    this.name = "MutationApplicationError";
  }
}

export interface AppliedMutationsResult {
  mutatedState: Record<string, unknown>;
  appliedRecords: AppliedMutationRecord[];
  toolOverrides: Map<string, unknown>;
  modelOverrides: Map<string, unknown>;
  promptOverrides: Map<string, string>;
}

export class MutationApplier {
  apply(
    baseState: Record<string, unknown>,
    mutations: ExperimentMutation[]
  ): AppliedMutationsResult {
    let currentState = structuredClone(baseState);
    const appliedRecords: AppliedMutationRecord[] = [];
    const toolOverrides = new Map<string, unknown>();
    const modelOverrides = new Map<string, unknown>();
    const promptOverrides = new Map<string, string>();

    for (const mutation of mutations) {
      const originalHash = mutation.original_value !== undefined ? hashPayload(mutation.original_value) : undefined;
      const mutatedHash = hashPayload(mutation.mutated_value);

      switch (mutation.mutation_type) {
        case "state_patch": {
          const beforeStateHash = hashPayload(currentState);
          let patchOps: JsonPatchOperation[];

          if (Array.isArray(mutation.mutated_value)) {
            patchOps = mutation.mutated_value as JsonPatchOperation[];
          } else if (
            mutation.mutated_value &&
            typeof mutation.mutated_value === "object" &&
            "op" in mutation.mutated_value &&
            "path" in mutation.mutated_value
          ) {
            patchOps = [mutation.mutated_value as JsonPatchOperation];
          } else {
            // Target identifier is the path, mutated_value is the replacement value
            patchOps = [
              {
                op: "replace",
                path: mutation.target_identifier,
                value: mutation.mutated_value,
              },
            ];
          }

          try {
            currentState = applyStatePatch(currentState, patchOps);
            const afterStateHash = hashPayload(currentState);

            appliedRecords.push({
              mutation_id: mutation.mutation_id,
              mutation_type: "state_patch",
              target_identifier: mutation.target_identifier,
              description: mutation.description,
              original_value: mutation.original_value,
              original_hash: originalHash ?? beforeStateHash,
              mutated_value: mutation.mutated_value,
              mutated_hash: afterStateHash,
              status: "APPLIED",
            });
          } catch (err: any) {
            const code = err.code === "MUTATION_TARGET_NOT_FOUND" ? "MUTATION_TARGET_NOT_FOUND" : "STATE_VALIDATION_FAILED";
            appliedRecords.push({
              mutation_id: mutation.mutation_id,
              mutation_type: "state_patch",
              target_identifier: mutation.target_identifier,
              description: mutation.description,
              original_value: mutation.original_value,
              original_hash: originalHash,
              mutated_value: mutation.mutated_value,
              mutated_hash: mutatedHash,
              status: "REJECTED",
              error: err.message,
            });
            throw new MutationApplicationError(code, err.message, { mutationId: mutation.mutation_id });
          }
          break;
        }

        case "tool_result_override": {
          const toolKey = mutation.target_identifier.replace(/^tool:/, "");
          toolOverrides.set(toolKey, mutation.mutated_value);
          toolOverrides.set(mutation.target_identifier, mutation.mutated_value);

          appliedRecords.push({
            mutation_id: mutation.mutation_id,
            mutation_type: "tool_result_override",
            target_identifier: mutation.target_identifier,
            description: mutation.description,
            original_value: mutation.original_value,
            original_hash: originalHash,
            mutated_value: mutation.mutated_value,
            mutated_hash: mutatedHash,
            status: "APPLIED",
          });
          break;
        }

        case "model_parameters": {
          modelOverrides.set(mutation.target_identifier, mutation.mutated_value);

          appliedRecords.push({
            mutation_id: mutation.mutation_id,
            mutation_type: "model_parameters",
            target_identifier: mutation.target_identifier,
            description: mutation.description,
            original_value: mutation.original_value,
            original_hash: originalHash,
            mutated_value: mutation.mutated_value,
            mutated_hash: mutatedHash,
            status: "APPLIED",
          });
          break;
        }

        case "prompt": {
          promptOverrides.set(mutation.target_identifier, String(mutation.mutated_value));

          appliedRecords.push({
            mutation_id: mutation.mutation_id,
            mutation_type: "prompt",
            target_identifier: mutation.target_identifier,
            description: mutation.description,
            original_value: mutation.original_value,
            original_hash: originalHash,
            mutated_value: mutation.mutated_value,
            mutated_hash: mutatedHash,
            status: "APPLIED",
          });
          break;
        }

        default: {
          const errMsg = `Unsupported mutation type '${mutation.mutation_type}'. Only 'state_patch', 'tool_result_override', 'model_parameters', and 'prompt' are supported.`;
          appliedRecords.push({
            mutation_id: mutation.mutation_id,
            mutation_type: mutation.mutation_type,
            target_identifier: mutation.target_identifier,
            description: mutation.description,
            original_value: mutation.original_value,
            original_hash: originalHash,
            mutated_value: mutation.mutated_value,
            mutated_hash: mutatedHash,
            status: "REJECTED",
            error: errMsg,
          });
          throw new MutationApplicationError("UNSUPPORTED_MUTATION", errMsg, {
            mutationId: mutation.mutation_id,
            mutationType: mutation.mutation_type,
          });
        }
      }
    }

    return {
      mutatedState: currentState,
      appliedRecords,
      toolOverrides,
      modelOverrides,
      promptOverrides,
    };
  }
}
