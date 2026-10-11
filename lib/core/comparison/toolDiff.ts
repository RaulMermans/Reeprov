/**
 * Tool Invocation Diff Engine.
 *
 * Compares observable tool invocations across runs: tool selection,
 * arguments, output, status, latency, retries, and permission class.
 */

import type { ToolInvocation } from "../contracts/tools";
import type { ExecutionBoundary } from "../contracts/replay";
import { canonicalJsonStringify } from "../capture/hashing";

export interface ToolChange {
  tool_name: string;
  change_type:
    | "TOOL_OUTPUT_CHANGED"
    | "TOOL_ARGUMENT_CHANGED"
    | "TOOL_STATUS_CHANGED"
    | "TOOL_SELECTION_CHANGED"
    | "TOOL_ADDED"
    | "TOOL_REMOVED"
    | "PERMISSION_CLASS_CHANGED";
  step_id?: string;
  boundary_id?: string;
  baseline_tool?: string;
  candidate_tool?: string;
  baseline_value?: unknown;
  candidate_value?: unknown;
  description: string;
}

export function diffToolInvocations(
  baselineTools: ToolInvocation[] = [],
  candidateTools: ToolInvocation[] = [],
  baselineBoundaries: ExecutionBoundary[] = [],
  candidateBoundaries: ExecutionBoundary[] = []
): ToolChange[] {
  const changes: ToolChange[] = [];

  // 1. Tool boundaries if present
  const isToolBoundary = (b: ExecutionBoundary) =>
    b.boundary_type === "tool_call" || (b.boundary_type as string) === "tool_invocation";

  const baseToolBounds = baselineBoundaries.filter(isToolBoundary);
  const candToolBounds = candidateBoundaries.filter(isToolBoundary);

  const count = Math.max(baseToolBounds.length, candToolBounds.length);
  if (count > 0) {
    for (let i = 0; i < count; i++) {
      const b = baseToolBounds[i];
      const c = candToolBounds[i];

      if (!b && c) {
        changes.push({
          tool_name: c.name,
          change_type: "TOOL_ADDED",
          boundary_id: c.boundary_id,
          candidate_tool: c.name,
          description: `Tool '${c.name}' invoked in candidate only`,
        });
        continue;
      }

      if (b && !c) {
        changes.push({
          tool_name: b.name,
          change_type: "TOOL_REMOVED",
          boundary_id: b.boundary_id,
          baseline_tool: b.name,
          description: `Tool '${b.name}' invoked in baseline only`,
        });
        continue;
      }

      if (b && c) {
        if (b.name !== c.name) {
          changes.push({
            tool_name: c.name,
            change_type: "TOOL_SELECTION_CHANGED",
            boundary_id: c.boundary_id,
            baseline_tool: b.name,
            candidate_tool: c.name,
            description: `Tool selection changed: '${b.name}' → '${c.name}'`,
          });
        }

        const bInputHash = b.input?.hash ?? canonicalJsonStringify(b.input?.content);
        const cInputHash = c.input?.hash ?? canonicalJsonStringify(c.input?.content);
        if (bInputHash !== cInputHash) {
          changes.push({
            tool_name: c.name,
            change_type: "TOOL_ARGUMENT_CHANGED",
            step_id: c.step_id,
            boundary_id: c.boundary_id,
            baseline_value: b.input?.content ?? b.input?.summary ?? bInputHash,
            candidate_value: c.input?.content ?? c.input?.summary ?? cInputHash,
            description: `Tool arguments changed for '${c.name}'`,
          });
        }

        const bOutputHash = b.output?.hash ?? canonicalJsonStringify(b.output?.content);
        const cOutputHash = c.output?.hash ?? canonicalJsonStringify(c.output?.content);
        if (bOutputHash !== cOutputHash) {
          changes.push({
            tool_name: c.name,
            change_type: "TOOL_OUTPUT_CHANGED",
            step_id: c.step_id,
            boundary_id: c.boundary_id,
            baseline_value: b.output?.content ?? b.output?.summary ?? bOutputHash,
            candidate_value: c.output?.content ?? c.output?.summary ?? cOutputHash,
            description: `Tool output changed for '${c.name}'`,
          });
        }

        if (b.side_effect_class !== c.side_effect_class) {
          changes.push({
            tool_name: c.name,
            change_type: "PERMISSION_CLASS_CHANGED",
            boundary_id: c.boundary_id,
            baseline_value: b.side_effect_class,
            candidate_value: c.side_effect_class,
            description: `Side effect class changed for '${c.name}': ${b.side_effect_class} → ${c.side_effect_class}`,
          });
        }
      }
    }
    return changes;
  }

  // 2. Fallback to tools array
  const maxTools = Math.max(baselineTools.length, candidateTools.length);
  for (let i = 0; i < maxTools; i++) {
    const b = baselineTools[i];
    const c = candidateTools[i];

    if (!b && c) {
      changes.push({
        tool_name: c.tool_name,
        change_type: "TOOL_ADDED",
        candidate_tool: c.tool_name,
        description: `Tool '${c.tool_name}' called in candidate only`,
      });
      continue;
    }

    if (b && !c) {
      changes.push({
        tool_name: b.tool_name,
        change_type: "TOOL_REMOVED",
        baseline_tool: b.tool_name,
        description: `Tool '${b.tool_name}' called in baseline only`,
      });
      continue;
    }

    if (b && c) {
      if (b.tool_name !== c.tool_name) {
        changes.push({
          tool_name: c.tool_name,
          change_type: "TOOL_SELECTION_CHANGED",
          baseline_tool: b.tool_name,
          candidate_tool: c.tool_name,
          description: `Tool called changed: '${b.tool_name}' → '${c.tool_name}'`,
        });
      }

      if (canonicalJsonStringify(b.input) !== canonicalJsonStringify(c.input)) {
        changes.push({
          tool_name: c.tool_name,
          change_type: "TOOL_ARGUMENT_CHANGED",
          baseline_value: b.input,
          candidate_value: c.input,
          description: `Tool arguments changed for '${c.tool_name}'`,
        });
      }

      if (canonicalJsonStringify(b.output) !== canonicalJsonStringify(c.output)) {
        changes.push({
          tool_name: c.tool_name,
          change_type: "TOOL_OUTPUT_CHANGED",
          baseline_value: b.output,
          candidate_value: c.output,
          description: `Tool output changed for '${c.tool_name}'`,
        });
      }

      if (b.status !== c.status) {
        changes.push({
          tool_name: c.tool_name,
          change_type: "TOOL_STATUS_CHANGED",
          baseline_value: b.status,
          candidate_value: c.status,
          description: `Tool status changed for '${c.tool_name}': ${b.status} → ${c.status}`,
        });
      }
    }
  }

  return changes;
}
