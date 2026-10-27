import type { ReeprovHostAdapter, ResumeAdapterIdentity } from "@reeprov/client";

export declare const TRIAGE_ADAPTER_IDENTITY: Readonly<ResumeAdapterIdentity>;
export declare const STEPS: readonly string[];
export declare const BASELINE_POLICY: Readonly<Record<string, unknown>>;
export declare function classify(input: { metrics: Record<string, unknown>; runbook: Record<string, unknown>; policy: Record<string, unknown> }): {
  severity: string;
  rationale: string;
  evidence_refs: string[];
};
export declare function createHostAdapter(options?: { metricsCredential?: string }): ReeprovHostAdapter<{ incident_id: string; triage_policy?: Record<string, unknown> }>;
export default createHostAdapter;
