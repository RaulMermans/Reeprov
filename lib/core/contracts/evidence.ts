/**
 * Canonical Run Evidence Contracts.
 *
 * Provides the first-class PROOF layer for Reeprov execution intelligence:
 * 1. Explicit structured PlanEvidence (private chain-of-thought strictly prohibited).
 * 2. Append-only VerificationEvents (chronological verification lifecycle).
 * 3. Typed TestResults (artifact-referenced logs).
 * 4. Observable ReviewResults & Findings (human and automated).
 * 5. Correlated SecurityEvents & Approvals (action_id linkage).
 * 6. Explicit RunOutcome (independent of technical HTTP success).
 * 7. Evidence completeness and policy evaluation.
 */

import { z } from "zod";
import type { RunArtifact } from "./runArtifact";

// ── Explicit Plan Evidence ──────────────────────────────────────────────────

export const planItemStatusSchema = z.enum([
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "SKIPPED",
  "CANCELLED",
]);

export type PlanItemStatus = z.infer<typeof planItemStatusSchema>;

export const planItemSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: planItemStatusSchema,
  dependencies: z.array(z.string()).default([]),
  evidence_refs: z.array(z.string()).default([]),
}).strict();

export type PlanItem = z.infer<typeof planItemSchema>;

export const planStatusSchema = z.enum([
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "SKIPPED",
  "CANCELLED",
]);

export type PlanStatus = z.infer<typeof planStatusSchema>;

const FORBIDDEN_REASONING_KEYS = [
  "reasoning",
  "thought",
  "thoughts",
  "chain_of_thought",
  "cot",
  "internal_reasoning",
  "model_reasoning",
  "scratchpad",
];

export const planEvidenceSchema = z.object({
  plan_id: z.string(),
  run_id: z.string(),
  step_id: z.string().optional(),
  goal: z.string(),
  items: z.array(planItemSchema).default([]),
  created_at: z.string(),
  producer: z.string(),
  version: z.string().optional(),
  artifact_ref: z.string().optional(),
  status: planStatusSchema.default("PLANNED"),
}).passthrough().superRefine((val, ctx) => {
  const allowedKeys = new Set([
    "plan_id",
    "run_id",
    "step_id",
    "goal",
    "items",
    "created_at",
    "producer",
    "version",
    "artifact_ref",
    "status",
  ]);
  for (const key of Object.keys(val)) {
    if (FORBIDDEN_REASONING_KEYS.includes(key.toLowerCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Forbidden private reasoning field detected in PlanEvidence: "${key}". Only structured plans explicitly emitted by runtime are permitted.`,
        path: [key],
      });
    } else if (!allowedKeys.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unrecognized key in PlanEvidence: "${key}"`,
        path: [key],
      });
    }
  }
});

export type PlanEvidence = z.infer<typeof planEvidenceSchema>;

// ── Unified Verification Event Contract ─────────────────────────────────────

export const verificationEventTypeSchema = z.enum([
  "test.started",
  "test.passed",
  "test.failed",
  "review.started",
  "review.passed",
  "review.failed",
  "verification.started",
  "verification.passed",
  "verification.failed",
  "eval.started",
  "eval.passed",
  "eval.failed",
  "approval.requested",
  "approval.granted",
  "approval.rejected",
  "security.check_started",
  "security.check_passed",
  "security.check_failed",
  "artifact.verified",
]);

export type VerificationEventType = z.infer<typeof verificationEventTypeSchema>;

export const verificationStatusSchema = z.enum([
  "PASSED",
  "FAILED",
  "STARTED",
  "REQUESTED",
  "GRANTED",
  "REJECTED",
  "BLOCKED",
  "VERIFIED",
  "SKIPPED",
  "UNKNOWN",
]);

export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

export const evidenceOriginSchema = z.enum([
  "externally_observed",
  "agent_asserted",
  "system_recorded",
  "unverified",
]);

