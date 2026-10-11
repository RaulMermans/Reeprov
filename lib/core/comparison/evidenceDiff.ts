/**
 * Run Evidence Diff Engine.
 *
 * Compares plans, tests, reviews, verifications, approvals, security events,
 * and artifacts across executions.
 */

import type {
  PlanEvidence,
  TestResult,
  ReviewResult,
  VerificationEvent,
  ApprovalEvidence,
  SecurityEvent,
  RunEvidence,
  RunOutcome,
} from "../contracts/evidence";
import type {
  PlanDiff,
  PlanItemChange,
  TestDiff,
  ReviewDiff,
  ReviewFindingDiff,
  VerificationEventDiff,
  SecurityDiff,
  ArtifactDiff,
  EvidenceDiff,
  OutcomeDiff,
} from "../contracts/comparison";
import type { ArtifactReference } from "../contracts/artifacts";

export function diffPlanEvidence(
  baselinePlan?: PlanEvidence,
  candidatePlan?: PlanEvidence
): PlanDiff | undefined {
  if (!baselinePlan && !candidatePlan) return undefined;

  const planAdded = !baselinePlan && Boolean(candidatePlan);
  const planRemoved = Boolean(baselinePlan) && !candidatePlan;

  if (planAdded) {
    return {
      plan_added: true,
      plan_removed: false,
      status_changed: true,
      after_status: candidatePlan!.status,
      changes: (candidatePlan!.items ?? []).map((item) => ({
        item_id: item.id,
        change_type: "PLAN_ITEM_ADDED",
        after_status: item.status,
        after_description: item.description,
      })),
    };
  }

  if (planRemoved) {
    return {
      plan_added: false,
      plan_removed: true,
      status_changed: true,
      before_status: baselinePlan!.status,
      changes: (baselinePlan!.items ?? []).map((item) => ({
        item_id: item.id,
        change_type: "PLAN_ITEM_REMOVED",
        before_status: item.status,
        before_description: item.description,
      })),
    };
  }

  const baseItems = baselinePlan!.items ?? [];
  const candItems = candidatePlan!.items ?? [];

  const baseMap = new Map(baseItems.map((it, idx) => [it.id, { it, idx }]));
  const candMap = new Map(candItems.map((it, idx) => [it.id, { it, idx }]));

  const changes: PlanItemChange[] = [];

  for (const [id, c] of candMap.entries()) {
    const b = baseMap.get(id);
    if (!b) {
      changes.push({
        item_id: id,
        change_type: "PLAN_ITEM_ADDED",
        after_status: c.it.status,
        after_description: c.it.description,
      });
    } else {
      if (b.it.status !== c.it.status) {
        changes.push({
          item_id: id,
          change_type: "PLAN_STATUS_CHANGED",
          before_status: b.it.status,
          after_status: c.it.status,
          before_description: b.it.description,
          after_description: c.it.description,
        });
      }
      if (b.it.description !== c.it.description) {
        changes.push({
          item_id: id,
          change_type: "PLAN_ITEM_CHANGED",
          before_status: b.it.status,
          after_status: c.it.status,
          before_description: b.it.description,
          after_description: c.it.description,
        });
      }
      if (b.idx !== c.idx) {
        changes.push({
          item_id: id,
          change_type: "PLAN_ORDER_CHANGED",
          before_status: b.it.status,
          after_status: c.it.status,
        });
      }
    }
  }

  for (const [id, b] of baseMap.entries()) {
    if (!candMap.has(id)) {
      changes.push({
        item_id: id,
        change_type: "PLAN_ITEM_REMOVED",
        before_status: b.it.status,
        before_description: b.it.description,
      });
    }
  }

  const statusChanged = baselinePlan!.status !== candidatePlan!.status;

  return {
    plan_added: false,
    plan_removed: false,
    status_changed: statusChanged,
    before_status: baselinePlan!.status,
    after_status: candidatePlan!.status,
    changes,
  };
}

