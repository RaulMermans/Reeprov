/**
 * Evaluator-only ground-truth records.
 *
 * Detectors must not import this module. Use ./leakcheck and ./detector instead.
 */

import type { ExperimentalValidity, InjectionPlan, InjectionType, InjectionBoundary } from "./contracts";
import { assertIsolated, findGroundTruthLeaks, detectorView, type IsolationReport } from "./leakcheck";

export { assertIsolated, findGroundTruthLeaks, detectorView, type IsolationReport };

export interface InjectionRecord {
  injection_id: string;
  scenario_id: string;
  run_id: string;
  type: InjectionType;
  target_boundary: InjectionBoundary;
  target_agent_id?: string;
  expected_observable_violation: string;
  ground_truth_agent_id?: string;
  ground_truth_event_id?: string;
  actual_modification: Record<string, unknown>;
  config: Record<string, unknown>;
  reproducibility: {
    seed: string;
    scenario_id: string;
    plan_digest: string;
  };
}

export type OracleDefectClass =
  | "none"
  | "factual_contradiction"
  | "provenance_integrity"
  | "missing_resolving_evidence"
  | "unexecuted_observation"
  | "payload_tamper";

export interface OracleClaimLabel {
  claim_id: string;
  agent_id: string;
  event_kind: "assertion" | "handoff";
  event_id?: string;
  handoff_id?: string;
  /**
   * Factual/evidential status of the delivered claim or payload.
   * Provenance defects are recorded in defect_class and must not be
   * collapsed into contradicted unless a conflicting fact is established.
   */
  label: "supported" | "contradicted" | "insufficient_evidence";
  defect_class?: OracleDefectClass;
  originating_agent_id: string;
  responsible_agent_id: string;
  event_or_handoff_id?: string;
  justification: string;
}

export interface ObservabilityProbe {
  injection_type: InjectionType | "control";
  applied: boolean;
  visible_in_canonical_export: boolean;
  evidence_path: string;
  distinguishable_from_control: boolean;
  notes: string;
}

export interface GroundTruthRecord {
  format: "reeprov.swarmguard_testbed.ground_truth.v1";
  scenario_id: string;
  run_id: string;
  domain_id: string;
  case_id?: string;
  seed: string;
  control: boolean;
  injections: InjectionRecord[];
  expected_outcomes: string[];
  experimental_validity: ExperimentalValidity;
  observability: ObservabilityProbe[];
  oracle_labels: OracleClaimLabel[];
  scoring_metadata: Record<string, unknown>;
  created_at: string;
}


export function createGroundTruth(input: {
  scenarioId: string;
  runId: string;
  domainId: string;
  seed: string;
  plan: InjectionPlan;
  injections?: InjectionRecord[];
  expectedOutcomes?: string[];
  scoring?: Record<string, unknown>;
  caseId?: string;
  experimentalValidity?: ExperimentalValidity;
  observability?: ObservabilityProbe[];
  oracleLabels?: OracleClaimLabel[];
}): GroundTruthRecord {
  const control = !input.plan.enabled || !input.plan.type;
  const injections = input.injections ?? [];
  const experimentalValidity: ExperimentalValidity =
    input.experimentalValidity ?? (control || injections.length > 0 ? "valid" : "invalid_not_applied");
  return {
    format: "reeprov.swarmguard_testbed.ground_truth.v1",
    scenario_id: input.scenarioId,
    run_id: input.runId,
    domain_id: input.domainId,
    case_id: input.caseId,
    seed: input.seed,
    control,
    injections,
    expected_outcomes: input.expectedOutcomes ?? (control ? ["no_injected_violation"] : []),
    experimental_validity: experimentalValidity,
    observability: input.observability ?? [],
    oracle_labels: input.oracleLabels ?? [],
    scoring_metadata: input.scoring ?? {},
    created_at: new Date().toISOString(),
  };
}

