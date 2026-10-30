/**
 * Injection observability probes.
 *
 * An injection is experimentally valid only when the detector-visible export
 * contains the delivered effect. A ground-truth record is not sufficient.
 */

import type { RunArtifact } from "../../../lib/core/contracts/runArtifact";
import type { InjectionPlan, InjectionType } from "./contracts";
import { isControl } from "./injection";
import type { InjectionRecord } from "./isolation";
import type { ObservabilityProbe } from "./isolation";
import type { ExperimentalValidity } from "./contracts";

function json(value: unknown): string {
  return JSON.stringify(value);
}

function assertionClaims(artifact: RunArtifact): string[] {
  const events = artifact.evidence?.verification_events ?? [];
  return events
    .filter((event) => event.origin === "agent_asserted")
    .map((event) => {
      const claim = event.details?.["claim"];
      return typeof claim === "string" ? claim : "";
    })
    .filter(Boolean);
}

function deliveredToolNames(artifact: RunArtifact): string[] {
  return artifact.tools.map((tool) => tool.tool_name);
}

function firstHandoff(artifact: RunArtifact, fromAgentId?: string) {
  const handoffs = artifact.handoffs ?? [];
  if (!fromAgentId) return handoffs[0];
  return handoffs.find((handoff) => handoff.from_agent_id === fromAgentId) ?? handoffs[0];
}

export function assessObservability(input: {
  artifact: RunArtifact;
  plan: InjectionPlan;
  injections: InjectionRecord[];
  controlArtifact?: RunArtifact;
}): { probes: ObservabilityProbe[]; validity: ExperimentalValidity } {
  if (isControl(input.plan)) {
    return {
      probes: [
        {
          injection_type: "control",
          applied: false,
          visible_in_canonical_export: true,
          evidence_path: "none",
          distinguishable_from_control: false,
          notes: "Control run. No intervention applied.",
        },
      ],
      validity: "valid",
    };
  }

  const type = input.plan.type as InjectionType;
  const record = input.injections.find((item) => item.type === type);
  if (!record) {
    return {
      probes: [
        {
          injection_type: type,
          applied: false,
          visible_in_canonical_export: false,
          evidence_path: "none",
          distinguishable_from_control: false,
          notes: "Injection plan was enabled but no mutation was applied. Case is invalid.",
        },
      ],
      validity: "invalid_not_applied",
    };
  }

  const probe = probeInjection(type, input.artifact, record, input.controlArtifact);
  const validity: ExperimentalValidity = probe.visible_in_canonical_export
    ? "valid"
    : "invalid_not_observable";
  return { probes: [probe], validity };
}