export function diffTestResults(
  baselineTests: TestResult[] = [],
  candidateTests: TestResult[] = []
): TestDiff[] {
  const diffs: TestDiff[] = [];

  const baseMap = new Map(baselineTests.map((t) => [t.test_id || `${t.suite}:${t.name}`, t]));
  const candMap = new Map(candidateTests.map((t) => [t.test_id || `${t.suite}:${t.name}`, t]));

  for (const [key, c] of candMap.entries()) {
    const b = baseMap.get(key);
    if (!b) {
      diffs.push({
        test_id: c.test_id,
        suite: c.suite,
        name: c.name,
        change_type: "TEST_ADDED",
        after_status: c.status,
        duration_delta_ms: c.duration_ms,
        failure_message_after: c.failure_message,
      });
    } else {
      if (b.status !== c.status) {
        diffs.push({
          test_id: c.test_id,
          suite: c.suite,
          name: c.name,
          change_type: "TEST_STATUS_CHANGED",
          before_status: b.status,
          after_status: c.status,
          duration_delta_ms:
            typeof c.duration_ms === "number" && typeof b.duration_ms === "number"
              ? c.duration_ms - b.duration_ms
              : undefined,
          failure_message_before: b.failure_message,
          failure_message_after: c.failure_message,
        });
      } else if (
        typeof c.duration_ms === "number" &&
        typeof b.duration_ms === "number" &&
        Math.abs(c.duration_ms - b.duration_ms) > 100
      ) {
        diffs.push({
          test_id: c.test_id,
          suite: c.suite,
          name: c.name,
          change_type: "TEST_DURATION_DELTA",
          before_status: b.status,
          after_status: c.status,
          duration_delta_ms: c.duration_ms - b.duration_ms,
        });
      }
    }
  }

  for (const [key, b] of baseMap.entries()) {
    if (!candMap.has(key)) {
      diffs.push({
        test_id: b.test_id,
        suite: b.suite,
        name: b.name,
        change_type: "TEST_REMOVED",
        before_status: b.status,
        failure_message_before: b.failure_message,
      });
    }
  }

  return diffs;
}

export function diffReviewResults(
  baselineReviews: ReviewResult[] = [],
  candidateReviews: ReviewResult[] = []
): ReviewDiff[] {
  const diffs: ReviewDiff[] = [];

  const baseMap = new Map(baselineReviews.map((r) => [r.review_id || `${r.reviewer}:${r.review_type}`, r]));
  const candMap = new Map(candidateReviews.map((r) => [r.review_id || `${r.reviewer}:${r.review_type}`, r]));

  for (const [key, c] of candMap.entries()) {
    const b = baseMap.get(key);
    if (!b) {
      diffs.push({
        review_id: c.review_id,
        reviewer: c.reviewer,
        review_type: c.review_type,
        change_type: "REVIEW_ADDED",
        after_status: c.status,
        findings_delta: c.findings?.length ?? 0,
        findings_diff: (c.findings ?? []).map((f) => ({
          severity: f.severity,
          category: f.category,
          message: f.message,
          change_type: "FINDING_ADDED",
        })),
      });
    } else {
      const statusChanged = b.status !== c.status;
      const bFindings = b.findings ?? [];
      const cFindings = c.findings ?? [];
      const findingsDelta = cFindings.length - bFindings.length;

      const findingsDiff: ReviewFindingDiff[] = [];
      const bFindingKeys = new Set(bFindings.map((f) => `${f.category}:${f.message}`));
      const cFindingKeys = new Set(cFindings.map((f) => `${f.category}:${f.message}`));

      for (const cf of cFindings) {
        if (!bFindingKeys.has(`${cf.category}:${cf.message}`)) {
          findingsDiff.push({
            severity: cf.severity,
            category: cf.category,
            message: cf.message,
            change_type: "FINDING_ADDED",
          });
        }
      }

      for (const bf of bFindings) {
        if (!cFindingKeys.has(`${bf.category}:${bf.message}`)) {
          findingsDiff.push({
            severity: bf.severity,
            category: bf.category,
            message: bf.message,
            change_type: "FINDING_REMOVED",
          });
        }
      }

      if (statusChanged || findingsDiff.length > 0) {
        diffs.push({
          review_id: c.review_id,
          reviewer: c.reviewer,
          review_type: c.review_type,
          change_type: statusChanged ? "REVIEW_STATUS_CHANGED" : "FINDINGS_CHANGED",
          before_status: b.status,
          after_status: c.status,
          findings_delta: findingsDelta,
          findings_diff: findingsDiff,
        });
      }
    }
  }

  for (const [key, b] of baseMap.entries()) {
    if (!candMap.has(key)) {
      diffs.push({
        review_id: b.review_id,
        reviewer: b.reviewer,
        review_type: b.review_type,
        change_type: "REVIEW_REMOVED",
        before_status: b.status,
        findings_delta: -(b.findings?.length ?? 0),
        findings_diff: (b.findings ?? []).map((f) => ({
          severity: f.severity,
          category: f.category,
          message: f.message,
          change_type: "FINDING_REMOVED",
        })),
      });
    }
  }

  return diffs;
}

