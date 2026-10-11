import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runArtifactSchema, type RunArtifact } from "../../contracts/runArtifact";
import {
  runComparisonSchema,
  type RunComparison,
} from "../../contracts/comparison";
import {
  compareRuns,
  detectRunRelationship,
  materializeComparisonViews,
  alignRuns,
  diffStateSnapshots,
  diffContextSnapshots,
  diffRetrievalOperations,
  diffMemoryOperations,
  diffToolInvocations,
  diffModelInvocations,
  diffEvidencePlane,
  diffRunOutcomes,
  diffMetrics,
  detectDivergences,
  DefaultSemanticComparator,
  safeSemanticCompare,
  evaluateComparisonVerdict,
  saveRunComparison,
  getRunComparison,
  listRunComparisons,
  ProjectIsolationError,
} from "../index";
import { runCli } from "../../../../scripts/pulse-cli";
import { saveCanonicalRun } from "../../capture/persistence";

describe("AgentPulse Sprint 6: Run Comparison & Divergence Analysis Suite", () => {
  let baseArtifact: RunArtifact;
  let candidateArtifact: RunArtifact;

  beforeEach(() => {
    const fixturePath = path.resolve(
      process.cwd(),
      "tests/fixtures/canonical/fixture-h-vertical-slice.json"
    );
    const raw = fs.readFileSync(fixturePath, "utf8");
    baseArtifact = runArtifactSchema.parse(JSON.parse(raw));
    // Create deep clone for candidate
    candidateArtifact = JSON.parse(JSON.stringify(baseArtifact));
    candidateArtifact.identity.run_id = "run_candidate_vertical_001";
  });

  // ── 1. Canonical Schema & Versioning ────────────────────────────────────────
  it("Requirement 1: Produces valid canonical RunComparison matching schema v1.0.0", async () => {
    const comparison = await compareRuns(baseArtifact, candidateArtifact);
    const parsed = runComparisonSchema.parse(comparison);
    expect(parsed.schema_version).toBe("1.0.0");
    expect(parsed.comparison_id).toMatch(/^cmp_/);
    expect(parsed.baseline_run_id).toBe(baseArtifact.identity.run_id);
    expect(parsed.candidate_run_id).toBe(candidateArtifact.identity.run_id);
  });

  // ── 2. Immutability of Source Runs ─────────────────────────────────────────
  it("Requirement 2: Strictly preserves immutability of source runs A and B", async () => {
    const baseBefore = JSON.stringify(baseArtifact);
    const candBefore = JSON.stringify(candidateArtifact);

    await compareRuns(baseArtifact, candidateArtifact, { enableSemantic: true });

    expect(JSON.stringify(baseArtifact)).toBe(baseBefore);
    expect(JSON.stringify(candidateArtifact)).toBe(candBefore);
  });

  // ── 3. Relationship Detection ──────────────────────────────────────────────
  it("Requirement 3: Accurately classifies run relationships across topologies", () => {
    // Independent
    expect(detectRunRelationship(baseArtifact, candidateArtifact)).toBe("INDEPENDENT");

    // Parent -> Child
    const childFork = JSON.parse(JSON.stringify(baseArtifact));
    childFork.identity.run_id = "run_child_fork_001";
    childFork.lineage = {
      parent_run_id: baseArtifact.identity.run_id,
      root_run_id: baseArtifact.identity.run_id,
      depth: 1,
      fork_checkpoint: { checkpoint_id: "chk_001", step_id: "step_0" },
      mutations: [],
    };
    expect(detectRunRelationship(baseArtifact, childFork)).toBe("PARENT_CHILD");

    // Sibling forks
    const siblingFork = JSON.parse(JSON.stringify(childFork));
    siblingFork.identity.run_id = "run_sibling_fork_002";
    expect(detectRunRelationship(childFork, siblingFork)).toBe("SIBLING_FORKS");

    // Replay source
    const replayRun = JSON.parse(JSON.stringify(baseArtifact));
    replayRun.identity.run_id = "run_replay_001";
    replayRun.metadata = { replay_of_run_id: baseArtifact.identity.run_id };
    expect(detectRunRelationship(baseArtifact, replayRun)).toBe("REPLAY_SOURCE");

    // Same experiment
    const expRun = JSON.parse(JSON.stringify(baseArtifact));
    expRun.identity.run_id = "run_exp_002";
    baseArtifact.lineage.experiment_id = "exp_batch_1";
    expRun.lineage.experiment_id = "exp_batch_1";
    expect(detectRunRelationship(baseArtifact, expRun)).toBe("SAME_EXPERIMENT");
  });

  // ── 4. Lineage-Aware Execution Materialization ─────────────────────────────
  it("Requirement 4: Materializes lineage prefix and suffix without mutating artifacts", () => {
    const childFork: RunArtifact = JSON.parse(JSON.stringify(baseArtifact));
    childFork.identity.run_id = "run_child_lineage";
    childFork.lineage = {
      parent_run_id: baseArtifact.identity.run_id,
      root_run_id: baseArtifact.identity.run_id,
      depth: 1,
      fork_checkpoint: {
        checkpoint_id: "chk_lineage",
        step_id: baseArtifact.trajectory[1]?.step_id,
      },
      mutations: [
        {
          mutation_id: "mut_001",
          type: "tool_result_override",
          target_identifier: "get_balance",
          mutated_value: { balance: 300 },
          description: "Balance bump",
        },
      ],
    };

    const views = materializeComparisonViews(baseArtifact, childFork);
    expect(views.relationship).toBe("PARENT_CHILD");
    expect(views.materializedBaseline.segments.length).toBeGreaterThanOrEqual(1);
    expect(views.materializedCandidate.segments.length).toBeGreaterThanOrEqual(2);

    const sharedSegment = views.materializedCandidate.segments.find(
      (s) => s.segment_type === "HISTORICAL_SHARED"
    );
    expect(sharedSegment).toBeDefined();
    expect(sharedSegment?.source_run_id).toBe(baseArtifact.identity.run_id);
  });

  // ── 5. Step Alignment Hierarchy ────────────────────────────────────────────
  it("Requirement 5: Aligns steps via hierarchy: matched, added, removed, ambiguous", () => {
    const candidateModified: RunArtifact = JSON.parse(JSON.stringify(baseArtifact));
    candidateModified.identity.run_id = "run_cand_steps";

    // Add a candidate-only step
    candidateModified.trajectory.push({
      step_id: "step_candidate_new",
      step_index: candidateModified.trajectory.length,
      step_type: "custom",
      name: "extra_step_candidate",
      started_at: new Date().toISOString(),
      boundary_ids: [],
      tool_invocation_ids: [],
      model_invocation_ids: [],
      memory_operation_ids: [],
      retrieval_operation_ids: [],
      eval_result_ids: [],
      artifact_ids: [],
    });

    const alignment = alignRuns(baseArtifact, candidateModified);
    expect(alignment.aligned_steps.length).toBeGreaterThanOrEqual(baseArtifact.trajectory.length);

    const addedStep = alignment.aligned_steps.find((s) => s.candidate_step_id === "step_candidate_new");
    expect(addedStep).toBeDefined();
    expect(addedStep?.alignment_status).toBe("CANDIDATE_ONLY");

    // Test heuristic ambiguous match
    const baseWithDiffName: RunArtifact = JSON.parse(JSON.stringify(baseArtifact));
    baseWithDiffName.trajectory[0].name = "unknown_legacy_step";
    delete (baseWithDiffName.trajectory[0] as any).step_id;
    const alignAmbiguous = alignRuns(baseWithDiffName, candidateModified);
    expect(alignAmbiguous.alignment_summary.total_baseline_steps).toBe(baseWithDiffName.trajectory.length);
  });

  // ── 6. Boundary Alignment & Changes ────────────────────────────────────────
  it("Requirement 6: Detects boundary changes, reordering, and side-effect shifts", () => {
    const candidateWithBoundaryMod: RunArtifact = JSON.parse(JSON.stringify(baseArtifact));
    candidateWithBoundaryMod.boundaries = JSON.parse(JSON.stringify(baseArtifact.boundaries));

    if (candidateWithBoundaryMod.boundaries[0]) {
      candidateWithBoundaryMod.boundaries[0].side_effect_class = "EXTERNAL_WRITE";
      candidateWithBoundaryMod.boundaries[0].input.content = "modified_input_param";
      candidateWithBoundaryMod.boundaries[0].input.hash = "hash_mod_input";
    }

    const alignment = alignRuns(baseArtifact, candidateWithBoundaryMod);
    expect(alignment.aligned_boundaries.length).toBeGreaterThan(0);

    const modifiedBoundary = alignment.aligned_boundaries[0];
    expect(modifiedBoundary?.change_type).toBe("BOUNDARY_INPUT_CHANGED");
    expect(modifiedBoundary?.differences).toContain("side_effect_class: READ_ONLY -> EXTERNAL_WRITE");
  });

  // ── 7. Configuration Diff Integration ──────────────────────────────────────
  it("Requirement 7: Integrates configuration diff across models, prompts, tools", async () => {
    candidateArtifact.configuration_snapshot = {
      agent: { id: "customer-support-agent", version: "2.0.0" },
      model: { provider: "anthropic", model_id: "claude-3-sonnet", parameters: { temperature: 0.5 } },
      prompts: [{ id: "support", template: "Updated prompt v8", version: "support@8" }],
      skills: [],
      tools: [],
      permissions: { policy_id: "default", policy_version: "1", granted_capabilities: [] },
      workflow: {},
      runtime_config: {},
    };

    const comparison = await compareRuns(baseArtifact, candidateArtifact);
    expect(comparison.configuration_diff.identical).toBe(false);
    expect(comparison.configuration_diff.changed_agent).toBe(true);
    expect(comparison.configuration_diff.summary.length).toBeGreaterThan(0);
  });

  // ── 8. Structured State JSON Pointer Diff with Redaction ───────────────────
  it("Requirement 8: Computes structured JSON Pointer state diffs with sensitive redaction", () => {
    const stateA = {
      customer: { id: "cus_1001", vip: false, balance: 150 },
      secret_api_key: "sk-ant-secret-1234567890",
    };
    const stateB = {
      customer: { id: "cus_1001", vip: true, balance: 300 },
      secret_api_key: "sk-ant-secret-9999999999",
      cart: { total: 45 },
    };

    const diff = diffStateSnapshots(
      { snapshot_id: "s1", state: stateA },
      { snapshot_id: "s2", state: stateB }
    );

    expect(diff.changes.length).toBeGreaterThan(0);
    const vipChange = diff.changes.find((c) => c.path === "/customer/vip");
    expect(vipChange).toBeDefined();
    expect(vipChange?.operation).toBe("replace");
    expect(vipChange?.before).toBe(false);
    expect(vipChange?.after).toBe(true);

    const cartAdd = diff.changes.find((c) => c.path === "/cart/total");
    expect(cartAdd?.operation).toBe("add");

    // Redaction verified: secrets should be redacted in sanitized payloads
    const secretChange = diff.changes.find((c) => c.path === "/secret_api_key");
    if (secretChange) {
      expect(String(secretChange.after)).toContain("[REDACTED");
    }
  });

  // ── 9. Context, Retrieval, Memory Diffs ─────────────────────────────────────
  it("Requirement 9: Compares context snapshots, retrieval rankings, and memory ops", () => {
    // Context diff
    const baseContext = [
      {
        snapshot_id: "s1",
        total_token_estimate: 100,
        items: [
          {
            item_id: "ctx_1",
            source_type: "document",
            token_estimate: 100,
            content_hash: "h1",
          },
        ],
      },
    ];
    const candidateContext = [
      {
        snapshot_id: "s2",
        total_token_estimate: 230,
        items: [
          {
            item_id: "ctx_1",
            source_type: "document",
            token_estimate: 150,
            content_hash: "h2_modified",
          },
          {
            item_id: "ctx_2",
            source_type: "memory",
            token_estimate: 80,
            content_hash: "h_mem",
          },
        ],
      },
    ];
    const cDiff = diffContextSnapshots(baseContext, candidateContext);
    expect(cDiff.changes.length).toBe(2);
    expect(cDiff.token_delta).toBe(130);

    // Retrieval diff
    const baseRet = [
      {
        operation_id: "ret_1",
        query: "refund policy",
        results: [
          { document_id: "doc_10", score: 0.95 },
          { document_id: "doc_20", score: 0.80 },
        ],
      },
    ];
    const candRet = [
      {
        operation_id: "ret_1",
        query: "refund policy 2026",
        results: [
          { document_id: "doc_20", score: 0.99 },
          { document_id: "doc_30", score: 0.85 },
        ],
      },
    ];
    const rDiff = diffRetrievalOperations(baseRet, candRet);
    expect(rDiff.changes.length).toBeGreaterThan(0);
    expect(rDiff.changes.some((c) => c.change_type === "RETRIEVAL_QUERY_CHANGED")).toBe(true);

    // Memory diff
    const baseMem = [{ operation_id: "mem_1", operation_type: "read" as const, memory_id: "mem_pref" }];
    const candMem = [
      { operation_id: "mem_1", operation_type: "read" as const, memory_id: "mem_pref" },
      { operation_id: "mem_2", operation_type: "write" as const, memory_id: "mem_pref" },
    ];
    const mDiff = diffMemoryOperations(baseMem, candMem);
    expect(mDiff.changes.length).toBeGreaterThan(0);
    expect(mDiff.changes.some((c) => c.change_type === "MEMORY_WRITE_CHANGED")).toBe(true);
  });

  // ── 10. Tools & Models Differences ─────────────────────────────────────────
  it("Requirement 10: Compares tool arguments/output and model calls without private reasoning", () => {
    const baseTools = [
      {
        invocation_id: "t_1",
        tool_name: "get_balance",
        input: { account_id: "acc_1001" },
        output: { balance: 150 },
        status: "completed" as const,
        duration_ms: 10,
      },
    ];
    const candTools = [
      {
        invocation_id: "t_1",
        tool_name: "get_balance",
        input: { account_id: "acc_1001" },
        output: { balance: 300 },
        status: "completed" as const,
        duration_ms: 12,
      },
    ];
    const tDiffs = diffToolInvocations(baseTools, candTools);
    expect(tDiffs.length).toBe(1);
    expect(tDiffs[0]?.change_type).toBe("TOOL_OUTPUT_CHANGED");
    expect(tDiffs[0]?.baseline_value).toBeDefined();
    expect(tDiffs[0]?.candidate_value).toBeDefined();

    const baseModels = [
      {
        invocation_id: "m_1",
        provider: "openai",
        model_name: "gpt-4o",
        input_tokens: 500,
        output_tokens: 100,
        cost_usd: 0.005,
      },
    ];
    const candModels = [
      {
        invocation_id: "m_1",
        provider: "anthropic",
        model_name: "claude-3-5-sonnet",
        input_tokens: 600,
        output_tokens: 120,
        cost_usd: 0.008,
      },
    ];
    const mDiffs = diffModelInvocations(baseModels, candModels);
    expect(mDiffs[0]?.change_type).toBe("MODEL_SELECTION_CHANGED");
    expect(mDiffs[0]?.description).toContain("gpt-4o → claude-3-5-sonnet");
  });

  // ── 11. Evidence, Test, Review, Security & Outcome Diff ───────────────────
  it("Requirement 11: Compares tests, reviews, permissions, artifacts and final outcome", () => {
    const baseEvidence = {
      test_results: [{ test_id: "t1", suite: "compliance", name: "policy_check", status: "FAILED", failure_message: "Over budget" }],
      review_results: [{ review_id: "r1", reviewer: "guardrail", review_type: "safety", status: "CHANGES_REQUESTED", findings: [{ severity: "high", category: "limit", message: "Exceeded" }] }],
      verification_events: [],
      security_events: [{ event_id: "sec1", action_id: "execute_refund", decision: "DENY" as const }],
      approval_events: [],
      final_outcome: { status: "FAILURE", summary: "Failed policy check" },
    };
    const candEvidence = {
      test_results: [{ test_id: "t1", suite: "compliance", name: "policy_check", status: "PASSED" }],
      review_results: [{ review_id: "r1", reviewer: "guardrail", review_type: "safety", status: "APPROVED", findings: [] }],
      verification_events: [],
      security_events: [{ event_id: "sec1", action_id: "execute_refund", decision: "ALLOW" as const }],
      approval_events: [],
      final_outcome: { status: "SUCCESS", summary: "All policies satisfied" },
    };

    const eDiff = diffEvidencePlane(baseEvidence, candEvidence);
    expect(eDiff.test_diffs[0]?.change_type).toBe("TEST_STATUS_CHANGED");
    expect(eDiff.test_diffs[0]?.before_status).toBe("FAILED");
    expect(eDiff.test_diffs[0]?.after_status).toBe("PASSED");

    expect(eDiff.review_diffs[0]?.change_type).toBe("REVIEW_STATUS_CHANGED");
    expect(eDiff.security_diffs[0]?.change_type).toBe("PERMISSION_DECISION_CHANGED");

    const outDiff = diffRunOutcomes(baseEvidence.final_outcome, candEvidence.final_outcome);
    expect(outDiff.status_changed).toBe(true);
    expect(outDiff.baseline_status).toBe("FAILURE");
    expect(outDiff.candidate_status).toBe("SUCCESS");
  });

  // ── 12. Direction-Normalized Metrics & Division by Zero Protection ────────
  it("Requirement 12: Handles metrics directionality and guards against division by zero", () => {
    const runA: any = { metrics: { cost_usd: 0, latency_ms: 1000, error_count: 0 } };
    const runB: any = { metrics: { cost_usd: 0.05, latency_ms: 800, error_count: 0 } };

    const mDiff = diffMetrics(runA, runB);
    expect(mDiff.cost_delta_usd).toBe(0.05);
    expect(mDiff.latency_delta_ms).toBe(-200);

    // Zero-division check: cost_usd went from 0 to 0.05
    const costDelta = mDiff.deltas["cost_usd"];
    expect(costDelta).toBeDefined();
    // percentage should safely be null or finite, never NaN or Infinity
    expect(costDelta?.percent_delta).toBeNull();
    expect(costDelta?.evaluation).toBe("REGRESSED"); // lower is better, increased cost is regressed

    // Latency went down from 1000 to 800
    const latDelta = mDiff.deltas["duration_ms"];
    expect(latDelta?.percent_delta).toBe(-20);
    expect(latDelta?.evaluation).toBe("IMPROVED"); // lower is better, decrease is improvement
  });

  // ── 13. First Structural vs First Meaningful Divergence ───────────────────
  it("Requirement 13: Distinguishes first structural divergence from first meaningful divergence", () => {
    const candidateFork: RunArtifact = JSON.parse(JSON.stringify(baseArtifact));
    candidateFork.lineage = {
      parent_run_id: baseArtifact.identity.run_id,
      root_run_id: baseArtifact.identity.run_id,
      depth: 1,
      fork_checkpoint: { checkpoint_id: "chk_0", step_id: baseArtifact.trajectory[0]?.step_id },
      mutations: [
        {
          mutation_id: "mut_test",
          type: "state_patch",
          target_identifier: "/flags/beta",
          mutated_value: true,
          description: "Enable beta flag",
        },
      ],
    };

    const res = detectDivergences({
      baseline: baseArtifact,
      candidate: candidateFork,
      configurationDiff: { identical: true, differences: {}, summary: [] } as any,
      alignment: alignRuns(baseArtifact, candidateFork),
      toolChanges: [],
      modelChanges: [],
      stateDiffs: [
        {
          step_id: baseArtifact.trajectory[0]?.step_id,
          changes: [{ path: "/flags/beta", operation: "add", before: undefined, after: true, redacted: false }],
        },
      ],
      contextDiff: { token_delta: 0, changes: [], unavailable: false },
      retrievalDiff: { changes: [] },
      memoryDiff: { changes: [] },
      evidenceDiff: { test_diffs: [], review_diffs: [], verification_diffs: [], security_diffs: [], artifact_diffs: [] },
      metricsDiff: { deltas: {}, cost_delta_usd: 0, latency_delta_ms: 0, tokens_delta: 0 },
      outcomeDiff: { baseline_status: "SUCCESS", candidate_status: "SUCCESS", status_changed: false },
    });

    expect(res.first_structural_divergence).toBeDefined();
    expect(res.first_meaningful_divergence).toBeDefined();
    expect(res.first_meaningful_divergence?.causal_status).toBe("CONTROLLED_MUTATION");
  });

  // ── 14. Semantic Text Comparator & Offline Heuristic Fallback ─────────────
  it("Requirement 14: DefaultSemanticComparator operates offline deterministically", async () => {
    const comparator = new DefaultSemanticComparator();

    // Exact match
    const exact = await comparator.compareText({
      text_a: "Order #1001 cancelled successfully.",
      text_b: "Order #1001 cancelled successfully.",
      context_type: "final_answer",
    });
    expect(exact.semantic_relation).toBe("EQUIVALENT");
    expect(exact.similarity).toBe(1.0);
    expect(exact.material_difference).toBe(false);

    // Paraphrase
    const para = await comparator.compareText({
      text_a: "Order #1001 cancelled successfully.",
      text_b: "   order #1001 cancelled successfully. \n",
      context_type: "final_answer",
    });
    expect(para.semantic_relation).toBe("PARAPHRASE");
    expect(para.material_difference).toBe(false);

    // Divergent
    const div = await comparator.compareText({
      text_a: "Your refund of $150 has been approved.",
      text_b: "Your refund request was denied due to store policy.",
      context_type: "final_answer",
    });
    expect(div.semantic_relation).toBe("DIVERGENT");
    expect(div.material_difference).toBe(true);

    // Safe fallback on error
    const brokenComparator = {
      compareText: async () => {
        throw new Error("Network timeout");
      },
    };
    const fallback = await safeSemanticCompare(brokenComparator, {
      text_a: "foo",
      text_b: "bar",
      context_type: "general",
    });
    expect(fallback.semantic_relation).toBe("UNAVAILABLE");
    expect(fallback.evaluator_name).toBe("fallback-error-boundary");
  });

  // ── 15. Negative Proofs & Latency Noise Filtering ─────────────────────────
  it("Requirement 15: Ignores minor latency jitter (<50ms) as meaningless divergence", () => {
    const runA: any = { metrics: { cost_usd: 0.01, latency_ms: 500 } };
    const runB: any = { metrics: { cost_usd: 0.01, latency_ms: 515 } }; // 15ms jitter

    const mDiff = diffMetrics(runA, runB);
    const divs = detectDivergences({
      baseline: baseArtifact,
      candidate: candidateArtifact,
      configurationDiff: { identical: true, differences: {}, summary: [] } as any,
      alignment: alignRuns(baseArtifact, candidateArtifact),
      toolChanges: [],
      modelChanges: [],
      stateDiffs: [],
      contextDiff: { token_delta: 0, changes: [], unavailable: false },
      retrievalDiff: { changes: [] },
      memoryDiff: { changes: [] },
      evidenceDiff: { test_diffs: [], review_diffs: [], verification_diffs: [], security_diffs: [], artifact_diffs: [] },
      metricsDiff: mDiff,
      outcomeDiff: { baseline_status: "SUCCESS", candidate_status: "SUCCESS", status_changed: false },
    });

    // Slight 15ms latency delta should NOT produce a meaningful divergence
    expect(divs.first_meaningful_divergence).toBeUndefined();
  });

  // ── 16. Cross-Project Isolation Enforcement ────────────────────────────────
  it("Requirement 16: Throws ProjectIsolationError when attempting cross-project diff", async () => {
    const alienRun: RunArtifact = JSON.parse(JSON.stringify(baseArtifact));
    alienRun.identity.run_id = "run_alien_001";
    alienRun.identity.project_id = "secret-financial-project";

    await expect(
      compareRuns(baseArtifact, alienRun, { projectId: baseArtifact.identity.project_id })
    ).rejects.toThrow(ProjectIsolationError);
  });

  // ── 17. Verdict Policy Rules ──────────────────────────────────────────────
  it("Requirement 17: Evaluates rule-based comparison verdicts correctly", () => {
    // Improved: outcome fixed, tests passed
    const improved = evaluateComparisonVerdict({
      outcomeDiff: { baseline_status: "FAILED", candidate_status: "SUCCESS", status_changed: true },
      evidenceDiff: {
        test_diffs: [{ test_id: "t1", suite: "s", name: "t", change_type: "TEST_STATUS_CHANGED", before_status: "FAILED", after_status: "PASSED" }],
        review_diffs: [],
        verification_diffs: [],
        security_diffs: [],
        artifact_diffs: [],
      },
      metricsDiff: { deltas: {}, cost_delta_usd: 0, latency_delta_ms: 0, tokens_delta: 0 },
      divergences: [{ divergence_id: "div_out", dimension: "OUTCOME", description: "Outcome improved" }],
    });
    expect(improved).toBe("IMPROVED");

    // Regressed: outcome broke
    const regressed = evaluateComparisonVerdict({
      outcomeDiff: { baseline_status: "SUCCESS", candidate_status: "FAILED", status_changed: true },
      evidenceDiff: { test_diffs: [], review_diffs: [], verification_diffs: [], security_diffs: [], artifact_diffs: [] },
      metricsDiff: { deltas: {}, cost_delta_usd: 0, latency_delta_ms: 0, tokens_delta: 0 },
      divergences: [{ divergence_id: "div_1", dimension: "OUTCOME", description: "Outcome broke" }],
    });
    expect(regressed).toBe("REGRESSED");
  });

  // ── 18. Comparison Persistence (File & Postgres Ready) ────────────────────
  it("Requirement 18: Saves and loads comparisons in dual-mode persistence", async () => {
    const comparison = await compareRuns(baseArtifact, candidateArtifact);
    await saveRunComparison(comparison);

    const loaded = await getRunComparison(comparison.comparison_id);
    expect(loaded).toBeDefined();
    expect(loaded?.comparison_id).toBe(comparison.comparison_id);

    const list = await listRunComparisons({ baseline_run_id: baseArtifact.identity.run_id });
    expect(list.some((c) => c.comparison_id === comparison.comparison_id)).toBe(true);
  });

  // ── 19. CLI Integration: pulse diff ───────────────────────────────────────
  it("Requirement 19: Executes pulse diff via CLI with stdout and --json output", async () => {
    // Save both runs into persistence so CLI can read them
    await saveCanonicalRun(baseArtifact);
    await saveCanonicalRun(candidateArtifact);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      // Text output
      const exitCodeText = await runCli(["diff", baseArtifact.identity.run_id, candidateArtifact.identity.run_id]);
      expect(exitCodeText).toBe(0);
      const textOutput = logs.join("\n");
      expect(textOutput).toContain("RUN COMPARISON");
      expect(textOutput).toContain("VERDICT");

      logs.length = 0;

      // JSON output
      const exitCodeJson = await runCli(["diff", baseArtifact.identity.run_id, candidateArtifact.identity.run_id, "--json"]);
      expect(exitCodeJson).toBe(0);
      const jsonOutput = logs.join("\n");
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.schema_version).toBe("1.0.0");
      expect(parsed.baseline_run_id).toBe(baseArtifact.identity.run_id);
    } finally {
      console.log = origLog;
    }
  });
});
