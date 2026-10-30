/**
 * Evaluator-only oracle binding. Not imported by detector.ts or baselines.
 */

import type { RunArtifact } from "../../../lib/core/contracts/runArtifact";
import type { OracleClaimLabel, OracleDefectClass } from "./isolation";

export interface OracleTemplate {
  agent_id: string;
  event_kind: "assertion" | "handoff";
  assertion_index?: number;
  label: OracleClaimLabel["label"];
  defect_class?: OracleDefectClass;
  responsible_agent_id: string;
  justification: string;
}

export function bindOracleLabels(artifact: RunArtifact, templates: OracleTemplate[]): OracleClaimLabel[] {
  const assertions = (artifact.evidence?.verification_events ?? []).filter(
    (event) => event.origin === "agent_asserted"
  );
  const handoffs = artifact.handoffs ?? [];
  return templates.map((template) => {
    if (template.event_kind === "assertion") {
      const index = template.assertion_index ?? 0;
      const target = `${template.agent_id}:assertion:${index}`;
      const match =
        assertions.find((event) => event.target_id === target) ??
        assertions.filter((event) => event.actor === template.agent_id)[index];
      return {
        claim_id: match?.target_id ?? target,
        agent_id: template.agent_id,
        event_kind: "assertion" as const,
        event_id: match?.event_id,
        label: template.label,
        defect_class: template.defect_class ?? "none",
        originating_agent_id: template.agent_id,
        responsible_agent_id: template.responsible_agent_id,
        event_or_handoff_id: match?.event_id,
        justification: template.justification,
      };
    }
    const match = handoffs.find((handoff) => handoff.from_agent_id === template.agent_id);
    return {
      claim_id: match ? `handoff:${match.handoff_id}` : `${template.agent_id}:handoff`,
      agent_id: template.agent_id,
      event_kind: "handoff" as const,
      handoff_id: match?.handoff_id,
      label: template.label,
      defect_class: template.defect_class ?? "none",
      originating_agent_id: template.agent_id,
      responsible_agent_id: template.responsible_agent_id,
      event_or_handoff_id: match?.handoff_id,
      justification: template.justification,
    };
  });
}