export function diffVerificationEvents(
  baselineEvents: VerificationEvent[] = [],
  candidateEvents: VerificationEvent[] = []
): VerificationEventDiff[] {
  const diffs: VerificationEventDiff[] = [];

  const baseMap = new Map(baselineEvents.map((e) => [e.event_id || `${e.event_type}:${e.target_type}:${e.target_id}`, e]));
  const candMap = new Map(candidateEvents.map((e) => [e.event_id || `${e.event_type}:${e.target_type}:${e.target_id}`, e]));

  for (const [key, c] of candMap.entries()) {
    const b = baseMap.get(key);
    if (!b) {
      diffs.push({
        event_id: c.event_id,
        event_type: c.event_type,
        target_type: c.target_type,
        target_id: c.target_id,
        change_type: "VERIFICATION_ADDED",
        after_status: c.status,
      });
    } else if (b.status !== c.status) {
      diffs.push({
        event_id: c.event_id,
        event_type: c.event_type,
        target_type: c.target_type,
        target_id: c.target_id,
        change_type: "VERIFICATION_CHANGED",
        before_status: b.status,
        after_status: c.status,
      });
    }
  }

  for (const [key, b] of baseMap.entries()) {
    if (!candMap.has(key)) {
      diffs.push({
        event_id: b.event_id,
        event_type: b.event_type,
        target_type: b.target_type,
        target_id: b.target_id,
        change_type: "VERIFICATION_REMOVED",
        before_status: b.status,
      });
    }
  }

  return diffs;
}

export function diffSecurityAndApprovals(
  baseSec: SecurityEvent[] = [],
  candSec: SecurityEvent[] = [],
  baseAppr: ApprovalEvidence[] = [],
  candAppr: ApprovalEvidence[] = []
): SecurityDiff[] {
  const diffs: SecurityDiff[] = [];

  // Security Events: match by action_id or tool_id or event_id
  const baseSecMap = new Map(baseSec.map((s) => [s.action_id || s.event_id || `${s.tool_id}:${s.event_type}`, s]));
  const candSecMap = new Map(candSec.map((s) => [s.action_id || s.event_id || `${s.tool_id}:${s.event_type}`, s]));

  for (const [key, c] of candSecMap.entries()) {
    const b = baseSecMap.get(key);
    if (!b) {
      diffs.push({
        event_id: c.event_id,
        action_id: c.action_id,
        tool_id: c.tool_id,
        change_type: c.decision === "DENY" || c.decision === "BLOCKED" ? "SECURITY_VIOLATION_ADDED" : "ACTION_ADDED",
        after_decision: c.decision,
        severity: c.decision === "DENY" || c.decision === "BLOCKED" ? "critical" : "info",
        details: { event_type: c.event_type, reason_code: c.reason_code },
      });
    } else if (b.decision !== c.decision) {
      diffs.push({
        event_id: c.event_id,
        action_id: c.action_id,
        tool_id: c.tool_id,
        change_type: "PERMISSION_DECISION_CHANGED",
        before_decision: b.decision,
        after_decision: c.decision,
        severity: c.decision === "DENY" || c.decision === "BLOCKED" ? "critical" : "warning",
        details: {
          event_type: c.event_type,
          before_reason: b.reason_code,
          after_reason: c.reason_code,
        },
      });
    }
  }

  for (const [key, b] of baseSecMap.entries()) {
    if (!candSecMap.has(key)) {
      diffs.push({
        event_id: b.event_id,
        action_id: b.action_id,
        tool_id: b.tool_id,
        change_type: b.decision === "DENY" || b.decision === "BLOCKED" ? "SECURITY_VIOLATION_REMOVED" : "ACTION_REMOVED",
        before_decision: b.decision,
        severity: "info",
        details: { event_type: b.event_type },
      });
    }
  }

  // Approvals: match by approval_id or action_id
  const baseApprMap = new Map(baseAppr.map((a) => [a.approval_id || a.action_id || "appr", a]));
  const candApprMap = new Map(candAppr.map((a) => [a.approval_id || a.action_id || "appr", a]));

  for (const [key, c] of candApprMap.entries()) {
    const b = baseApprMap.get(key);
    if (!b) {
      diffs.push({
        action_id: c.action_id,
        change_type: "APPROVAL_REQUIREMENT_CHANGED",
        after_decision: c.decision,
        severity: "info",
        details: { approval_id: c.approval_id, required_class: c.required_permission_class },
      });
    } else if (b.decision !== c.decision) {
      diffs.push({
        action_id: c.action_id,
        change_type: "APPROVAL_RESULT_CHANGED",
        before_decision: b.decision,
        after_decision: c.decision,
        severity: c.decision === "REJECTED" ? "critical" : "info",
        details: { approval_id: c.approval_id, reason: c.reason },
      });
    }
  }

  return diffs;
}