function probeInjection(
  type: InjectionType,
  artifact: RunArtifact,
  record: InjectionRecord,
  controlArtifact?: RunArtifact
): ObservabilityProbe {
  switch (type) {
    case "incorrect_assertion": {
      const injected = record.actual_modification["injected_claim"];
      const claims = assertionClaims(artifact);
      const visible = typeof injected === "string" && claims.includes(injected);
      const controlClaims = controlArtifact ? assertionClaims(controlArtifact) : [];
      const distinguishable =
        visible && (controlArtifact ? !controlClaims.includes(injected) : visible);
      return {
        injection_type: type,
        applied: true,
        visible_in_canonical_export: visible,
        evidence_path: "evidence.verification_events[].details.claim",
        distinguishable_from_control: distinguishable,
        notes: visible
          ? "Delivered assertion claim is present in verification event details."
          : "Injected claim is missing from detector-visible verification details.",
      };
    }
    case "missing_evidence": {
      const handoff = firstHandoff(artifact, record.target_agent_id);
      const visible = Boolean(handoff) && (handoff?.evidence_refs.length ?? 0) === 0;
      const controlHandoff = controlArtifact
        ? firstHandoff(controlArtifact, record.target_agent_id)
        : undefined;
      const distinguishable = visible && (controlHandoff ? controlHandoff.evidence_refs.length > 0 : visible);
      return {
        injection_type: type,
        applied: true,
        visible_in_canonical_export: visible,
        evidence_path: "handoffs[].evidence_refs",
        distinguishable_from_control: distinguishable,
        notes: visible
          ? "Delivered handoff evidence_refs are empty."
          : "Handoff evidence refs were not stripped in the canonical export.",
      };
    }
    case "stale_evidence": {
      const injected = record.actual_modification["injected_artifact_ref"];
      const handoff = firstHandoff(artifact, record.target_agent_id);
      const visible =
        typeof injected === "string" && Boolean(handoff?.artifact_refs.includes(injected));
      const controlHandoff = controlArtifact
        ? firstHandoff(controlArtifact, record.target_agent_id)
        : undefined;
      const distinguishable =
        visible &&
        (controlHandoff && typeof injected === "string"
          ? !controlHandoff.artifact_refs.includes(injected)
          : visible);
      return {
        injection_type: type,
        applied: true,
        visible_in_canonical_export: visible,
        evidence_path: "handoffs[].artifact_refs",
        distinguishable_from_control: distinguishable,
        notes: visible
          ? "Handoff cites the earlier artifact version."
          : "Stale artifact ref is not present on the canonical handoff.",
      };
    }
    case "cross_run_evidence": {
      const injected = record.actual_modification["injected_ref"];
      const handoff = firstHandoff(artifact, record.target_agent_id);
      const visible =
        typeof injected === "string" && Boolean(handoff?.evidence_refs.includes(injected));
      return {
        injection_type: type,
        applied: true,
        visible_in_canonical_export: visible,
        evidence_path: "handoffs[].evidence_refs + evidence integrity CROSS_RUN",
        distinguishable_from_control: visible,
        notes: visible
          ? "Foreign run-prefixed evidence ref is present on the delivered handoff."
          : "Cross-run evidence ref did not appear in the canonical export.",
      };
    }
    case "modified_handoff": {
      const injected = record.actual_modification["injected"];
      const handoff = firstHandoff(artifact, record.target_agent_id);
      const status = handoff?.payload_capture_status;
      if (status === "omitted" || status === "structure_only" || status === "incomplete") {
        return {
          injection_type: type,
          applied: true,
          visible_in_canonical_export: false,
          evidence_path: "handoffs[].payload",
          distinguishable_from_control: false,
          notes: `Handoff payload capture is ${status ?? "missing"}; incomplete capture is not a successful observation.`,
        };
      }
      const visible =
        status === "captured" &&
        handoff?.payload !== undefined &&
        json(handoff.payload).includes(JSON.stringify(injected));
      return {
        injection_type: type,
        applied: true,
        visible_in_canonical_export: visible,
        evidence_path: "handoffs[].payload",
        distinguishable_from_control: visible,
        notes: visible
          ? "Delivered handoff payload contains the injected field value."
          : "Injected handoff body is not inspectable in the canonical export.",
      };
    }
    case "skipped_validation": {
      const skipped = record.actual_modification["skipped_tools"];
      const names = Array.isArray(skipped) ? skipped.map(String) : [];
      const executed = deliveredToolNames(artifact);
      const visible = names.length > 0 && names.every((name) => !executed.includes(name));
      const controlExecuted = controlArtifact ? deliveredToolNames(controlArtifact) : [];
      const distinguishable =
        visible && (controlArtifact ? names.some((name) => controlExecuted.includes(name)) : visible);
      return {
        injection_type: type,
        applied: true,
        visible_in_canonical_export: visible,
        evidence_path: "tools[] (absence of validation tool)",
        distinguishable_from_control: distinguishable,
        notes: visible
          ? "Validation tool invocations are absent from the captured tool list."
          : "Validation tools still appear in the detector-visible tool record.",
      };
    }
  }
}
