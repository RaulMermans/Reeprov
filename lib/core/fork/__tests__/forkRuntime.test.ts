import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runArtifactSchema, type RunArtifact } from "../../contracts/runArtifact";
import { CaptureSession } from "../../capture/sdk";
import { StateRestorer, StateRestorationError } from "../../replay/stateRestorer";
import { BoundaryResolver, BoundaryResolutionError } from "../../replay/resolver";
import {
  ForkRuntime,
  buildForkPlan,
  validateCheckpoint,
  validateMutation,
  MutationApplier,
  MutationApplicationError,
  applyStatePatch,
  StatePatchError,
  CustomerSupportResumableHostAdapter,
  getParentRun,
  getRootRun,
  getChildren,
  getAncestors,
  getDescendants,
  materializeLineageView,
  LineageCycleError,
} from "../index";
import { runCli } from "../../../../scripts/pulse-cli";
import { saveCanonicalRun, getCanonicalRun } from "../../capture/persistence";

describe("AgentPulse Checkpoints & Fork From Here Runtime Suite", () => {
  let verticalSliceArtifact: RunArtifact;

  beforeEach(() => {
    const fixturePath = path.resolve(
      process.cwd(),
      "tests/fixtures/canonical/fixture-h-vertical-slice.json"
    );
    const raw = fs.readFileSync(fixturePath, "utf8");
    verticalSliceArtifact = runArtifactSchema.parse(JSON.parse(raw));
  });

  // ── 1. Multiple Checkpoints Serialized ─────────────────────────────────────
  it("Requirement 1: serializes multiple canonical checkpoints into RunArtifact", async () => {
    const session = new CaptureSession({
      projectId: "proj_test",
      workflowId: "wf_test",
      summary: "Multiple checkpoints test",
    });

    await session.step("step_0", "node", async (stepId) => {
      session.checkpoint({ counter: 1 }, { stepId, label: "after_step_0" });
    });

    await session.step("step_1", "node", async (stepId) => {
      session.checkpoint({ counter: 2 }, { stepId, label: "after_step_1" });
    });

    const artifact = await session.finishRun();
    expect(artifact.checkpoints).toHaveLength(2);
    expect(artifact.checkpoints[0]?.checkpoint_id).toBe(`chk_${artifact.identity.run_id}_0`);
    expect(artifact.checkpoints[1]?.checkpoint_id).toBe(`chk_${artifact.identity.run_id}_1`);
    expect(artifact.checkpoints[0]?.step_id).toBe(`step_${artifact.identity.run_id}_0`);
    expect(artifact.checkpoints[1]?.step_id).toBe(`step_${artifact.identity.run_id}_1`);
  });

  // ── 2. Legacy Single Checkpoint Compatibility ──────────────────────────────
  it("Requirement 2: preserves lineage.checkpoint_reference for backwards compatibility", async () => {
    const session = new CaptureSession({
      projectId: "proj_test",
      workflowId: "wf_test",
      summary: "Legacy checkpoint compatibility test",
    });

    await session.step("step_0", "node", async (stepId) => {
      session.checkpoint({ val: 100 }, { stepId });
    });

    const artifact = await session.finishRun();
    expect(artifact.lineage.checkpoint_reference).toBeDefined();
    expect(artifact.lineage.checkpoint_reference?.checkpoint_id).toBe(artifact.checkpoints[0]?.checkpoint_id);

    // Verify StateRestorer reads legacy checkpoint_reference when checkpoints array is absent
    const legacyArtifact: any = {
      state: artifact.state,
      lineage: { checkpoint_reference: artifact.checkpoints[0] },
    };
    const restorer = new StateRestorer(legacyArtifact);
    const restored = restorer.restoreCheckpoint();
    expect(restored.state).toEqual({ val: 100 });
  });

  // ── 3 & 4. Checkpoint Points to Correct Snapshot & Hash Matches ────────────
  it("Requirements 3 & 4: checkpoint points to correct snapshot and derives hash from referenced snapshot", () => {
    const session = new CaptureSession({
      projectId: "proj_test",
      workflowId: "wf_test",
      summary: "Hash correctness test",
    });

    const snap0 = session.captureState({ data: "first" });
    const snap1 = session.captureState({ data: "second" });

    // Explicitly target snap0, not the last snapshot
    const chk0 = session.createCheckpoint({ stateSnapshotId: snap0.snapshot_id });
    expect(chk0.state_snapshot_id).toBe(snap0.snapshot_id);
    expect(chk0.state_hash).toBe(snap0.hash);
    expect(chk0.state_hash).not.toBe(snap1.hash);
  });

  // ── 5. Missing Snapshot Rejected ───────────────────────────────────────────
  it("Requirement 5: fails closed when referenced snapshot does not exist", () => {
    const session = new CaptureSession({
      projectId: "proj_test",
      workflowId: "wf_test",
      summary: "Missing snapshot test",
    });

    expect(() => {
      session.createCheckpoint({ stateSnapshotId: "state_non_existent" });
    }).toThrow(/not found/i);
  });

  // ── 6. State Snapshot Immutable After Capture ──────────────────────────────
  it("Requirement 6: captured state snapshot does not mutate when original object mutates", () => {
    const session = new CaptureSession({
      projectId: "proj_test",
      workflowId: "wf_test",
      summary: "Immutability test",
    });

    const liveState = { cart: { total: 100, items: ["item_1"] } };
    const snapshot = session.captureState(liveState);

    // Mutate original object
    liveState.cart.total = 999;
    liveState.cart.items.push("item_2");

    expect((snapshot.state_data as any).cart.total).toBe(100);
    expect((snapshot.state_data as any).cart.items).toHaveLength(1);
  });

  // ── 7. Explicit Missing Checkpoint Fails Closed ─────────────────────────────
  it("Requirement 7: explicit lookup of non-existent checkpoint throws CHECKPOINT_NOT_FOUND", () => {
    const restorer = new StateRestorer(verticalSliceArtifact);

    expect(() => {
      restorer.restoreCheckpoint("chk_does_not_exist");
    }).toThrow(StateRestorationError);

    try {
      restorer.restoreCheckpoint("chk_does_not_exist");
    } catch (err: any) {
      expect(err.message).toContain("CHECKPOINT_NOT_FOUND");
    }
  });

  // ── 8. Checkpoint Position Semantics ───────────────────────────────────────
  it("Requirement 8: respects BEFORE_STEP, AFTER_STEP, and resume step indices", () => {
    const session = new CaptureSession({
      projectId: "proj_test",
      workflowId: "wf_test",
      summary: "Position semantics test",
    });

    session.captureState({ stage: 0 });
    const chkAfter = session.createCheckpoint({ position: "AFTER_STEP", stepId: "step_0" });
    expect(chkAfter.position).toBe("AFTER_STEP");
    expect(chkAfter.resume_step_index).toBe(1);

    const chkBefore = session.createCheckpoint({ position: "BEFORE_STEP", stepId: "step_0" });
    expect(chkBefore.position).toBe("BEFORE_STEP");
    expect(chkBefore.resume_step_index).toBe(0);
  });

  // ── 9. Boundary Cursor Semantics ───────────────────────────────────────────
  it("Requirement 9: boundary cursor points to exact next boundary to execute", () => {
    const chk1 = verticalSliceArtifact.checkpoints.find(
      (c) => c.checkpoint_id === "chk_run_vertical_slice_ref_001_1"
    );
    expect(chk1).toBeDefined();
    // After step 1 (boundaries 0, 1, 2 completed), boundary cursor is 3
    expect(chk1?.boundary_cursor).toBe(3);
    expect(chk1?.resume_step_index).toBe(2);
  });

  // ── 10. Checkpoint Validation ──────────────────────────────────────────────
  it("Requirement 10: validates checkpoint uniqueness, cross-run integrity, and corruption", () => {
    // Valid checkpoint
    const validRes = validateCheckpoint(verticalSliceArtifact, "chk_run_vertical_slice_ref_001_1");
    expect(validRes.valid).toBe(true);
    expect(validRes.errors).toHaveLength(0);

    // Corrupted state hash
    const corruptArtifact = structuredClone(verticalSliceArtifact);
    const snap = corruptArtifact.state.find((s) => s.snapshot_id === "state_run_vertical_slice_ref_001_1")!;
    snap.state_data = { phase: "tampered_data" };
    const corruptRes = validateCheckpoint(corruptArtifact, "chk_run_vertical_slice_ref_001_1");
    expect(corruptRes.valid).toBe(false);
    expect(corruptRes.errors.some((e) => e.code === "CHECKPOINT_CORRUPT")).toBe(true);

    // Cross-run checkpoint
    const crossRunArtifact = structuredClone(verticalSliceArtifact);
    crossRunArtifact.checkpoints[1]!.run_id = "other_run_999";
    const crossRes = validateCheckpoint(crossRunArtifact, "chk_run_vertical_slice_ref_001_1");
    expect(crossRes.valid).toBe(false);
    expect(crossRes.errors.some((e) => e.code === "CROSS_RUN_CHECKPOINT_REJECTED")).toBe(true);

    // Boundary cursor out of bounds
    const invalidCursorArtifact = structuredClone(verticalSliceArtifact);
    invalidCursorArtifact.checkpoints[1]!.boundary_cursor = 999;
    const cursorRes = validateCheckpoint(invalidCursorArtifact, "chk_run_vertical_slice_ref_001_1");
    expect(cursorRes.valid).toBe(false);
    expect(cursorRes.errors.some((e) => e.code === "INVALID_CURSOR")).toBe(true);
  });

  // ── 11. Boundary Resolver Start Cursor ─────────────────────────────────────
  it("Requirement 11: BoundaryResolver begins resolution at startCursor without replaying prefix", async () => {
    const resolver = new BoundaryResolver(verticalSliceArtifact, {
      startCursor: 3,
    });

    expect(resolver.getCursor()).toBe(3);
    expect(resolver.getHistoricalSubstitutedCount()).toBe(3);
    expect(resolver.getForkSubstitutedCount()).toBe(0);

    // Next boundary must be tool_call get_customer_account (sequence index 3)
    const nextB = resolver.peekNext();
    expect(nextB?.name).toBe("get_customer_account");
    expect(nextB?.boundary_type).toBe("tool_call");

    // Invalid start cursor throws BoundaryResolutionError
    expect(() => {
      new BoundaryResolver(verticalSliceArtifact, { startCursor: 100 });
    }).toThrow(BoundaryResolutionError);
  });

  // ── 12 & 13. Fork Plan Success and Invalid Checkpoint ──────────────────────
  it("Requirements 12 & 13: ForkPlanner generates FORKABLE or NOT_FORKABLE plan", async () => {
    const validPlan = await buildForkPlan(
      verticalSliceArtifact,
      "chk_run_vertical_slice_ref_001_1",
      []
    );
    expect(validPlan.validation.verdict).toBe("FORKABLE");
    expect(validPlan.parent_run_id).toBe("run_vertical_slice_ref_001");
    expect(validPlan.boundary_cursor).toBe(3);

    const invalidPlan = await buildForkPlan(
      verticalSliceArtifact,
      "chk_missing_999",
      []
    );
    expect(invalidPlan.validation.verdict).toBe("NOT_FORKABLE");
    expect(invalidPlan.validation.reasons.some((r) => r.includes("CHECKPOINT_NOT_FOUND"))).toBe(true);
  });

  // ── 14 & 15. Intermediate Checkpoint Restore & Prefix Not Re-executed ───────
  it("Requirements 14 & 15: restores intermediate checkpoint state and skips prefix execution", async () => {
    const runtime = new ForkRuntime(
      verticalSliceArtifact,
      "chk_run_vertical_slice_ref_001_1",
      { persist: false }
    );

    const result = await runtime.fork();
    expect(result.status).toBe("COMPLETED");
    // Only 1 suffix step was executed in child (synthesis)
    expect(result.steps_executed).toBe(1);
    // Boundaries substituted only post-checkpoint
    expect(result.boundaries_recorded).toBe(1);
    expect(result.final_output).toContain("balance is 150 USD");
  });

  // ── 16 & 17. Child Run New ID & Parent Immutability ─────────────────────────
  it("Requirements 16 & 17: assigns new unique ID to child and keeps parent artifact immutable", async () => {
    const parentCopyBefore = JSON.stringify(verticalSliceArtifact);

    const runtime = new ForkRuntime(
      verticalSliceArtifact,
      "chk_run_vertical_slice_ref_001_1",
      { persist: false }
    );

    const result = await runtime.fork();
    expect(result.derived_run_id).not.toBe(verticalSliceArtifact.identity.run_id);
    expect(result.derived_run_id.startsWith("run_fork_")).toBe(true);

    const parentCopyAfter = JSON.stringify(verticalSliceArtifact);
    expect(parentCopyBefore).toBe(parentCopyAfter);
  });

  // ── 18 & 19. Lineage Tracking & Cycle Detection ────────────────────────────
  it("Requirements 18 & 19: preserves root and parent lineage, detects graph cycles", async () => {
    const runtime = new ForkRuntime(
      verticalSliceArtifact,
      "chk_run_vertical_slice_ref_001_1",
      { persist: false }
    );

    const result = await runtime.fork();
    expect(result.parent_run_id).toBe("run_vertical_slice_ref_001");
    expect(result.root_run_id).toBe("run_vertical_slice_ref_001");
    expect(result.child_artifact?.lineage.parent_run_id).toBe("run_vertical_slice_ref_001");
    expect(result.child_artifact?.lineage.fork_checkpoint_id).toBe("chk_run_vertical_slice_ref_001_1");

    // Cycle detection test
    const cyclicRunA: any = {
      identity: { run_id: "run_A" },
      lineage: { parent_run_id: "run_B" },
    };
    const cyclicRunB: any = {
      identity: { run_id: "run_B" },
      lineage: { parent_run_id: "run_A" },
    };

    await saveCanonicalRun(runArtifactSchema.parse({
      ...verticalSliceArtifact,
      identity: { ...verticalSliceArtifact.identity, run_id: "run_cycle_a" },
      lineage: { parent_run_id: "run_cycle_b", mutations: [] },
    }));
    await saveCanonicalRun(runArtifactSchema.parse({
      ...verticalSliceArtifact,
      identity: { ...verticalSliceArtifact.identity, run_id: "run_cycle_b" },
      lineage: { parent_run_id: "run_cycle_a", mutations: [] },
    }));

    await expect(getRootRun("run_cycle_a")).rejects.toThrow(LineageCycleError);
  });

  // ── 20. State Patch Mutation ───────────────────────────────────────────────
  it("Requirement 20: applies deterministic JSON state patch without mutating input", () => {
    const baseState = { customer: { id: "cus_1001", tier: "standard", vip: false } };
    const mutated = applyStatePatch(baseState, [
      { op: "replace", path: "/customer/tier", value: "premium" },
      { op: "replace", path: "/customer/vip", value: true },
    ]);

    expect((mutated as any).customer.tier).toBe("premium");
    expect((mutated as any).customer.vip).toBe(true);
    expect(baseState.customer.tier).toBe("standard"); // input unchanged!
  });

  // ── 21. Tool Result Override ───────────────────────────────────────────────
  it("Requirement 21: Tool Result Override intercepts tool boundary with mock value", async () => {
    const mutations = [
      {
        mutation_id: "mut_tool_override_01",
        mutation_type: "tool_result_override" as const,
        target_identifier: "get_customer_account",
        description: "Override balance from 150 to 300",
        original_value: { balance: 150 },
        mutated_value: { customerId: "cus_1001", balance: 300, currency: "USD", status: "active" },
      },
    ];

    const runtime = new ForkRuntime(
      verticalSliceArtifact,
      "chk_run_vertical_slice_ref_001_1",
      { mutations, persist: false }
    );

    const result = await runtime.fork();
    expect(result.status).toBe("COMPLETED");
    expect(result.mutations_applied).toHaveLength(1);
    expect(result.mutations_applied[0]?.status).toBe("APPLIED");
    expect(result.final_output).toContain("balance is 300 USD");
  });

  // ── 22 & 23. Prompt & Model Parameter Override Contracts ───────────────────
  it("Requirements 22 & 23: applies prompt and model-parameter overrides deterministically", () => {
    const applier = new MutationApplier();
    const result = applier.apply({ phase: "planning" }, [
      {
        mutation_id: "mut_prompt_01",
        mutation_type: "prompt",
        target_identifier: "sys_prompt",
        description: "Candidate system prompt",
        mutated_value: "Concise reply",
      },
      {
        mutation_id: "mut_model_params_01",
        mutation_type: "model_parameters",
        target_identifier: "temperature",
        description: "Zero temperature",
        mutated_value: 0.0,
      },
    ]);

    expect(result.promptOverrides.get("sys_prompt")).toBe("Concise reply");
    expect(result.modelOverrides.get("temperature")).toBe(0.0);
    expect(result.appliedRecords).toHaveLength(2);
  });

  // ── 24. Unsupported Mutation Rejection ────────────────────────────────────
  it("Requirement 24: rejects unsupported mutation types with UNSUPPORTED_MUTATION", () => {
    const applier = new MutationApplier();
    expect(() => {
      applier.apply({}, [
        {
          mutation_id: "mut_bad",
          mutation_type: "workflow_configuration" as any,
          target_identifier: "timeout",
          description: "Unsupported mutation",
          mutated_value: 5000,
        },
      ]);
    }).toThrow(MutationApplicationError);
  });

  // ── 25. Mutation Before / After Hashes ─────────────────────────────────────
  it("Requirement 25: records cryptographic hashes for before and after mutation state", () => {
    const applier = new MutationApplier();
    const res = applier.apply({ count: 1 }, [
      {
        mutation_id: "mut_count",
        mutation_type: "state_patch",
        target_identifier: "/count",
        description: "Increment count",
        mutated_value: [{ op: "replace", path: "/count", value: 2 }],
      },
    ]);

    const record = res.appliedRecords[0]!;
    expect(record.original_hash).toBeDefined();
    expect(record.mutated_hash).toBeDefined();
    expect(record.original_hash).not.toBe(record.mutated_hash);
  });

  // ── 26 & 27. Dependency Policy & External Side-Effect Denied ───────────────
  it("Requirements 26 & 27: blocks live external side-effects with SIDE_EFFECT_BLOCKED", async () => {
    const runtime = new ForkRuntime(
      verticalSliceArtifact,
      "chk_run_vertical_slice_ref_001_1",
      {
        persist: false,
        executeLogic: async (adapter, params) => {
          // Attempting live external side-effect tool
          await params.dependencies.callTool({
            name: "send_refund_email",
            args: { customerId: "cus_1001", amount: 150 },
            sideEffectIntent: "execute_live",
          });
        },
      }
    );

    const result = await runtime.fork();
    expect(result.status).toBe("BLOCKED");
    expect(result.blocked_actions).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("SIDE_EFFECT_BLOCKED"))).toBe(true);
  });

  // ── 28 & 29. Deterministic Offline Fork & Intentional Result Divergence ────
  it("Requirements 28 & 29: deterministic execution produces distinct output under mutation", async () => {
    // Baseline fork without mutation
    const baselineRuntime = new ForkRuntime(
      verticalSliceArtifact,
      "chk_run_vertical_slice_ref_001_1",
      { persist: false }
    );
    const baselineResult = await baselineRuntime.fork();

    // Mutated fork with balance 300
    const mutatedRuntime = new ForkRuntime(
      verticalSliceArtifact,
      "chk_run_vertical_slice_ref_001_1",
      {
        persist: false,
        mutations: [
          {
            mutation_id: "mut_balance",
            mutation_type: "tool_result_override",
            target_identifier: "get_customer_account",
            description: "Balance override",
            mutated_value: { customerId: "cus_1001", balance: 300, currency: "USD", status: "active" },
          },
        ],
      }
    );
    const mutatedResult = await mutatedRuntime.fork();

    expect(baselineResult.final_output).toContain("150 USD");
    expect(mutatedResult.final_output).toContain("300 USD");
    expect(baselineResult.final_output).not.toBe(mutatedResult.final_output);
  });

  // ── 30. Child Canonical RunArtifact Validation ─────────────────────────────
  it("Requirement 30: child execution generates a valid canonical RunArtifact", async () => {
    const runtime = new ForkRuntime(
      verticalSliceArtifact,
      "chk_run_vertical_slice_ref_001_1",
      { persist: false }
    );

    const result = await runtime.fork();
    expect(result.child_artifact).toBeDefined();
    const parsed = runArtifactSchema.parse(result.child_artifact);
    expect(parsed.identity.run_id).toBe(result.derived_run_id);
    expect(parsed.lineage.parent_run_id).toBe(verticalSliceArtifact.identity.run_id);
  });

  // ── 31 & 32. File & Storage Persistence ────────────────────────────────────
  it("Requirements 31 & 32: persists fork artifact and retrieves via getCanonicalRun", async () => {
    const runtime = new ForkRuntime(
      verticalSliceArtifact,
      "chk_run_vertical_slice_ref_001_1",
      { persist: true }
    );

    const result = await runtime.fork();
    expect(result.status).toBe("COMPLETED");

    const retrieved = await getCanonicalRun(result.derived_run_id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.identity.run_id).toBe(result.derived_run_id);
    expect(retrieved?.lineage.parent_run_id).toBe(verticalSliceArtifact.identity.run_id);
  });

  // ── 33. Lineage Querying & Materialized View ────────────────────────────────
  it("Requirement 33: queries parent, ancestors, and materializes lineage view", async () => {
    await saveCanonicalRun(verticalSliceArtifact);
    const runtime = new ForkRuntime(
      verticalSliceArtifact,
      "chk_run_vertical_slice_ref_001_1",
      { persist: true }
    );
    const result = await runtime.fork();

    const parent = await getParentRun(result.derived_run_id);
    expect(parent?.identity.run_id).toBe(verticalSliceArtifact.identity.run_id);

    const ancestors = await getAncestors(result.derived_run_id);
    expect(ancestors.length).toBeGreaterThan(0);
    expect(ancestors[0]?.identity.run_id).toBe(verticalSliceArtifact.identity.run_id);

    const view = materializeLineageView(verticalSliceArtifact, result.child_artifact!);
    expect(view.parent_run_id).toBe(verticalSliceArtifact.identity.run_id);
    expect(view.child_run_id).toBe(result.derived_run_id);
    expect(view.steps.some((s) => s.source === "historical_prefix")).toBe(true);
    expect(view.steps.some((s) => s.source === "checkpoint_marker")).toBe(true);
    expect(view.steps.some((s) => s.source === "fork_execution")).toBe(true);
  });

  it("sanitizes candidate model boundaries, child artifacts, and API-facing fork results", async () => {
    const credential = "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD";
    const runtime = new ForkRuntime(verticalSliceArtifact, "chk_run_vertical_slice_ref_001_1", {
      persist: false,
      candidateModelHandler: async () => ({ answer: credential, api_key: credential }),
      executeLogic: async (_adapter, { dependencies }) => dependencies.callModel({
        model: "claude-3-5-sonnet", provider: "anthropic", prompt: `prompt ${credential}`,
      }),
    });

    const result = await runtime.fork();
    expect(result.status).toBe("COMPLETED");
    expect(result.child_artifact?.boundaries).toHaveLength(1);
    expect(result.child_artifact?.boundaries[0]?.input.redaction_status).toBe("partially_redacted");
    expect(JSON.stringify(result)).not.toContain(credential);
  });

  // ── 34 & 35. CLI Checkpoint Listing & Fork ─────────────────────────────────
  it("Requirements 34 & 35: CLI lists checkpoints and executes fork command", async () => {
    const fixturePath = "tests/fixtures/canonical/fixture-h-vertical-slice.json";

    // CLI Checkpoints command
    const exitCodeList = await runCli(["checkpoints", fixturePath, "--json"]);
    expect(exitCodeList).toBe(0);

    // CLI Fork command
    const exitCodeFork = await runCli([
      "fork",
      fixturePath,
      "--checkpoint",
      "chk_run_vertical_slice_ref_001_1",
      "--json",
    ]);
    expect(exitCodeFork).toBe(0);
  });
});