export function diffArtifacts(
  baseArts: ArtifactReference[] = [],
  candArts: ArtifactReference[] = []
): ArtifactDiff[] {
  const diffs: ArtifactDiff[] = [];

  const baseMap = new Map(baseArts.map((a) => [a.name, a]));
  const candMap = new Map(candArts.map((a) => [a.name, a]));

  for (const [name, c] of candMap.entries()) {
    const b = baseMap.get(name);
    if (!b) {
      diffs.push({
        name,
        change_type: "ARTIFACT_ADDED",
        after_uri: c.uri,
        after_hash: c.hash,
      });
    } else if (b.hash && c.hash && b.hash !== c.hash) {
      diffs.push({
        name,
        change_type: "ARTIFACT_HASH_CHANGED",
        before_uri: b.uri,
        after_uri: c.uri,
        before_hash: b.hash,
        after_hash: c.hash,
      });
    } else if (b.uri !== c.uri) {
      diffs.push({
        name,
        change_type: "ARTIFACT_MODIFIED",
        before_uri: b.uri,
        after_uri: c.uri,
      });
    }
  }

  for (const [name, b] of baseMap.entries()) {
    if (!candMap.has(name)) {
      diffs.push({
        name,
        change_type: "ARTIFACT_REMOVED",
        before_uri: b.uri,
        before_hash: b.hash,
      });
    }
  }

  return diffs;
}

export function diffRunOutcomes(
  baseOutcome?: RunOutcome,
  candOutcome?: RunOutcome
): OutcomeDiff {
  const baseStatus = baseOutcome?.status ?? "UNKNOWN";
  const candStatus = candOutcome?.status ?? "UNKNOWN";
  const statusChanged = baseStatus !== candStatus;

  return {
    baseline_status: baseStatus,
    candidate_status: candStatus,
    status_changed: statusChanged,
    baseline_verification_status: baseOutcome?.verification_status,
    candidate_verification_status: candOutcome?.verification_status,
    summary: candOutcome?.summary ?? baseOutcome?.summary,
    reason_code_changed: baseOutcome?.reason_code !== candOutcome?.reason_code,
    baseline_reason_code: baseOutcome?.reason_code,
    candidate_reason_code: candOutcome?.reason_code,
  };
}

export function diffEvidencePlane(
  baseEvidence?: RunEvidence,
  candEvidence?: RunEvidence,
  baseArtifacts?: ArtifactReference[],
  candArtifacts?: ArtifactReference[]
): EvidenceDiff {
  return {
    plan_diff: diffPlanEvidence(baseEvidence?.plan, candEvidence?.plan),
    test_diffs: diffTestResults(baseEvidence?.test_results, candEvidence?.test_results),
    review_diffs: diffReviewResults(baseEvidence?.review_results, candEvidence?.review_results),
    verification_diffs: diffVerificationEvents(baseEvidence?.verification_events, candEvidence?.verification_events),
    security_diffs: diffSecurityAndApprovals(
      baseEvidence?.security_events,
      candEvidence?.security_events,
      baseEvidence?.approval_events,
      candEvidence?.approval_events
    ),
    artifact_diffs: diffArtifacts(baseArtifacts, candArtifacts),
  };
}
