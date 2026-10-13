/**
 * Policy Drift Detection Engine.
 *
 * Distinguishes:
 * - DECLARED_POLICY_CHANGE (intentional declared policy updates)
 * - BEHAVIORAL_POLICY_CHANGE (unannounced permission behavior shift: DENY -> ALLOW)
 * - PERMISSION_EXPANSION (sensitive new tools or access)
 * - APPROVAL_BEHAVIOR_CHANGE (human approval required -> automatic execution)
 * - SIDE_EFFECT_BEHAVIOR_CHANGE (unauthorized execution of blocked side effects)
 *
 * Invariant:
 * - Explicit baseline required. Never infer drift across unrelated runs without baseline.
 */

import {
  type PolicyBehaviorSnapshot,
  type PolicyDriftReport,
  type PolicyDriftFinding,
  policyDriftReportSchema,
  policyDriftFindingSchema,
} from "../contracts/policyDrift";
import { savePolicyDriftReport } from "./persistence";

export interface DetectPolicyDriftOptions {
  reportId?: string;
  baselineSnapshot: PolicyBehaviorSnapshot;
  candidateSnapshot: PolicyBehaviorSnapshot;
  persist?: boolean;
}

export class PolicyDriftDetector {
  /**
   * Evaluates candidate policy behavior against an explicit baseline snapshot.
   */
  static async detect(options: DetectPolicyDriftOptions): Promise<PolicyDriftReport> {
    const { baselineSnapshot, candidateSnapshot, persist } = options;
    const reportId =
      options.reportId ??
      `poldrift_${baselineSnapshot.policy_id}_${baselineSnapshot.run_id}_to_${candidateSnapshot.run_id}_${Date.now()}`;

    const findings: PolicyDriftFinding[] = [];
    let hasCritical = false;

    const versionChanged =
      candidateSnapshot.policy_version !== baselineSnapshot.policy_version;

    // 1. Declared policy changes
    if (versionChanged) {
      const addedPerms = candidateSnapshot.declared_permissions.filter(
        (p) => !baselineSnapshot.declared_permissions.includes(p)
      );
      const removedPerms = baselineSnapshot.declared_permissions.filter(
        (p) => !candidateSnapshot.declared_permissions.includes(p)
      );

      findings.push(
        policyDriftFindingSchema.parse({
          finding_id: `pfind_decl_ver_${Date.now()}`,
          drift_type: "DECLARED_POLICY_CHANGE",
          severity: "INFO",
          description: `Policy declared version updated from v${baselineSnapshot.policy_version} to v${candidateSnapshot.policy_version}.${addedPerms.length > 0 ? ` Added permissions: ${addedPerms.join(", ")}.` : ""}${removedPerms.length > 0 ? ` Removed permissions: ${removedPerms.join(", ")}.` : ""}`,
          baseline_state: { version: baselineSnapshot.policy_version, permissions: baselineSnapshot.declared_permissions },
          candidate_state: { version: candidateSnapshot.policy_version, permissions: candidateSnapshot.declared_permissions },
          action_or_tool: "policy_version",
          is_declared: true,
        })
      );
    }

    // 2. Behavioral Policy Change: Baseline DENY -> Candidate ALLOW
    const baseDenies = new Set(baselineSnapshot.denies);
    const candAllows = new Set(candidateSnapshot.allows);

    for (const deniedAction of baseDenies) {
      if (candAllows.has(deniedAction)) {
        hasCritical = true;
        findings.push(
          policyDriftFindingSchema.parse({
            finding_id: `pfind_beh_deny_allow_${deniedAction}_${Date.now()}`,
            drift_type: "BEHAVIORAL_POLICY_CHANGE",
            severity: "CRITICAL",
            description: `Behavioral policy shift: Action "${deniedAction}" was DENIED under baseline, but was ALLOWED in candidate execution.`,
            baseline_state: "DENY",
            candidate_state: "ALLOW",
            action_or_tool: deniedAction,
            is_declared: false,
          })
        );
      }
    }

    // 3. Permission Expansion (new tools or accesses)
    const basePerms = new Set(baselineSnapshot.declared_permissions);
    const candPerms = candidateSnapshot.declared_permissions;

    for (const perm of candPerms) {
      if (!basePerms.has(perm)) {
        const isSensitive =
          perm.includes("delete") ||
          perm.includes("write") ||
          perm.includes("drop") ||
          perm.includes("admin");

        if (isSensitive) hasCritical = true;

        findings.push(
          policyDriftFindingSchema.parse({
            finding_id: `pfind_perm_exp_${perm}_${Date.now()}`,
            drift_type: "PERMISSION_EXPANSION",
            severity: isSensitive ? "CRITICAL" : "WARNING",
            description: `Permission set expansion: Tool/permission "${perm}" added to candidate capability.${isSensitive ? " [CRITICAL SENSITIVE TOOL]" : ""}`,
            baseline_state: "NOT_GRANTED",
            candidate_state: "GRANTED",
            action_or_tool: perm,
            is_declared: versionChanged,
          })
        );
      }
    }

    // 3b. Undeclared or unannounced sensitive tool execution in candidate
    const baseSensitive = new Set(baselineSnapshot.sensitive_tool_accesses);
    for (const sensTool of candidateSnapshot.sensitive_tool_accesses) {
      if (!baseSensitive.has(sensTool)) {
        hasCritical = true;
        findings.push(
          policyDriftFindingSchema.parse({
            finding_id: `pfind_sens_access_${sensTool}_${Date.now()}`,
            drift_type: "PERMISSION_EXPANSION",
            severity: "CRITICAL",
            description: `Unauthorized / unannounced sensitive tool execution: "${sensTool}" was executed by candidate but was never accessed in baseline.`,
            baseline_state: "NEVER_ACCESSED",
            candidate_state: "EXECUTED_SENSITIVE",
            action_or_tool: sensTool,
            is_declared: false,
          })
        );
      }
    }

    // 4. Permission Restriction
    for (const perm of baselineSnapshot.declared_permissions) {
      if (!candidateSnapshot.declared_permissions.includes(perm)) {
        findings.push(
          policyDriftFindingSchema.parse({
            finding_id: `pfind_perm_restr_${perm}_${Date.now()}`,
            drift_type: "PERMISSION_RESTRICTION",
            severity: "INFO",
            description: `Permission restricted: Tool/permission "${perm}" was present in baseline but removed from candidate.`,
            baseline_state: "GRANTED",
            candidate_state: "NOT_GRANTED",
            action_or_tool: perm,
            is_declared: versionChanged,
          })
        );
      }
    }

    // 5. Approval Behavior Change (Approval required in baseline -> bypassed or automatic in candidate)
    const baseApprovalRequired = new Set(baselineSnapshot.approval_required);
    for (const act of baseApprovalRequired) {
      const candidateRequired = candidateSnapshot.approval_required.includes(act);
      const candidateBypassed = candidateSnapshot.bypasses.includes(act);

      if (!candidateRequired || candidateBypassed) {
        hasCritical = true;
        findings.push(
          policyDriftFindingSchema.parse({
            finding_id: `pfind_app_drift_${act}_${Date.now()}`,
            drift_type: "APPROVAL_BEHAVIOR_CHANGE",
            severity: "CRITICAL",
            description: `Approval compliance degradation: Action "${act}" required explicit approval in baseline, but was executed without approval or bypassed in candidate.`,
            baseline_state: "APPROVAL_REQUIRED",
            candidate_state: candidateBypassed ? "BYPASS" : "AUTOMATIC_EXECUTION",
            action_or_tool: act,
            is_declared: false,
          })
        );
      }
    }

    // 6. Blocked Side Effects Drift
    for (const sideEffect of baselineSnapshot.blocked_side_effects) {
      if (candidateSnapshot.allows.includes(sideEffect)) {
        hasCritical = true;
        findings.push(
          policyDriftFindingSchema.parse({
            finding_id: `pfind_side_effect_${sideEffect}_${Date.now()}`,
            drift_type: "SIDE_EFFECT_BEHAVIOR_CHANGE",
            severity: "CRITICAL",
            description: `Side-effect guardrail bypassed: Side effect "${sideEffect}" was blocked in baseline but executed in candidate.`,
            baseline_state: "BLOCKED",
            candidate_state: "EXECUTED",
            action_or_tool: sideEffect,
            is_declared: false,
          })
        );
      }
    }

    const summary =
      findings.length === 0
        ? "No policy or permission drift detected between candidate and baseline."
        : `Policy drift detected: ${findings.length} finding(s) (${findings.filter((f) => f.severity === "CRITICAL").length} critical).`;

    const report: PolicyDriftReport = policyDriftReportSchema.parse({
      drift_report_id: reportId,
      baseline_snapshot_id: baselineSnapshot.policy_snapshot_id,
      candidate_snapshot_id: candidateSnapshot.policy_snapshot_id,
      baseline_run_id: baselineSnapshot.run_id,
      candidate_run_id: candidateSnapshot.run_id,
      declared_version_delta: {
        baseline: baselineSnapshot.policy_version,
        candidate: candidateSnapshot.policy_version,
        changed: versionChanged,
      },
      drift_findings: findings,
      findings,
      has_critical_drift: hasCritical,
      summary,
      created_at: new Date().toISOString(),
    });

    if (persist !== false) {
      await savePolicyDriftReport(report);
    }

    return report;
  }
}
