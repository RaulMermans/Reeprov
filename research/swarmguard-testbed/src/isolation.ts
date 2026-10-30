/**
 * Detector-visible vs evaluator-only isolation.
 *
 * Future SwarmGuard detectors must read only the canonical Reeprov artifact /
 * evidence bundle. Intervention labels live exclusively in GroundTruthRecord.
 */

import { GROUND_TRUTH_LEAK_KEYS, LEAK_SUBSTRINGS } from "./contracts";
import type { InjectionPlan, InjectionType, InjectionBoundary } from "./contracts";

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

export interface GroundTruthRecord {
  format: "reeprov.swarmguard_testbed.ground_truth.v1";
  scenario_id: string;
  run_id: string;
  domain_id: string;
  seed: string;
  control: boolean;
  injections: InjectionRecord[];
  expected_outcomes: string[];
  scoring_metadata: Record<string, unknown>;
  created_at: string;
}

export interface IsolationReport {
  isolated: boolean;
  leaks: string[];
}

function collectKeys(value: unknown, path: string, acc: string[]): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectKeys(entry, `${path}[${index}]`, acc));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      acc.push(`${path}.${key}`);
      collectKeys(child, `${path}.${key}`, acc);
    }
  }
}

export function findGroundTruthLeaks(detectorVisible: unknown): string[] {
  const leaks: string[] = [];
  const keys: string[] = [];
  collectKeys(detectorVisible, "$", keys);
  const forbidden = new Set<string>(GROUND_TRUTH_LEAK_KEYS);
  for (const path of keys) {
    const leaf = path.split(".").pop() ?? "";
    const bracketFree = leaf.replace(/\[\d+\]/g, "");
    if (forbidden.has(bracketFree)) {
      leaks.push(`forbidden key at ${path}`);
    }
  }
  const serialized = JSON.stringify(detectorVisible).toLowerCase();
  for (const token of LEAK_SUBSTRINGS) {
    if (serialized.includes(token)) {
      leaks.push(`forbidden substring "${token}" in detector-visible JSON`);
    }
  }
  return [...new Set(leaks)];
}

export function assertIsolated(detectorVisible: unknown): IsolationReport {
  const leaks = findGroundTruthLeaks(detectorVisible);
  return { isolated: leaks.length === 0, leaks };
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
}): GroundTruthRecord {
  const control = !input.plan.enabled;
  return {
    format: "reeprov.swarmguard_testbed.ground_truth.v1",
    scenario_id: input.scenarioId,
    run_id: input.runId,
    domain_id: input.domainId,
    seed: input.seed,
    control,
    injections: input.injections ?? [],
    expected_outcomes: input.expectedOutcomes ?? (control ? ["no_injected_violation"] : []),
    scoring_metadata: input.scoring ?? {},
    created_at: new Date().toISOString(),
  };
}

export function detectorView<T>(artifact: T): T {
  return structuredClone(artifact);
}