export type EvidenceOrigin = z.infer<typeof evidenceOriginSchema>;

export const evidenceAuthoritySchema = z.enum([
  "authoritative",
  "asserted",
  "unverified",
]);

export type EvidenceAuthority = z.infer<typeof evidenceAuthoritySchema>;

export const verificationEventSchema = z.object({
  event_id: z.string(),
  run_id: z.string(),
  step_id: z.string().optional(),
  event_type: verificationEventTypeSchema,
  target_type: z.string(),
  target_id: z.string().optional(),
  status: verificationStatusSchema,
  actor: z.string(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  duration_ms: z.number().nonnegative().optional(),
  evidence_refs: z.array(z.string()).default([]),
  artifact_refs: z.array(z.string()).default([]),
  details: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  sequence_index: z.number().int().nonnegative(),
  origin: evidenceOriginSchema.optional(),
  authority: evidenceAuthoritySchema.optional(),
});

export type VerificationEvent = z.infer<typeof verificationEventSchema>;

// ── Test Result Contract ────────────────────────────────────────────────────

export const testStatusSchema = z.enum([
  "PASSED",
  "FAILED",
  "SKIPPED",
  "ERROR",
  "CANCELLED",
]);

export type TestStatus = z.infer<typeof testStatusSchema>;

export const testResultSchema = z.object({
  test_id: z.string(),
  run_id: z.string(),
  step_id: z.string().optional(),
  suite: z.string(),
  name: z.string(),
  status: testStatusSchema,
  duration_ms: z.number().nonnegative().optional(),
  attempt: z.number().int().positive().default(1),
  environment: z.string().optional(),
  artifact_refs: z.array(z.string()).default([]),
  stdout_ref: z.string().optional(),
  stderr_ref: z.string().optional(),
  failure_message: z.string().optional(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  origin: evidenceOriginSchema.optional(),
  authority: evidenceAuthoritySchema.optional(),
});

export type TestResult = z.infer<typeof testResultSchema>;

// ── Review Result Contract ──────────────────────────────────────────────────

export const reviewTypeSchema = z.enum([
  "CODE",
  "OUTPUT",
  "SECURITY",
  "POLICY",
  "HUMAN",
  "AUTOMATED",
  "OTHER",
]);

export type ReviewType = z.infer<typeof reviewTypeSchema>;

export const reviewStatusSchema = z.enum([
  "PASSED",
  "FAILED",
  "CHANGES_REQUESTED",
  "COMMENTED",
]);

export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

export const reviewFindingSchema = z.object({
  severity: z.enum(["info", "warning", "error", "critical"]),
  category: z.string(),
  message: z.string(),
  target_ref: z.string().optional(),
  evidence_ref: z.string().optional(),
});

export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

export const reviewResultSchema = z.object({
  review_id: z.string(),
  run_id: z.string(),
  step_id: z.string().optional(),
  review_type: reviewTypeSchema,
  reviewer: z.string(),
  status: reviewStatusSchema,
  findings: z.array(reviewFindingSchema).default([]),
  evidence_refs: z.array(z.string()).default([]),
  artifact_refs: z.array(z.string()).default([]),
  created_at: z.string(),
});

export type ReviewResult = z.infer<typeof reviewResultSchema>;

// ── Approval Evidence Contract ──────────────────────────────────────────────

export const approvalDecisionSchema = z.enum([
  "GRANTED",
  "REJECTED",
  "EXPIRED",
  "PENDING",
]);

export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export const approvalEvidenceSchema = z.object({
  approval_id: z.string(),
  action_id: z.string().optional(),
  requested_by: z.string(),
  required_permission_class: z.string(),
  requested_at: z.string(),
  resolved_at: z.string().optional(),
  resolved_by: z.string().optional(),
  decision: approvalDecisionSchema,
  policy_version: z.string().optional(),
  proposal_hash: z.string().optional(),
  reason: z.string().optional(),
  expiry: z.string().optional(),
  evidence_refs: z.array(z.string()).default([]),
});

export type ApprovalEvidence = z.infer<typeof approvalEvidenceSchema>;

// ── Security & Permission Telemetry Contract ────────────────────────────────

export const securityDecisionSchema = z.enum([
  "ALLOW",
  "DENY",
  "BLOCKED",
  "REQUIRE_APPROVAL",
  "UNKNOWN",
]);

export type SecurityDecision = z.infer<typeof securityDecisionSchema>;

export const securityEventSchema = z.object({
  event_id: z.string(),
  run_id: z.string(),
  step_id: z.string().optional(),
  action_id: z.string().optional(),
  agent_id: z.string().optional(),
  tool_id: z.string().optional(),
  permission_class: z.string().optional(),
  policy_id: z.string().optional(),
  policy_version: z.string().optional(),
  event_type: z.string(),
  decision: securityDecisionSchema,
  reason_code: z.string().optional(),
  approval_id: z.string().optional(),
  risk_class: z.string().optional(),
  target_ref: z.string().optional(),
  timestamp: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type SecurityEvent = z.infer<typeof securityEventSchema>;

// ── Final Outcome Contract ──────────────────────────────────────────────────

export const runOutcomeStatusSchema = z.enum([
  "SUCCESS",
  "FAILURE",
  "PARTIAL_SUCCESS",
  "BLOCKED",
  "CANCELLED",
  "UNKNOWN",
]);

export type RunOutcomeStatus = z.infer<typeof runOutcomeStatusSchema>;

export const runOutcomeSchema = z.object({
  status: runOutcomeStatusStatusSchema(),
  reason_code: z.string().optional(),
  summary: z.string().optional(),
  output_ref: z.string().optional(),
  verification_status: z.enum(["PASS", "FAIL", "PARTIAL", "NOT_RUN"]).default("NOT_RUN"),
  tests_status: z.enum(["PASS", "FAIL", "SKIPPED", "NOT_RUN"]).optional(),
  review_status: z.enum(["PASS", "FAIL", "CHANGES_REQUESTED", "NOT_RUN"]).optional(),
  eval_status: z.enum(["PASS", "FAIL", "NOT_RUN"]).optional(),
  security_status: z.enum(["PASS", "VIOLATION", "BLOCKED", "NOT_RUN"]).optional(),
  completed_at: z.string(),
  payload: z.unknown().optional(),
});

function runOutcomeStatusStatusSchema() {
  return runOutcomeStatusSchema;
}

export type RunOutcome = z.infer<typeof runOutcomeSchema>;

export const evidenceRefStatusSchema = z.enum([
  "RESOLVED",
  "MISSING",
  "MALFORMED",
  "DUPLICATE",
  "CROSS_RUN",
  "OUT_OF_ORDER",
]);

export type EvidenceRefStatus = z.infer<typeof evidenceRefStatusSchema>;

export const evidenceRefKindSchema = z.enum([
  "step",
  "boundary",
  "tool",
  "model",
  "test",
  "review",
  "artifact",
  "eval",
  "verification_event",
  "handoff",
  "snapshot",
]);

export type EvidenceRefKind = z.infer<typeof evidenceRefKindSchema>;

export const evidenceRefResolutionSchema = z.object({
  ref: z.string(),
  status: evidenceRefStatusSchema,
  resolved_kind: evidenceRefKindSchema.optional(),
  resolved_id: z.string().optional(),
  source: z.string().optional(),
});

export type EvidenceRefResolution = z.infer<typeof evidenceRefResolutionSchema>;

export const classifiedEvidenceRecordSchema = z.object({
  id: z.string(),
  kind: z.string(),
  origin: evidenceOriginSchema,
  authority: evidenceAuthoritySchema,
  status: z.string().optional(),
  authoritative: z.boolean(),
});

export type ClassifiedEvidenceRecord = z.infer<typeof classifiedEvidenceRecordSchema>;

export const evidenceIntegrityReportSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  references: z.array(evidenceRefResolutionSchema).default([]),
  records: z.array(classifiedEvidenceRecordSchema).default([]),
  authoritative_verification_count: z.number().int().nonnegative().default(0),
  asserted_only_verification_count: z.number().int().nonnegative().default(0),
  outcome_authoritative: z.boolean().default(false),
});

export type EvidenceIntegrityReport = z.infer<typeof evidenceIntegrityReportSchema>;

// ── First-Class Run Evidence Container ──────────────────────────────────────

export const runEvidenceSchema = z.object({
  plan: planEvidenceSchema.optional(),
  verification_events: z.array(verificationEventSchema).default([]),
  test_results: z.array(testResultSchema).default([]),
  review_results: z.array(reviewResultSchema).default([]),
  approval_events: z.array(approvalEvidenceSchema).default([]),
  security_events: z.array(securityEventSchema).default([]),
  final_outcome: runOutcomeSchema.optional(),
  integrity: evidenceIntegrityReportSchema.optional(),
});

export type RunEvidence = z.infer<typeof runEvidenceSchema>;

// ── Evidence Completeness & Policy ──────────────────────────────────────────

export const evidenceCoverageStatusSchema = z.enum([
  "PRESENT",
  "NOT_CAPTURED",
  "NOT_APPLICABLE",
  "MISSING_REQUIRED",
]);

export type EvidenceCoverageStatus = z.infer<typeof evidenceCoverageStatusSchema>;

export const evidencePolicySchema = z.object({
  configuration: z.enum(["required", "optional", "ignore"]).default("optional"),
  plan: z.enum(["required", "optional", "ignore"]).default("optional"),
  tools: z.enum(["required", "optional", "ignore"]).default("optional"),
  tests: z.enum(["required", "optional", "ignore"]).default("optional"),
  review: z.enum(["required", "optional", "ignore"]).default("optional"),
  verification: z.enum(["required", "optional", "ignore"]).default("optional"),
  permissions: z.enum(["required", "optional", "conditional", "ignore"]).default("optional"),
  artifacts: z.enum(["required", "optional", "ignore"]).default("optional"),
  outcome: z.enum(["required", "optional", "ignore"]).default("optional"),
});

export type EvidencePolicy = z.infer<typeof evidencePolicySchema>;

export interface EvidenceCompleteness {
  score: number; // 0 - 100 percentage
  coverage: {
    configuration: EvidenceCoverageStatus;
    plan: EvidenceCoverageStatus;
    tools: EvidenceCoverageStatus;
    tests: EvidenceCoverageStatus;
    review: EvidenceCoverageStatus;
    verification: EvidenceCoverageStatus;
    permissions: EvidenceCoverageStatus;
    artifacts: EvidenceCoverageStatus;
    outcome: EvidenceCoverageStatus;
  };
  present_count: number;
  total_evaluated: number;
  passed_policy: boolean;
  missing_required: string[];
}

export function computeEvidenceCompleteness(
  artifact: RunArtifact,
  policyInput?: Partial<EvidencePolicy>
): EvidenceCompleteness {
  const policy: EvidencePolicy = {
    configuration: policyInput?.configuration ?? "optional",
    plan: policyInput?.plan ?? "optional",
    tools: policyInput?.tools ?? "optional",
    tests: policyInput?.tests ?? "optional",
    review: policyInput?.review ?? "optional",
    verification: policyInput?.verification ?? "optional",
    permissions: policyInput?.permissions ?? "optional",
    artifacts: policyInput?.artifacts ?? "optional",
    outcome: policyInput?.outcome ?? "optional",
  };

  const hasConfig = Boolean(artifact.configuration_snapshot);
  const hasPlan = Boolean(artifact.evidence?.plan);
  const hasTools = Boolean(artifact.tools && artifact.tools.length > 0);
  const hasTests = Boolean(artifact.evidence?.test_results && artifact.evidence.test_results.length > 0);
  const hasReview = Boolean(artifact.evidence?.review_results && artifact.evidence.review_results.length > 0);
  const hasVerification = Boolean(
    (artifact.evidence?.verification_events && artifact.evidence.verification_events.length > 0) ||
    (artifact.evals && artifact.evals.length > 0)
  );
  const hasPermissions = Boolean(
    (artifact.evidence?.security_events && artifact.evidence.security_events.length > 0) ||
    (artifact.evidence?.approval_events && artifact.evidence.approval_events.length > 0) ||
    (artifact.safety?.approval_records && artifact.safety.approval_records.length > 0)
  );
  const hasArtifacts = Boolean(artifact.artifacts && artifact.artifacts.length > 0);
  const hasOutcome = Boolean(artifact.evidence?.final_outcome);

  const evaluateField = (
    present: boolean,
    requirement: "required" | "optional" | "conditional" | "ignore"
  ): EvidenceCoverageStatus => {
    if (requirement === "ignore") return "NOT_APPLICABLE";
    if (present) return "PRESENT";
    if (requirement === "required") return "MISSING_REQUIRED";
    return "NOT_CAPTURED";
  };

  const coverage: EvidenceCompleteness["coverage"] = {
    configuration: evaluateField(hasConfig, policy.configuration),
    plan: evaluateField(hasPlan, policy.plan),
    tools: evaluateField(hasTools, policy.tools),
    tests: evaluateField(hasTests, policy.tests),
    review: evaluateField(hasReview, policy.review),
    verification: evaluateField(hasVerification, policy.verification),
    permissions: evaluateField(hasPermissions, policy.permissions === "conditional" ? "optional" : policy.permissions),
    artifacts: evaluateField(hasArtifacts, policy.artifacts),
    outcome: evaluateField(hasOutcome, policy.outcome),
  };

  const missing_required: string[] = [];
  let present_count = 0;
  let total_evaluated = 0;

  for (const [key, status] of Object.entries(coverage)) {
    if (status !== "NOT_APPLICABLE") {
      total_evaluated++;
      if (status === "PRESENT") {
        present_count++;
      } else if (status === "MISSING_REQUIRED") {
        missing_required.push(key);
      }
    }
  }

  const score = total_evaluated > 0 ? Math.round((present_count / total_evaluated) * 100) : 100;
  const passed_policy = missing_required.length === 0;

  return {
    score,
    coverage,
    present_count,
    total_evaluated,
    passed_policy,
    missing_required,
  };
}

// ── Action Correlation Helper ───────────────────────────────────────────────

export interface CorrelatedActionTrail {
  action_id: string;
  tool_id?: string;
  step_id?: string;
  action_requested?: SecurityEvent;
  permission_checked?: SecurityEvent;
  approval_requested?: ApprovalEvidence;
  approval_decision?: ApprovalEvidence;
  execution?: {
    status: string;
    decision: string;
  };
  verification?: VerificationEvent;
  timeline: Array<{
    type: string;
    timestamp: string;
    details: string;
  }>;
}

export function correlateActionTrail(
  evidence?: RunEvidence,
  tools?: Array<{ tool_call_id: string; tool_name: string; status: string; step_id?: string }>
): Map<string, CorrelatedActionTrail> {
  const actions = new Map<string, CorrelatedActionTrail>();
  if (!evidence) return actions;

  const getOrCreate = (actionId: string): CorrelatedActionTrail => {
    let item = actions.get(actionId);
    if (!item) {
      item = {
        action_id: actionId,
        timeline: [],
      };
      actions.set(actionId, item);
    }
    return item;
  };

  // 1. Correlate Security Events
  for (const sec of evidence.security_events ?? []) {
    const actionId = sec.action_id ?? `act_${sec.event_id}`;
    const trail = getOrCreate(actionId);
    trail.step_id = trail.step_id ?? sec.step_id;
    trail.tool_id = trail.tool_id ?? sec.tool_id;

    if (sec.event_type === "action.requested") {
      trail.action_requested = sec;
      trail.timeline.push({
        type: sec.event_type,
        timestamp: sec.timestamp,
        details: `Requested action for tool: ${sec.tool_id ?? "unknown"}`,
      });
    } else if (sec.event_type === "permission.checked") {
      trail.permission_checked = sec;
      trail.timeline.push({
        type: sec.event_type,
        timestamp: sec.timestamp,
        details: `Permission checked (${sec.decision}): policy ${sec.policy_id ?? "default"}`,
      });
    } else {
      trail.timeline.push({
        type: sec.event_type,
        timestamp: sec.timestamp,
        details: `Decision: ${sec.decision}${sec.reason_code ? ` [${sec.reason_code}]` : ""}`,
      });
    }
  }

  // 2. Correlate Approval Events
  for (const app of evidence.approval_events ?? []) {
    const actionId = app.action_id ?? `act_app_${app.approval_id}`;
    const trail = getOrCreate(actionId);

    if (app.decision === "PENDING") {
      trail.approval_requested = app;
      trail.timeline.push({
        type: "approval.requested",
        timestamp: app.requested_at,
        details: `Approval requested by ${app.requested_by} for ${app.required_permission_class}`,
      });
    } else {
      trail.approval_decision = app;
      trail.timeline.push({
        type: `approval.${app.decision.toLowerCase()}`,
        timestamp: app.resolved_at ?? app.requested_at,
        details: `Approval ${app.decision} by ${app.resolved_by ?? "system"}${app.reason ? `: ${app.reason}` : ""}`,
      });
    }
  }

  // 3. Correlate Tool Calls
  for (const tc of tools ?? []) {
    for (const trail of actions.values()) {
      if (trail.tool_id === tc.tool_call_id || trail.tool_id === tc.tool_name) {
        trail.execution = {
          status: tc.status,
          decision: tc.status === "completed" ? "EXECUTED" : tc.status,
        };
        trail.timeline.push({
          type: "tool.call",
          timestamp: new Date().toISOString(),
          details: `Tool ${tc.tool_name} executed (${tc.status})`,
        });
      }
    }
  }

  // 4. Correlate Verification Events
  for (const v of evidence.verification_events ?? []) {
    for (const trail of actions.values()) {
      if (v.target_id === trail.action_id || (trail.tool_id && v.target_id === trail.tool_id)) {
        trail.verification = v;
        trail.timeline.push({
          type: v.event_type,
          timestamp: v.completed_at ?? v.started_at ?? new Date().toISOString(),
          details: `Verification: ${v.status} (${v.event_type})`,
        });
      }
    }
  }

  // Sort timeline chronologically
  for (const trail of actions.values()) {
    trail.timeline.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  return actions;
}

// ── Append-Only Verification Sequence Integrity ─────────────────────────────

export interface VerificationSequenceValidation {
  valid: boolean;
  errors: string[];
}

export function validateVerificationSequence(events: VerificationEvent[]): VerificationSequenceValidation {
  const errors: string[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (seenIds.has(e.event_id)) {
      errors.push(`Duplicate verification event_id detected: "${e.event_id}" at index ${i}.`);
    }
    seenIds.add(e.event_id);

    if (e.sequence_index !== i) {
      errors.push(
        `Out-of-order sequence index: expected ${i}, found ${e.sequence_index} on event "${e.event_id}".`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function isAuthoritativeEvidence(
  origin?: EvidenceOrigin,
  authority?: EvidenceAuthority
): boolean {
  if (origin === "agent_asserted") return false;
  return (
    (origin === "externally_observed" || origin === "system_recorded") &&
    authority === "authoritative"
  );
}

interface KnownEvidenceId {
  kind: EvidenceRefKind;
  id: string;
}

function collectKnownEvidenceIds(artifact: RunArtifact): Map<string, KnownEvidenceId> {
  const known = new Map<string, KnownEvidenceId>();
  const add = (kind: EvidenceRefKind, id: string | undefined) => {
    if (!id) return;
    if (!known.has(id)) known.set(id, { kind, id });
  };

  for (const step of artifact.trajectory ?? []) add("step", step.step_id);
  for (const boundary of artifact.boundaries ?? []) add("boundary", boundary.boundary_id);
  for (const tool of artifact.tools ?? []) add("tool", tool.tool_call_id);
  for (const model of artifact.models ?? []) add("model", model.invocation_id);
  for (const artifactRef of artifact.artifacts ?? []) add("artifact", artifactRef.artifact_id);
  for (const evalResult of artifact.evals ?? []) add("eval", evalResult.eval_id);
  for (const snapshot of artifact.state ?? []) add("snapshot", snapshot.snapshot_id);
  for (const handoff of artifact.handoffs ?? []) add("handoff", handoff.handoff_id);

  const evidence = artifact.evidence;
  for (const test of evidence?.test_results ?? []) add("test", test.test_id);
  for (const review of evidence?.review_results ?? []) add("review", review.review_id);
  for (const event of evidence?.verification_events ?? []) add("verification_event", event.event_id);
  return known;
}

function looksLikeRunScopedRef(ref: string, runId: string): "same" | "cross" | "unscoped" {
  const prefixed = /^([A-Za-z0-9._-]+):(.+)$/.exec(ref);
  if (prefixed) {
    return prefixed[1] === runId ? "same" : "cross";
  }
  return "unscoped";
}

function resolveEvidenceRef(
  ref: string,
  runId: string,
  known: Map<string, KnownEvidenceId>,
  seen: Map<string, number>,
  source: string
): EvidenceRefResolution {
  if (!ref || ref.trim().length === 0) {
    return { ref, status: "MALFORMED", source };
  }

  const scoped = looksLikeRunScopedRef(ref, runId);
  if (scoped === "cross") {
    return { ref, status: "CROSS_RUN", source };
  }

  const count = (seen.get(ref) ?? 0) + 1;
  seen.set(ref, count);

  const localId = scoped === "same" ? ref.slice(runId.length + 1) : ref;
  const match = known.get(ref) ?? known.get(localId);
  if (!match) {
    return { ref, status: "MISSING", source };
  }
  if (count > 1) {
    return {
      ref,
      status: "DUPLICATE",
      resolved_kind: match.kind,
      resolved_id: match.id,
      source,
    };
  }
  return {
    ref,
    status: "RESOLVED",
    resolved_kind: match.kind,
    resolved_id: match.id,
    source,
  };
}

/**
 * Validates evidence references and claim/observation authority.
 *
 * Missing or mismatched refs stay unresolved — they never become verified
 * evidence. Agent-asserted passes are classified as claims, not proof.
 */
export function validateEvidenceIntegrity(artifact: RunArtifact): EvidenceIntegrityReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const references: EvidenceRefResolution[] = [];
  const records: ClassifiedEvidenceRecord[] = [];
  const runId = artifact.identity.run_id;
  const known = collectKnownEvidenceIds(artifact);
  const seenRefs = new Map<string, number>();

  const sequence = validateVerificationSequence(artifact.evidence?.verification_events ?? []);
  errors.push(...sequence.errors);

  const considerRefs = (refs: string[] | undefined, source: string) => {
    for (const ref of refs ?? []) {
      const resolution = resolveEvidenceRef(ref, runId, known, seenRefs, source);
      references.push(resolution);
      if (resolution.status === "CROSS_RUN") {
        errors.push(`Evidence ref "${ref}" on ${source} points at another execution.`);
      } else if (resolution.status === "MALFORMED") {
        errors.push(`Malformed evidence ref on ${source}.`);
      } else if (resolution.status === "MISSING") {
        warnings.push(`Evidence ref "${ref}" on ${source} does not resolve in run "${runId}".`);
      }
    }
  };

  let authoritativeVerification = 0;
  let assertedVerification = 0;

  for (const event of artifact.evidence?.verification_events ?? []) {
    if (event.run_id !== runId) {
      errors.push(`Verification event "${event.event_id}" belongs to run "${event.run_id}", not "${runId}".`);
    }
    const origin = event.origin ?? "unverified";
    const authority = event.authority ?? "unverified";
    const authoritative = isAuthoritativeEvidence(origin, authority);
    if (event.status === "PASSED" || event.status === "VERIFIED") {
      if (authoritative) authoritativeVerification += 1;
      else if (origin === "agent_asserted") assertedVerification += 1;
    }
    records.push({
      id: event.event_id,
      kind: event.event_type,
      origin,
      authority,
      status: event.status,
      authoritative,
    });
    considerRefs(event.evidence_refs, `verification:${event.event_id}`);
    considerRefs(event.artifact_refs, `verification:${event.event_id}:artifact`);
  }

  for (const test of artifact.evidence?.test_results ?? []) {
    if (test.run_id !== runId) {
      errors.push(`Test result "${test.test_id}" belongs to run "${test.run_id}", not "${runId}".`);
    }
    const origin = test.origin ?? "unverified";
    const authority = test.authority ?? "unverified";
    records.push({
      id: test.test_id,
      kind: "test_result",
      origin,
      authority,
      status: test.status,
      authoritative: isAuthoritativeEvidence(origin, authority),
    });
    considerRefs(test.artifact_refs, `test:${test.test_id}`);
  }

  for (const review of artifact.evidence?.review_results ?? []) {
    if (review.run_id !== runId) {
      errors.push(`Review "${review.review_id}" belongs to run "${review.run_id}", not "${runId}".`);
    }
    considerRefs(review.evidence_refs, `review:${review.review_id}`);
    considerRefs(review.artifact_refs, `review:${review.review_id}:artifact`);
  }

  for (const evalResult of artifact.evals ?? []) {
    const meta = (evalResult as { metadata?: Record<string, unknown> }).metadata;
    const origin = (meta?.["origin"] as EvidenceOrigin | undefined) ?? "unverified";
    const authority = (meta?.["authority"] as EvidenceAuthority | undefined) ?? "unverified";
    const authoritative = isAuthoritativeEvidence(origin, authority);
    records.push({
      id: evalResult.eval_id,
      kind: "eval_result",
      origin,
      authority,
      status: evalResult.passed ? "PASSED" : "FAILED",
      authoritative,
    });
    if (evalResult.passed && origin === "agent_asserted") {
      assertedVerification += 1;
      warnings.push(
        `Eval "${evalResult.eval_id}" is agent-asserted and is not authoritative verification.`
      );
    }
    considerRefs(evalResult.evidence_references, `eval:${evalResult.eval_id}`);
  }

  for (const handoff of artifact.handoffs ?? []) {
    if (handoff.run_id !== runId) {
      errors.push(`Handoff "${handoff.handoff_id}" belongs to run "${handoff.run_id}", not "${runId}".`);
    }
    considerRefs(handoff.evidence_refs, `handoff:${handoff.handoff_id}`);
    considerRefs(handoff.artifact_refs, `handoff:${handoff.handoff_id}:artifact`);
  }

  const declaredPass = artifact.evidence?.final_outcome?.verification_status === "PASS";
  const outcomeAuthoritative = declaredPass && authoritativeVerification > 0;
  if (declaredPass && !outcomeAuthoritative) {
    warnings.push(
      "Declared verification_status PASS is not backed by authoritative observed or system-recorded evidence."
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    references,
    records,
    authoritative_verification_count: authoritativeVerification,
    asserted_only_verification_count: assertedVerification,
    outcome_authoritative: outcomeAuthoritative,
  };
}
