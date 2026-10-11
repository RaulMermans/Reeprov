/**
 * Model Call Diff Engine.
 *
 * Compares observable model invocation facts: provider, model_name,
 * parameters, input hash, output hash, token usage, latency, and cost.
 * Strictly avoids private reasoning.
 */

import type { ModelInvocation } from "../contracts/models";
import type { ExecutionBoundary } from "../contracts/replay";
import { canonicalJsonStringify } from "../capture/hashing";

export interface ModelChange {
  model_id: string;
  change_type:
    | "MODEL_SELECTION_CHANGED"
    | "MODEL_PARAMETERS_CHANGED"
    | "MODEL_INPUT_CHANGED"
    | "MODEL_OUTPUT_CHANGED"
    | "MODEL_ADDED"
    | "MODEL_REMOVED";
  step_id?: string;
  boundary_id?: string;
  baseline_value?: unknown;
  candidate_value?: unknown;
  description: string;
}

export function diffModelInvocations(
  baselineModels: ModelInvocation[] = [],
  candidateModels: ModelInvocation[] = [],
  baselineBoundaries: ExecutionBoundary[] = [],
  candidateBoundaries: ExecutionBoundary[] = []
): ModelChange[] {
  const changes: ModelChange[] = [];

  // Boundaries first
  const baseModelBounds = baselineBoundaries.filter((b) => b.boundary_type === "model_call");
  const candModelBounds = candidateBoundaries.filter((b) => b.boundary_type === "model_call");

  const count = Math.max(baseModelBounds.length, candModelBounds.length);
  if (count > 0) {
    for (let i = 0; i < count; i++) {
      const b = baseModelBounds[i];
      const c = candModelBounds[i];

      if (!b && c) {
        changes.push({
          model_id: c.name,
          change_type: "MODEL_ADDED",
          boundary_id: c.boundary_id,
          description: `Model call '${c.name}' made in candidate only`,
        });
        continue;
      }

      if (b && !c) {
        changes.push({
          model_id: b.name,
          change_type: "MODEL_REMOVED",
          boundary_id: b.boundary_id,
          description: `Model call '${b.name}' made in baseline only`,
        });
        continue;
      }

      if (b && c) {
        if (b.name !== c.name) {
          changes.push({
            model_id: c.name,
            change_type: "MODEL_SELECTION_CHANGED",
            boundary_id: c.boundary_id,
            baseline_value: b.name,
            candidate_value: c.name,
            description: `Model changed: '${b.name}' → '${c.name}'`,
          });
        }

        const bInputHash = b.input?.hash ?? canonicalJsonStringify(b.input?.content);
        const cInputHash = c.input?.hash ?? canonicalJsonStringify(c.input?.content);
        if (bInputHash !== cInputHash) {
          changes.push({
            model_id: c.name,
            change_type: "MODEL_INPUT_CHANGED",
            step_id: c.step_id,
            boundary_id: c.boundary_id,
            baseline_value: b.input?.content ?? b.input?.summary ?? bInputHash,
            candidate_value: c.input?.content ?? c.input?.summary ?? cInputHash,
            description: `Model input changed for '${c.name}'`,
          });
        }

        const bOutputHash = b.output?.hash ?? canonicalJsonStringify(b.output?.content);
        const cOutputHash = c.output?.hash ?? canonicalJsonStringify(c.output?.content);
        if (bOutputHash !== cOutputHash) {
          changes.push({
            model_id: c.name,
            change_type: "MODEL_OUTPUT_CHANGED",
            step_id: c.step_id,
            boundary_id: c.boundary_id,
            baseline_value: b.output?.content ?? b.output?.summary ?? bOutputHash,
            candidate_value: c.output?.content ?? c.output?.summary ?? cOutputHash,
            description: `Model output changed for '${c.name}'`,
          });
        }
      }
    }
    return changes;
  }

  // Fallback to models array
  const maxModels = Math.max(baselineModels.length, candidateModels.length);
  for (let i = 0; i < maxModels; i++) {
    const b = baselineModels[i];
    const c = candidateModels[i];

    if (!b && c) {
      changes.push({
        model_id: c.model_name,
        change_type: "MODEL_ADDED",
        description: `Model call to '${c.model_name}' in candidate only`,
      });
      continue;
    }

    if (b && !c) {
      changes.push({
        model_id: b.model_name,
        change_type: "MODEL_REMOVED",
        description: `Model call to '${b.model_name}' in baseline only`,
      });
      continue;
    }

    if (b && c) {
      if (b.model_name !== c.model_name || b.provider !== c.provider) {
        changes.push({
          model_id: c.model_name,
          change_type: "MODEL_SELECTION_CHANGED",
          baseline_value: `${b.provider}/${b.model_name}`,
          candidate_value: `${c.provider}/${c.model_name}`,
          description: `Model selection changed: ${b.model_name} → ${c.model_name}`,
        });
      }

      if (canonicalJsonStringify(b.parameters) !== canonicalJsonStringify(c.parameters)) {
        changes.push({
          model_id: c.model_name,
          change_type: "MODEL_PARAMETERS_CHANGED",
          baseline_value: b.parameters,
          candidate_value: c.parameters,
          description: `Model parameters changed for '${c.model_name}'`,
        });
      }
    }
  }

  return changes;
}
