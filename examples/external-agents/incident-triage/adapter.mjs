/**
 * Incident Triage reference agent — host adapter.
 *
 * Synthetic scenario. Every nondeterministic call goes through `deps`, so the
 * same step code runs live (capturing dependencies) and under the Reeprov
 * developer-side runner (recorded dependencies). No I/O happens here.
 *
 * Steps
 *   0 load_incident       tool  get_incident           read_only
 *   1 query_metrics       tool  query_metrics          read_only
 *   2 fetch_runbook       tool  get_runbook            read_only
 *   3 summarize_evidence  model local/extractive-summarizer-v1 (deterministic local summarizer, not an LLM)
 *     ── checkpoint "after_evidence" (resume at step 4, boundary cursor 4)
 *   4 classify            host logic only (uses state.config.triage_policy)
 *   5 act                 tool  page_oncall | create_ticket   external_side_effect
 *   6 report              host logic only
 */

export const TRIAGE_ADAPTER_IDENTITY = Object.freeze({
  adapter_id: "example.incident-triage",
  adapter_version: "1.0.0",
});

export const STEPS = Object.freeze([
  "load_incident",
  "query_metrics",
  "fetch_runbook",
  "summarize_evidence",
  "classify",
  "act",
  "report",
]);

export const BASELINE_POLICY = Object.freeze({
  version: "v1",
  sev1_error_rate: 0.05,
  sev2_error_rate: 0.04,
  consider_customer_impact: false,
});

/** Deterministic severity policy. v1 ignores customer impact (the defect under test). */
export function classify({ metrics, runbook, policy }) {
  const evidence = [`metrics:error_rate=${metrics.error_rate}`];
  const paymentPath = runbook.rules.some((r) => r.id === "RB-PAY-001") && metrics.payment_path;
  const customerImpact = metrics.payment_failures_per_min > 0 && metrics.customer_reports > 0;
  if (policy.consider_customer_impact && paymentPath && customerImpact) {
    return {
      severity: "SEV1",
      rationale: "Payment-path failures with confirmed customer impact are SEV1 regardless of error rate (RB-PAY-001).",
      evidence_refs: [
        "RB-PAY-001",
        `metrics:payment_failures_per_min=${metrics.payment_failures_per_min}`,
        `reports:customer=${metrics.customer_reports}`,
        ...evidence,
      ],
    };
  }
  if (metrics.error_rate >= policy.sev1_error_rate) return { severity: "SEV1", rationale: "Error rate above SEV1 threshold.", evidence_refs: evidence };
  if (metrics.error_rate >= policy.sev2_error_rate) return { severity: "SEV2", rationale: "Error rate above SEV2 threshold.", evidence_refs: evidence };
  return { severity: "SEV3", rationale: "Error rate below paging thresholds.", evidence_refs: evidence };
}

const stepImpl = (options) => [
  async (s, deps) => ({ ...s, incident: await deps.callTool({ name: "get_incident", args: { incident_id: s.incident_id }, sideEffect: "read_only" }) }),
  async (s, deps) => ({
    ...s,
    metrics: await deps.callTool({
      name: "query_metrics",
      // A credential in tool arguments is redacted at capture, so replay can only
      // partially verify this input (any credential hashes the same after redaction).
      args: { service: s.incident.service, window: "15m", ...(options.metricsCredential ? { auth_token: options.metricsCredential } : {}) },
      sideEffect: "read_only",
    }),
  }),
  async (s, deps) => ({ ...s, runbook: await deps.callTool({ name: "get_runbook", args: { service: s.incident.service }, sideEffect: "read_only" }) }),
  async (s, deps) => ({
    ...s,
    summary: await deps.callModel({
      provider: "local",
      model: "extractive-summarizer-v1",
      prompt: `Summarize incident ${s.incident.incident_id} for triage.`,
      evidence: { incident: s.incident, metrics: s.metrics, runbook_ids: s.runbook.rules.map((r) => r.id) },
    }),
  }),
  async (s) => ({ ...s, decision: classify({ metrics: s.metrics, runbook: s.runbook, policy: s.config.triage_policy }) }),
  async (s, deps) => {
    if (s.decision.severity === "SEV1") {
      const page = await deps.callTool({
        name: "page_oncall",
        args: { team: s.runbook.oncall_team, incident_id: s.incident_id, severity: "SEV1" },
        sideEffect: "external_side_effect",
      });
      return { ...s, action: { type: "page_oncall", team: s.runbook.oncall_team, result: page } };
    }
    const ticket = await deps.callTool({
      name: "create_ticket",
      args: { queue: "next-business-day", incident_id: s.incident_id, severity: s.decision.severity },
      sideEffect: "external_side_effect",
    });
    return { ...s, action: { type: "defer_to_ticket_queue", queue: "next-business-day", result: ticket } };
  },
  async (s) => ({
    ...s,
    report: {
      incident_id: s.incident_id,
      severity: s.decision.severity,
      action: s.action.type,
      evidence_refs: s.decision.evidence_refs,
      rationale: s.decision.rationale,
      policy_version: s.config.triage_policy.version,
    },
  }),
];

/**
 * @param {{ metricsCredential?: string }} [options] host configuration that is not part of
 *   checkpointed state (credentials never belong in a restorable snapshot).
 */
export function createHostAdapter(options = {}) {
  const STEP_IMPL = stepImpl(options);
  return {
    identity: TRIAGE_ADAPTER_IDENTITY,
    steps: STEPS,
    initialState(input) {
      return {
        incident_id: input.incident_id,
        config: { triage_policy: { ...BASELINE_POLICY, ...(input.triage_policy ?? {}) } },
      };
    },
    supportsResume({ resume_step_index }) {
      // Step boundaries 0 (start) and 4 (after evidence) are the declared resume points.
      return resume_step_index === 0 || resume_step_index === 4;
    },
    async run({ state, fromStepIndex, deps, hooks }) {
      if (!this.supportsResume({ resume_step_index: fromStepIndex })) {
        throw new Error(`UNSUPPORTED_RESUME_POINT: cannot resume at step ${fromStepIndex}`);
      }
      let s = structuredClone(state);
      for (let i = fromStepIndex; i < STEPS.length; i++) {
        await hooks?.onStepStart?.(i, STEPS[i]);
        s = await STEP_IMPL[i](s, deps);
        await hooks?.onStepComplete?.(i, STEPS[i], structuredClone(s));
      }
      return { state: s, output: s.report };
    },
  };
}

export default createHostAdapter;
