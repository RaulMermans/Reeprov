/**
 * Policy Behavior Snapshot Engine.
 *
 * Captures observable policy and permission decisions during agent execution:
 * - Observed policy checks (allows, denies, approvals, bypasses)
 * - Sensitive tool invocations (write, delete, mutate)
 * - Declared tool permissions vs runtime tool interactions
 */

import {
  type PolicyBehaviorSnapshot,
  policyBehaviorSnapshotSchema,
} from "../contracts/policyDrift";
import type { RunArtifact } from "../contracts/runArtifact";
import { savePolicyBehaviorSnapshot } from "./persistence";

export interface CreatePolicySnapshotOptions {
  snapshotId?: string;
  projectId: string;
  runArtifact: RunArtifact;
  policyId?: string;
  policyVersion?: number;
  declaredPermissions?: string[];
  persist?: boolean;
}

export class PolicySnapshotEngine {
  /**
   * Captures a PolicyBehaviorSnapshot from a completed RunArtifact.
   */
  static async captureSnapshot(
    options: CreatePolicySnapshotOptions
  ): Promise<PolicyBehaviorSnapshot> {
    const { runArtifact, projectId, persist } = options;
    const runId = runArtifact.identity.run_id;

    const policyId =
      options.policyId ??
      "default_governance_policy";
    const policyVersion =
      options.policyVersion ?? 1;

    const snapshotId =
      options.snapshotId ??
      `polsnap_${runId}_${policyId}@v${policyVersion}_${Date.now()}`;

    const configHash = runArtifact.configuration_snapshot?.config_hash || "config_initial";

    // Extract tool calls from trajectory and boundaries
    const actionsObserved: string[] = [];
    const allows: string[] = [];
    const denies: string[] = [];
    const approvalRequired: string[] = [];
    const approvalGranted: string[] = [];
    const approvalRejected: string[] = [];
    const blockedSideEffects: string[] = [];
    const violations: string[] = [];
    const bypasses: string[] = [];
    const sensitiveToolAccesses: string[] = [];

    // Declared permissions from tools
    const declaredPermissions: string[] = options.declaredPermissions ?? [];
    if (runArtifact.configuration_snapshot?.tools) {
      for (const t of runArtifact.configuration_snapshot.tools) {
        if (typeof t === "string") declaredPermissions.push(t);
        else if (t && typeof (t as any).name === "string") declaredPermissions.push((t as any).name);
      }
    }

    // Inspect policy events in verification / security events
    const secEvents = runArtifact.evidence?.security_events ?? [];
    for (const evt of secEvents) {
      const act = evt.action_id ?? evt.tool_id ?? evt.event_type;
      actionsObserved.push(act);
      if (evt.decision === "DENY" || evt.decision === "BLOCKED") {
        denies.push(act);
        blockedSideEffects.push(act);
      } else if (evt.decision === "ALLOW") {
        allows.push(act);
      } else if (evt.decision === "REQUIRE_APPROVAL") {
        approvalRequired.push(act);
      }
    }

    // Inspect approval events
    const appEvents = runArtifact.evidence?.approval_events ?? [];
    for (const app of appEvents) {
      const act = app.action_id ?? app.required_permission_class;
      actionsObserved.push(act);
      approvalRequired.push(act);
      if (app.decision === "GRANTED") {
        approvalGranted.push(act);
      } else if (app.decision === "REJECTED") {
        approvalRejected.push(act);
        denies.push(act);
      }
    }

    // Inspect tools executed during run
    for (const tool of runArtifact.tools) {
      const toolName = tool.tool_name;
      actionsObserved.push(toolName);

      const isSensitive =
        toolName.includes("delete") ||
        toolName.includes("write") ||
        toolName.includes("drop") ||
        toolName.includes("execute") ||
        toolName.includes("admin");

      if (isSensitive) {
        sensitiveToolAccesses.push(toolName);
      }

      if ((tool.status === "failed" || tool.status === "blocked") && tool.error?.toLowerCase().includes("denied")) {
        denies.push(toolName);
      } else {
        allows.push(toolName);
      }
    }

    const snapshot: PolicyBehaviorSnapshot = policyBehaviorSnapshotSchema.parse({
      policy_snapshot_id: snapshotId,
      project_id: projectId,
      run_id: runId,
      policy_id: policyId,
      policy_version: policyVersion,
      configuration_hash: configHash,
      actions_observed: Array.from(new Set(actionsObserved)),
      allows: Array.from(new Set(allows)),
      denies: Array.from(new Set(denies)),
      approval_required: Array.from(new Set(approvalRequired)),
      approval_granted: Array.from(new Set(approvalGranted)),
      approval_rejected: Array.from(new Set(approvalRejected)),
      blocked_side_effects: Array.from(new Set(blockedSideEffects)),
      violations: Array.from(new Set(violations)),
      bypasses: Array.from(new Set(bypasses)),
      sensitive_tool_accesses: Array.from(new Set(sensitiveToolAccesses)),
      declared_permissions: Array.from(new Set(declaredPermissions)),
      captured_at: new Date().toISOString(),
    });

    if (persist !== false) {
      await savePolicyBehaviorSnapshot(snapshot);
    }

    return snapshot;
  }
}
