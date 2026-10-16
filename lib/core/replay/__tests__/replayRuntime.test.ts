import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runArtifactSchema, type RunArtifact } from "../../contracts/runArtifact";
import { ReplayRuntime } from "../runtime";
import { buildReplayPlan } from "../planner";
import { BoundaryResolver, BoundaryResolutionError } from "../resolver";
import { StateRestorer, StateRestorationError } from "../stateRestorer";
import { NetworkKillSwitch, NetworkAccessDeniedError } from "../networkGuard";
import { ReplayClock, ReplayRandom } from "../determinism";
import { ReferenceReplayHostAdapter } from "../hostAdapter";
import { InMemoryContentStore, setContentStore } from "../../capture/contentStore";
import { saveReplayResult } from "../persistence";

describe("Deterministic Offline Replay Runtime Suite", () => {
  let referenceArtifact: RunArtifact;

  beforeEach(() => {
    setContentStore(new InMemoryContentStore());
    const fixturePath = path.resolve(
      process.cwd(),
      "tests/fixtures/canonical/fixture-h-vertical-slice.json"
    );
    const raw = fs.readFileSync(fixturePath, "utf8");
    referenceArtifact = runArtifactSchema.parse(JSON.parse(raw));
  });

  // ── 1. Happy Path Full Trajectory Offline Replay ──────────────────────────

  it("replays full 4-step 5-boundary trajectory deterministically offline without network calls", async () => {
    const runtime = new ReplayRuntime(referenceArtifact, {
      mode: "STRICT_OFFLINE",
      persist: false,
    });

    const result = await runtime.replay();

    expect(result.status).toBe("MATCHED");
    expect(result.deterministic_match).toBe(true);
    expect(result.steps_expected).toBe(4);
    expect(result.steps_executed).toBe(4);
    expect(result.boundaries_expected).toBe(5);
    expect(result.boundaries_substituted).toBe(5);
    expect(result.live_calls_attempted).toBe(0);
    expect(result.live_calls_blocked).toBe(0);
    expect(result.divergences).toHaveLength(0);

    // Verify replay events were emitted
    const eventTypes = result.replay_events.map((e) => e.event_type);
    expect(eventTypes).toContain("replay.start");
    expect(eventTypes).toContain("replay.plan.created");
    expect(eventTypes).toContain("replay.state.restored");
    expect(eventTypes).toContain("replay.boundary.substituted");
    expect(eventTypes).toContain("replay.complete");
  });

  // ── 2. Negative: Prompt Divergence (1 character changed) ───────────────────

  it("detects INPUT_HASH_MISMATCH when prompt is modified by even 1 character", async () => {
    const runtime = new ReplayRuntime(referenceArtifact, {
      mode: "STRICT_OFFLINE",
      persist: false,
    });

    const result = await runtime.replay(async (adapter) => {
      const deps = adapter.getDependencies();
      // Step 0 prompt changed by 1 character ("!" instead of ".")
      await deps.callModel({
        model: "claude-3-5-sonnet",
        provider: "anthropic",
        prompt: "User query: \"What is customer cus_1001's current balance and our refund policy?\". Decide next steps!",
      });
    });

    expect(result.status).toBe("DIVERGED");
    expect(result.deterministic_match).toBe(false);
    expect(result.divergences.length).toBeGreaterThan(0);
    expect(result.divergences[0]?.divergence_type).toBe("INPUT_HASH_MISMATCH");
    expect(result.divergences[0]?.message).toContain("Inputs have diverged");
  });

  // ── 3. Negative: Boundary Order / Type Divergence ──────────────────────────

  it("detects BOUNDARY_TYPE_MISMATCH when execution order of boundaries changes", async () => {
    const runtime = new ReplayRuntime(referenceArtifact, {
      mode: "STRICT_OFFLINE",
      persist: false,
    });

    const result = await runtime.replay(async (adapter) => {
      const deps = adapter.getDependencies();
      // At step 0, calls tool instead of expected model_call
      await deps.callTool({
        name: "get_customer_account",
        args: { customer_id: "cus_1001" },
      });
    });

    expect(result.status).toBe("DIVERGED");
    expect(result.divergences.length).toBeGreaterThan(0);
    expect(result.divergences[0]?.divergence_type).toBe("BOUNDARY_TYPE_MISMATCH");
    expect(result.divergences[0]?.message).toContain("Boundary type mismatch");
  });

  // ── 4. Negative: Boundary Identity Divergence ──────────────────────────────

  it("detects BOUNDARY_IDENTITY_MISMATCH when tool name is changed", async () => {
    const runtime = new ReplayRuntime(referenceArtifact, {
      mode: "STRICT_OFFLINE",
      persist: false,
    });

    const result = await runtime.replay(async (adapter) => {
      const deps = adapter.getDependencies();
      // Step 0: matching model call
      const b0 = referenceArtifact.boundaries[0]!;
      await deps.callModel(b0.input.content as any);

      // Step 1: matching retrieval call & model call
      const b1 = referenceArtifact.boundaries[1]!;
      await deps.callRetrieval({
        service: "pinecone_kb",
        query: (b1.input.content as any).query,
      });
      const b2 = referenceArtifact.boundaries[2]!;
      await deps.callModel(b2.input.content as any);

      // Step 2: wrong tool name ("get_customer_profile" instead of "get_customer_account")
      await deps.callTool({
        name: "get_customer_profile",
        args: { customer_id: "cus_1001" },
      });
    });

    expect(result.status).toBe("DIVERGED");
    expect(result.divergences.length).toBeGreaterThan(0);
    expect(result.divergences[0]?.divergence_type).toBe("BOUNDARY_IDENTITY_MISMATCH");
    expect(result.divergences[0]?.message).toContain("Boundary identity mismatch");
  });

  // ── 5. Negative: Missing Recorded Output Payload ───────────────────────────

  it("detects MISSING_PAYLOAD when boundary content is UNAVAILABLE or missing", async () => {
    const modifiedArtifact = JSON.parse(JSON.stringify(referenceArtifact)) as RunArtifact;
    // Mark first boundary as UNAVAILABLE with missing output
    modifiedArtifact.boundaries[0]!.captured_content_availability = "UNAVAILABLE";
    (modifiedArtifact.boundaries[0] as any).output = undefined;

    const runtime = new ReplayRuntime(modifiedArtifact, {
      mode: "STRICT_OFFLINE",
      persist: false,
    });

    const result = await runtime.replay();

    expect(["UNSUPPORTED", "DIVERGED"]).toContain(result.status);
    expect(result.divergences.length).toBeGreaterThan(0);
    const divergenceTypes = result.divergences.map((d) => d.divergence_type);
    expect(divergenceTypes).toContain("MISSING_PAYLOAD");
  });

  // ── 6. Negative: State Hash Verification ───────────────────────────────────

  it("throws STATE_HASH_MISMATCH when state snapshot data does not match hash", () => {
    const modifiedArtifact = JSON.parse(JSON.stringify(referenceArtifact)) as RunArtifact;
    const initialSnapshot = modifiedArtifact.state[0]!;
    // Corrupt snapshot hash
    initialSnapshot.hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

    const restorer = new StateRestorer(modifiedArtifact);
    expect(() => restorer.restoreInitialState()).toThrow(StateRestorationError);
  });

  // ── 7. Negative: Extra Unexpected Boundary ─────────────────────────────────

  it("detects EXTRA_BOUNDARY when application calls more boundaries than recorded", async () => {
    const runtime = new ReplayRuntime(referenceArtifact, {
      mode: "STRICT_OFFLINE",
      persist: false,
    });

    const result = await runtime.replay(async (adapter) => {
      const deps = adapter.getDependencies();
      // Replay all 5 valid boundaries
      for (const b of referenceArtifact.boundaries) {
        if (b.boundary_type === "model_call") {
          await deps.callModel(b.input.content as any);
        } else if (b.boundary_type === "retrieval_call") {
          await deps.callRetrieval({
            service: "pinecone_kb",
            query: (b.input.content as any).query,
          });
        } else if (b.boundary_type === "tool_call") {
          await deps.callTool({
            name: b.name,
            args: b.input.content,
          });
        }
      }

      // Now attempt an extra, unrecorded call
      await deps.callTool({
        name: "extra_tool",
        args: {},
      });
    });

    expect(result.status).toBe("DIVERGED");
    expect(result.divergences.some((d) => d.divergence_type === "EXTRA_BOUNDARY")).toBe(true);
  });

  // ── 8. Negative: Missing Unconsumed Boundary ───────────────────────────────

  it("detects MISSING_BOUNDARY when replay finishes early leaving recorded boundaries unconsumed", async () => {
    const runtime = new ReplayRuntime(referenceArtifact, {
      mode: "STRICT_OFFLINE",
      persist: false,
    });

    const result = await runtime.replay(async (adapter) => {
      const deps = adapter.getDependencies();
      // Only execute boundary 0, then terminate early
      const b0 = referenceArtifact.boundaries[0]!;
      await deps.callModel(b0.input.content as any);
      return "early finish";
    });

    expect(result.status).toBe("DIVERGED");
    expect(result.divergences.some((d) => d.divergence_type === "MISSING_BOUNDARY")).toBe(true);
  });

  // ── 9. Side-Effect Safety Model ───────────────────────────────────────────

  it("blocks live execution attempts on side-effecting boundaries during offline replay", async () => {
    const modifiedArtifact = JSON.parse(JSON.stringify(referenceArtifact)) as RunArtifact;
    // Mark tool boundary as external side effect
    modifiedArtifact.boundaries[3]!.side_effect_class = "external_side_effect";

    const runtime = new ReplayRuntime(modifiedArtifact, {
      mode: "STRICT_OFFLINE",
      persist: false,
    });

    const result = await runtime.replay(async (adapter) => {
      const deps = adapter.getDependencies();
      // B0
      await deps.callModel(modifiedArtifact.boundaries[0]!.input.content as any);
      // B1
      await deps.callRetrieval({
        service: "pinecone_kb",
        query: (modifiedArtifact.boundaries[1]!.input.content as any).query,
      });
      // B2
      await deps.callModel(modifiedArtifact.boundaries[2]!.input.content as any);
      // B3: Attempt live execution!
      await deps.callTool({
        name: modifiedArtifact.boundaries[3]!.name,
        args: modifiedArtifact.boundaries[3]!.input.content,
        sideEffectIntent: "execute_live",
      });
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.live_calls_blocked).toBeGreaterThan(0);
    expect(
      result.divergences.some((d) => d.divergence_type === "SIDE_EFFECT_ATTEMPT_BLOCKED")
    ).toBe(true);
  });

  // ── 10. Network Kill Switch in STRICT_OFFLINE ──────────────────────────────

  it("network kill switch intercepts and blocks live fetch during STRICT_OFFLINE replay", async () => {
    const runtime = new ReplayRuntime(referenceArtifact, {
      mode: "STRICT_OFFLINE",
      persist: false,
    });

    const result = await runtime.replay(async () => {
      // Direct live external network call attempt
      await fetch("https://api.openai.com/v1/chat/completions");
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.live_calls_blocked).toBeGreaterThan(0);
    expect(
      result.divergences.some((d) => d.divergence_type === "NETWORK_ATTEMPT_BLOCKED")
    ).toBe(true);
  });

  // ── 11. Pre-flight ReplayPlan Validation on Corrupted Artifacts ────────────

  it("pre-flight planner marks artifact NOT_REPLAYABLE when schema or trajectory is corrupted", async () => {
    const corrupted = JSON.parse(JSON.stringify(referenceArtifact)) as RunArtifact;
    corrupted.schema_version = "99.0.0"; // unsupported schema version

    const plan = await buildReplayPlan(corrupted, { mode: "STRICT_OFFLINE" });
    expect(plan.replayability_verdict).toBe("NOT_REPLAYABLE");
    expect(plan.unsupported_features.length).toBeGreaterThan(0);

    const runtime = new ReplayRuntime(corrupted, {
      mode: "STRICT_OFFLINE",
      persist: false,
    });
    const result = await runtime.replay();
    expect(result.status).toBe("UNSUPPORTED");
  });

  // ── 12. Determinism Utilities (Clock & Random) ─────────────────────────────

  it("provides deterministic frozen clock and seeded pseudorandom numbers", () => {
    const frozenIso = "2026-10-10T12:00:00.000Z";
    const clock = new ReplayClock(frozenIso);
    expect(clock.toISOString()).toBe(frozenIso);

    const rand1 = new ReplayRandom(42);
    const rand2 = new ReplayRandom(42);
    expect(rand1.nextFloat()).toBe(rand2.nextFloat());
    expect(rand1.nextInt(1, 100)).toBe(rand2.nextInt(1, 100));
  });

  // ── 13. Persistence & Replay Result Storage ────────────────────────────────

  it("persists and verifies replay results to disk storage", async () => {
    const runtime = new ReplayRuntime(referenceArtifact, {
      mode: "STRICT_OFFLINE",
      persist: true,
    });

    const result = await runtime.replay();
    expect(result.status).toBe("MATCHED");

    // Verify file written to .reeprov/replays/
    const replayFileReeprov = path.resolve(process.cwd(), ".reeprov", "replays", `${result.replay_id}.json`);
    const replayFileAgentpulse = path.resolve(process.cwd(), ".agentpulse", "replays", `${result.replay_id}.json`);
    const replayFile = fs.existsSync(replayFileReeprov) ? replayFileReeprov : replayFileAgentpulse;
    expect(fs.existsSync(replayFile)).toBe(true);

    const raw = fs.readFileSync(replayFile, "utf8");
    const stored = JSON.parse(raw);
    expect(stored.result.replay_id).toBe(result.replay_id);
    expect(stored.result.status).toBe("MATCHED");
  });
});
