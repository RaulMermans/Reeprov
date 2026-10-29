/**
 * Machine-readable evidence export for independent analysis.
 *
 * Wraps the canonical RunArtifact with a computed integrity report.
 * This is not a competing data format — it is a view of existing contracts.
 */

import { runArtifactSchema, type RunArtifact } from "../contracts/runArtifact";
import {
  validateEvidenceIntegrity,
  type EvidenceIntegrityReport,
} from "../contracts/evidence";
import { uniqueAgentIds } from "../contracts/identity";

export const EVIDENCE_BUNDLE_FORMAT = "reeprov.evidence_bundle.v1" as const;

export interface RunEvidenceBundle {
  format: typeof EVIDENCE_BUNDLE_FORMAT;
  exported_at: string;
  identity: RunArtifact["identity"];
  participating_agent_ids: string[];
  execution: RunArtifact["execution"];
  trajectory: Array<{
    step_id: string;
    step_index: number;
    step_type: string;
    name: string;
    agent_id?: string;
    parent_step_id?: string;
    handoff_id?: string;
    status: string;
    started_at: string;
    completed_at?: string;
    tool_invocation_ids: string[];
    model_invocation_ids: string[];
    attribution: "resolved" | "unknown";
  }>;
  handoffs: RunArtifact["handoffs"];
  tools: Array<{
    tool_call_id: string;
    tool_name: string;
    agent_id?: string;
    status: string;
    started_at: string;
    output_summary?: string;
  }>;
  models: Array<{
    invocation_id: string;
    model_name: string;
    provider: string;
    agent_id?: string;
    started_at: string;
  }>;
  evidence: RunArtifact["evidence"];
  integrity: EvidenceIntegrityReport;
  replayability: RunArtifact["replay"];
  artifact: RunArtifact;
}

export function exportRunEvidenceBundle(artifact: RunArtifact): RunEvidenceBundle {
  const parsed = runArtifactSchema.parse(artifact);
  const integrity = validateEvidenceIntegrity(parsed);
  const participating = uniqueAgentIds(
    parsed.identity.participating_agent_ids,
    [parsed.identity.agent_id],
    parsed.trajectory.map((step) => step.agent_id),
    parsed.tools.map((tool) => tool.agent_id),
    parsed.models.map((model) => model.agent_id),
    (parsed.handoffs ?? []).flatMap((handoff) => [handoff.from_agent_id, handoff.to_agent_id])
  );

  return {
    format: EVIDENCE_BUNDLE_FORMAT,
    exported_at: new Date().toISOString(),
    identity: parsed.identity,
    participating_agent_ids: participating,
    execution: parsed.execution,
    trajectory: parsed.trajectory.map((step) => ({
      step_id: step.step_id,
      step_index: step.step_index,
      step_type: step.step_type,
      name: step.name,
      agent_id: step.agent_id,
      parent_step_id: step.parent_step_id,
      handoff_id: step.handoff_id,
      status: step.status,
      started_at: step.started_at,
      completed_at: step.completed_at,
      tool_invocation_ids: step.tool_invocation_ids,
      model_invocation_ids: step.model_invocation_ids,
      attribution: step.agent_id ? "resolved" : "unknown",
    })),
    handoffs: parsed.handoffs ?? [],
    tools: parsed.tools.map((tool) => ({
      tool_call_id: tool.tool_call_id,
      tool_name: tool.tool_name,
      agent_id: tool.agent_id,
      status: tool.status,
      started_at: tool.started_at,
      output_summary: tool.output_summary,
    })),
    models: parsed.models.map((model) => ({
      invocation_id: model.invocation_id,
      model_name: model.model_name,
      provider: model.provider,
      agent_id: model.agent_id,
      started_at: model.started_at,
    })),
    evidence: parsed.evidence,
    integrity,
    replayability: parsed.replay,
    artifact: parsed,
  };
}
