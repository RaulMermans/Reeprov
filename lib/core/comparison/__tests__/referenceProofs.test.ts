import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runArtifactSchema, type RunArtifact } from "../../contracts/runArtifact";
import { compareRuns } from "../comparator";

describe("AgentPulse Sprint 6: Canonical Reference Proofs", () => {
  // ── Reference Proof #1: Sprint 4 Controlled Balance Fork ──────────────────
  it("Reference Proof #1: Controlled Balance Fork (150 -> 300 USD) exhibits isolated mutation and downstream consequences", async () => {
    const parentPath = path.resolve(
      process.cwd(),
      "tests/fixtures/canonical/fixture-h-vertical-slice.json"
    );
    const parent: RunArtifact = runArtifactSchema.parse(
      JSON.parse(fs.readFileSync(parentPath, "utf8"))
    );

    // Create child fork at step 1 with tool_result_override balance: 300
    const child: RunArtifact = JSON.parse(JSON.stringify(parent));
    child.identity.run_id = "run_fork_balance_300";
    child.lineage = {
      parent_run_id: parent.identity.run_id,
      root_run_id: parent.identity.run_id,
      depth: 1,
      fork_checkpoint: {
        checkpoint_id: "chk_parent_step_1",
        step_id: parent.trajectory[1]?.step_id,
      },
      mutations: [
        {
          mutation_id: "mut_bal_300",
          type: "tool_result_override",
          target_identifier: "get_customer_account",
          mutated_value: { balance: 300 },
          description: "Balance override to 300 USD",
        },
      ],
    };

    // Update parent and child state to reflect balance change from 150 -> 300
    if (parent.state[0]) {
      parent.state[0].state_data = {
        customer: { id: "cus_1001", balance: 150, status: "vip" },
      };
    }
    if (child.state[0]) {
      child.state[0].state_data = {
        customer: { id: "cus_1001", balance: 300, status: "vip" },
      };
    }

    // Update child tool output for get_customer_account
    const childToolBnd = child.boundaries.find((b) => b.name === "get_customer_account");
    if (childToolBnd) {
      childToolBnd.output.content = JSON.stringify({ customerId: "cus_1001", balance: 300, currency: "USD", status: "active" });
      childToolBnd.output.hash = "hash_bal_300";
    }
    const childTool = child.tools.find((t) => t.tool_name === "get_customer_account");
    if (childTool) {
      childTool.output = { customerId: "cus_1001", balance: 300, currency: "USD", status: "active" };
    }

    const comparison = await compareRuns(parent, child, { enableSemantic: true });

    // 1. Relationship is recognized as parent -> child
    expect(comparison.relationship).toBe("PARENT_CHILD");

    // 2. Lineage views materialized without mutation
    expect(
      comparison.execution_alignment.materialized_candidate.segments.some(
        (s) => s.segment_type === "HISTORICAL_SHARED"
      )
    ).toBe(true);

    // 3. First meaningful divergence is identified and tagged as CONTROLLED_MUTATION
    expect(comparison.first_meaningful_divergence).toBeDefined();
    expect(comparison.first_meaningful_divergence?.causal_status).toBe("CONTROLLED_MUTATION");
    expect(comparison.first_meaningful_divergence?.origin_mutation_id).toBe("mut_bal_300");

    // 4. Downstream state change exists
    expect(comparison.state_diffs.length).toBeGreaterThan(0);
    const balStateChange = comparison.state_diffs[0]?.changes.find(
      (c) => c.path === "/customer/balance"
    );
    expect(balStateChange).toBeDefined();
    expect(balStateChange?.before).toBe(150);
    expect(balStateChange?.after).toBe(300);
  });

  // ── Reference Proof #2: Sprint 5 Prompt Configuration Fork ────────────────
  it("Reference Proof #2: Prompt Configuration Fork (support@7 -> support@8) isolated and diffed cleanly", async () => {
    const parentPath = path.resolve(
      process.cwd(),
      "tests/fixtures/canonical/fixture-h-vertical-slice.json"
    );
    const parent: RunArtifact = runArtifactSchema.parse(
      JSON.parse(fs.readFileSync(parentPath, "utf8"))
    );

    parent.configuration_snapshot = {
      agent: { id: "customer-support-agent", version: "1.0.0" },
      model: { provider: "openai", model_id: "gpt-4o", parameters: { temperature: 0.2 } },
      prompts: { support: { template: "Handle customer queries v7", version: "support@7" } },
      skills: {},
      tools: {},
      permissions: {},
      workflow: {},
      runtime_config: {},
    };

    const child: RunArtifact = JSON.parse(JSON.stringify(parent));
    child.identity.run_id = "run_fork_prompt_v8";
    child.lineage = {
      parent_run_id: parent.identity.run_id,
      root_run_id: parent.identity.run_id,
      depth: 1,
      fork_checkpoint: {
        checkpoint_id: "chk_root",
        step_id: parent.trajectory[0]?.step_id,
      },
      mutations: [
        {
          mutation_id: "mut_prompt_v8",
          type: "prompt",
          target_identifier: "prompts.support",
          mutated_value: { version: "support@8", template: "Handle customer queries with empathy v8" },
          description: "Upgrade support prompt to v8",
        },
      ],
    };

    child.configuration_snapshot = {
      ...parent.configuration_snapshot,
      prompts: { support: { template: "Handle customer queries with empathy v8", version: "support@8" } },
    };

    const comparison = await compareRuns(parent, child);

    // Configuration diff surfaces prompt change
    expect(comparison.configuration_diff.identical).toBe(false);
    expect(comparison.configuration_diff.changed_prompts).toBe(true);
    expect(comparison.configuration_diff.differences["prompts.support"]).toBeDefined();

    // Controlled mutation flagged
    expect(comparison.divergences.some((d) => d.causal_status === "CONTROLLED_MUTATION")).toBe(true);
  });

  // ── Reference Proof #3: Evidence Plane Delta (FAILED -> PASSED) ───────────
  it("Reference Proof #3: Evidence difference fixture with test, review, and outcome improvement produces IMPROVED verdict", async () => {
    const baseRun: RunArtifact = runArtifactSchema.parse(
      JSON.parse(
        fs.readFileSync(
          path.resolve(process.cwd(), "tests/fixtures/canonical/fixture-h-vertical-slice.json"),
          "utf8"
        )
      )
    );
    baseRun.identity.run_id = "run_evidence_failed";
    baseRun.evidence = {
      test_results: [
        {
          test_id: "t_refund_limit",
          suite: "compliance",
          name: "policy_max_refund",
          status: "FAILED",
          failure_message: "Refund exceeds single-transaction limit without supervisor approval",
        },
      ],
      review_results: [
        {
          review_id: "rev_compliance",
          reviewer: "policy_guard",
          review_type: "security",
          status: "CHANGES_REQUESTED",
          findings: [
            {
              severity: "high",
              category: "spending_limit",
              message: "High-value refund requires secondary sign-off",
            },
          ],
        },
      ],
      verification_events: [],
      security_events: [
        {
          event_id: "sec_deny_01",
          action_id: "execute_refund",
          decision: "DENY",
        },
      ],
      approval_events: [],
      final_outcome: {
        status: "FAILURE",
        summary: "Refund blocked by compliance guard",
      },
    };

    const candRun: RunArtifact = JSON.parse(JSON.stringify(baseRun));
    candRun.identity.run_id = "run_evidence_passed";
    candRun.evidence = {
      test_results: [
        {
          test_id: "t_refund_limit",
          suite: "compliance",
          name: "policy_max_refund",
          status: "PASSED",
        },
      ],
      review_results: [
        {
          review_id: "rev_compliance",
          reviewer: "policy_guard",
          review_type: "security",
          status: "APPROVED",
          findings: [],
        },
      ],
      verification_events: [],
      security_events: [
        {
          event_id: "sec_allow_01",
          action_id: "execute_refund",
          decision: "ALLOW",
        },
      ],
      approval_events: [],
      final_outcome: {
        status: "SUCCESS",
        summary: "Refund successfully processed within approved compliance window",
      },
    };

    const comparison = await compareRuns(baseRun, candRun);

    // Tests & reviews updated
    expect(comparison.evidence_diff.test_diffs[0]?.before_status).toBe("FAILED");
    expect(comparison.evidence_diff.test_diffs[0]?.after_status).toBe("PASSED");
    expect(comparison.evidence_diff.review_diffs[0]?.before_status).toBe("CHANGES_REQUESTED");
    expect(comparison.evidence_diff.review_diffs[0]?.after_status).toBe("APPROVED");

    // Outcome updated
    expect(comparison.outcome_diff.status_changed).toBe(true);
    expect(comparison.outcome_diff.baseline_status).toBe("FAILURE");
    expect(comparison.outcome_diff.candidate_status).toBe("SUCCESS");

    // Overall verdict
    expect(comparison.verdict).toBe("IMPROVED");
  });
});
