/**
 * Sprint 13 acceptance matrix: external replay, checkpoint integrity, resumed forks.
 *
 * Hermetic: the published-shape SDK talks to the real route handlers through
 * an in-process fetch. The reference agent's own step code is re-executed.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReeprovClient, ReeprovIngestError, canonicalSha256 } from "@/packages/client-typescript/src/index";
import { runIncidentTriage } from "@/examples/external-agents/incident-triage/agent.mjs";
import { createHostAdapter, TRIAGE_ADAPTER_IDENTITY } from "@/examples/external-agents/incident-triage/adapter.mjs";
import suiteJson from "@/examples/external-agents/incident-triage/eval-suite.json";
import { getCanonicalRun, saveCanonicalRun } from "@/lib/core/capture/persistence";
import { runHostFork, runHostReplay, validateUploadedFork } from "@/lib/core/external/hostRunner";
import { assessCheckpoint } from "@/lib/core/fork/restorability";
import { ForkRuntime } from "@/lib/core/fork/runtime";
import { buildReplayPlan } from "@/lib/core/replay/planner";
import { compareRuns } from "@/lib/core/comparison";
import { evaluateRun } from "@/lib/core/evals/runner";
import { evalSuiteSchema } from "@/lib/core/contracts/evalDefinitions";
import { assessImprovementClaim } from "@/lib/core/comparison/improvementClaim";
import type { RunArtifact } from "@/lib/core/contracts/runArtifact";
import type { ExperimentMutation } from "@/lib/core/contracts/lineage";
import { POST as postForkUpload } from "@/app/api/runs/[runId]/forks/route";
import { POST as postReplayUpload, GET as getReplays } from "@/app/api/runs/[runId]/replays/route";
import { GET as getCheckpoints } from "@/app/api/runs/[runId]/checkpoints/route";
import { deriveExecutionStates } from "@/lib/dashboard/executionState";
import { startInProcessReeprov, INGEST_KEY, type InProcessReeprov } from "./inProcessReeprov";

const ACCESS_KEY = "s13-synthetic-access-key";
const suite = evalSuiteSchema.parse(suiteJson);
const POLICY_V2: ExperimentMutation[] = [
  { mutation_id: "mut_policy_v2_impact", mutation_type: "state_patch", target_identifier: "/config/triage_policy/consider_customer_impact", description: "Consider customer impact (policy v2)", mutated_value: true },
  { mutation_id: "mut_policy_v2_version", mutation_type: "state_patch", target_identifier: "/config/triage_policy/version", description: "Policy version v2", mutated_value: "v2" },
];

let srv: InProcessReeprov;
let outbox: string;
beforeEach(async () => {
  srv = await startInProcessReeprov();
  process.env["REEPROV_ACCESS_KEY"] = ACCESS_KEY;
  outbox = await mkdtemp(join(tmpdir(), "s13-outbox-"));
});
afterEach(async () => {
  delete process.env["REEPROV_ACCESS_KEY"];
  await srv.restore();
});

const newClient = (opts: Partial<ConstructorParameters<typeof ReeprovClient>[0]> = {}) =>
  new ReeprovClient({ url: "http://reeprov.test", ingestKey: INGEST_KEY, projectId: "s13-triage", projectName: "S13", workflowId: "incident_triage", failOpen: false, maxRetries: 2, ...opts });

async function liveBaseline(opts: { metricsCredential?: string; contentMode?: "STRUCTURE_ONLY" | "SAFE_CONTENT" } = {}) {
  const live = await runIncidentTriage({ client: newClient(), outboxDir: outbox, ...opts });
  return { live, artifact: (await getCanonicalRun(live.run_id))! };
}
const outboxLines = async (file: string) => (await readFile(join(outbox, file), "utf8").catch(() => "")).split("\n").filter(Boolean).length;
const dash = (path: string, body?: unknown) => new Request(`http://127.0.0.1${path}`, {
  method: body ? "POST" : "GET", headers: { "content-type": "application/json", "x-reeprov-key": ACCESS_KEY }, body: body ? JSON.stringify(body) : undefined,
});
const params = (runId: string) => ({ params: Promise.resolve({ runId }) });

describe("S13 capture and ingestion contract", () => {
  it("captures an independent run with keyed, sequenced boundaries and registered checkpoints", async () => {
    const { live, artifact } = await liveBaseline();
    expect(live.output).toMatchObject({ severity: "SEV3", action: "defer_to_ticket_queue" });
    expect(artifact.boundaries.map((b) => [b.sequence_index, b.name])).toEqual([
      [0, "get_incident"], [1, "query_metrics"], [2, "get_runbook"], [3, "local/extractive-summarizer-v1"], [4, "create_ticket"],
    ]);
    expect(artifact.boundaries.every((b) => b.boundary_id === `bnd:${live.run_id}:${b.sequence_index}`)).toBe(true);
    expect(artifact.checkpoints.map((c) => [c.checkpoint_id, c.capture_kind, c.boundary_cursor, c.resume_step_index])).toEqual([
      ["start", "REGISTERED", 0, 0], ["after_evidence", "REGISTERED", 4, 4],
    ]);
    expect(live.acks.every((a) => a.ok)).toBe(true);
    expect(await outboxLines("tickets.jsonl")).toBe(1);
  });

  it("de-duplicates an identical keyed boundary and rejects a different one reusing the id", async () => {
    const client = newClient();
    const { run_id } = await client.startRun({ summary: "dup" });
    const first = await client.captureBoundary(run_id, { boundaryId: "b-1", sequenceIndex: 0, boundaryType: "tool_call", name: "lookup", input: { a: 1 }, output: { v: 1 } });
    const again = await client.captureBoundary(run_id, { boundaryId: "b-1", sequenceIndex: 0, boundaryType: "tool_call", name: "lookup", input: { a: 1 }, output: { v: 1 } });
    expect(first.results[0]?.status).toBe("ACCEPTED");
    expect(again.results[0]?.status).toBe("DUPLICATE");
    await expect(client.captureBoundary(run_id, { boundaryId: "b-1", sequenceIndex: 0, boundaryType: "tool_call", name: "lookup", input: { a: 1 }, output: { v: 2 } }))
      .rejects.toThrow(/BOUNDARY_ID_CONFLICT/);
    const art = (await getCanonicalRun(run_id))!;
    expect(art.boundaries).toHaveLength(1);
    expect(art.boundaries[0]?.output?.content).toEqual({ v: 1 });
  });

  it("stores every boundary under concurrent ingestion with unique sequences", async () => {
    const client = newClient();
    const { run_id } = await client.startRun({ summary: "concurrency" });
    const acks = await Promise.all(Array.from({ length: 25 }, (_, i) =>
      client.captureBoundary(run_id, { boundaryType: "tool_call", name: `tool_${i}`, input: { i }, output: { i } })));
    expect(acks.every((a) => a.ok && a.results[0]?.status === "ACCEPTED")).toBe(true);
    const art = (await getCanonicalRun(run_id))!;
    expect(art.boundaries).toHaveLength(25);
    expect(new Set(art.boundaries.map((b) => b.sequence_index)).size).toBe(25);
    expect(client.confirmedBoundaryCursor(run_id)).toBe(25);
  });

  it("makes a retried event and boundary idempotent after a lost acknowledgement", async () => {
    const client = newClient();
    const { run_id } = await client.startRun({ summary: "retry" });
    const droppedOnce = new Set<string>();
    srv.faults.dropResponse = (path) => path.startsWith("/api/traces/") && !droppedOnce.has(path) && Boolean(droppedOnce.add(path));
    const boundaryAck = await client.captureBoundary(run_id, { boundaryType: "tool_call", name: "lookup", input: {}, output: { v: 1 } });
    const eventAck = await client.evalCompleted({ run_id, eval_id: "e1", eval_name: "E1", passed: true, score: 1 });
    expect(boundaryAck).toMatchObject({ ok: true, duplicates: 1 });
    expect(eventAck).toMatchObject({ ok: true, duplicates: 1 });
    const art = (await getCanonicalRun(run_id))!;
    expect(art.boundaries).toHaveLength(1);
    expect(srv.calls.filter((c) => c.status === "dropped")).toHaveLength(2);
  });

  it("never reports success for failed or missing acknowledgements", async () => {
    const strict = newClient();
    await expect(strict.captureBoundary("no-such-run", { boundaryType: "tool_call", name: "x", input: {} })).rejects.toBeInstanceOf(ReeprovIngestError);
    const lenient = newClient({ failOpen: true });
    const rejected = await lenient.captureBoundary("no-such-run", { boundaryType: "tool_call", name: "x", input: {} });
    expect(rejected).toMatchObject({ ok: false, rejected: 1 });
    expect(rejected.results[0]?.code).toBe("RUN_NOT_FOUND");
    srv.faults.unavailable = () => true;
    const unreachable = await lenient.captureBoundary("any", { boundaryType: "tool_call", name: "x", input: {} });
    expect(unreachable).toMatchObject({ ok: false, delivery: "unreachable" });
  });

  it("records checkpoint observations without making them restorable, forkable or replay boundaries", async () => {
    const client = newClient();
    const { run_id } = await client.startRun({ summary: "observe" });
    await client.captureBoundary(run_id, { boundaryType: "tool_call", name: "lookup", input: {}, output: { v: 1 } });
    const obs = await client.checkpointObserved({ run_id, checkpoint_id: "cp_obs", state: { phase: "x" } });
    const legacy = await client.captureBoundary(run_id, { boundaryType: "checkpoint", name: "checkpoint:cp_legacy", output: { s: 1 }, metadata: { checkpoint_id: "cp_legacy" } });
    expect(obs.status).toBe("OBSERVATION_RECORDED");
    expect(legacy.results[0]?.status).toBe("OBSERVATION_RECORDED");
    const art = (await getCanonicalRun(run_id))!;
    expect(art.boundaries.map((b) => b.boundary_type)).toEqual(["tool_call"]);
    expect(art.checkpoints).toHaveLength(0);
    expect(art.checkpoint_observations.map((o) => [o.checkpoint_id, o.restorable])).toEqual([["cp_obs", false], ["cp_legacy", false]]);
    expect((await buildReplayPlan(art, { verifyBlobs: false })).unsupported_features).toEqual([]);
    const fork = await runHostFork({ source: art, adapter: createHostAdapter(), checkpointId: "cp_obs", mutations: [] });
    expect(fork.status).toBe("UNSUPPORTED");
    expect(fork.errors[0]).toMatch(/^CHECKPOINT_OBSERVATION_ONLY/);
  });
});

describe("S13 checkpoint integrity", () => {
  it("registers a valid checkpoint but advertises it only after a compatible host is verified", async () => {
    const { artifact } = await liveBaseline();
    const cp = artifact.checkpoints.find((c) => c.checkpoint_id === "after_evidence")!;
    expect(assessCheckpoint(artifact, cp).status).toBe("STATE_VALID_HOST_UNVERIFIED");
    const host = createHostAdapter();
    expect(assessCheckpoint(artifact, cp, { host: { identity: host.identity, supportsResume: (p) => host.supportsResume(p) } }).status).toBe("RESTORABLE");
  });

  it("rejects a corrupted state hash in transit and detects a corrupted stored snapshot", async () => {
    const client = newClient();
    const { run_id } = await client.startRun({ summary: "hash" });
    const res = await fetch(`http://reeprov.test/api/runs/${run_id}/checkpoints`, {
      method: "POST", headers: { "content-type": "application/json", "x-reeprov-key": INGEST_KEY },
      body: JSON.stringify({ kind: "register", checkpoint_id: "c1", step_id: "s", resume_step_index: 0, boundary_cursor: 0, state: { a: 1 }, state_hash: await canonicalSha256({ a: 2 }), adapter: TRIAGE_ADAPTER_IDENTITY }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("CHECKPOINT_STATE_HASH_MISMATCH");

    const { artifact } = await liveBaseline();
    const tampered: RunArtifact = structuredClone(artifact);
    const snap = tampered.state.find((s) => s.snapshot_id.endsWith("after_evidence"))!;
    (snap.state_data as Record<string, unknown>)["decision_override"] = "SEV3";
    const fork = await runHostFork({ source: tampered, adapter: createHostAdapter(), checkpointId: "after_evidence", mutations: POLICY_V2 });
    expect(fork.status).toBe("UNSUPPORTED");
    expect(fork.errors.join(" ")).toMatch(/CHECKPOINT_CORRUPT/);
  });

  it("refuses a checkpoint whose snapshot is missing", async () => {
    const { artifact } = await liveBaseline();
    const broken: RunArtifact = { ...structuredClone(artifact), state: artifact.state.filter((s) => !s.snapshot_id.endsWith("after_evidence")) };
    const cp = broken.checkpoints.find((c) => c.checkpoint_id === "after_evidence")!;
    expect(assessCheckpoint(broken, cp)).toMatchObject({ status: "INVALID", advertised_restorable: false });
    const fork = await runHostFork({ source: broken, adapter: createHostAdapter(), checkpointId: "after_evidence", mutations: POLICY_V2 });
    expect(fork.errors.join(" ")).toMatch(/MISSING_SNAPSHOT/);
  });

  it("refuses an incompatible host adapter and an unsupported resume point", async () => {
    const { artifact } = await liveBaseline();
    const wrongVersion = { ...createHostAdapter(), identity: { adapter_id: TRIAGE_ADAPTER_IDENTITY.adapter_id, adapter_version: "2.0.0" } };
    const incompatible = await runHostFork({ source: artifact, adapter: wrongVersion, checkpointId: "after_evidence", mutations: POLICY_V2 });
    expect(incompatible.status).toBe("UNSUPPORTED");
    expect(incompatible.errors[0]).toMatch(/^INCOMPATIBLE_HOST_ADAPTER/);

    const client = newClient();
    const { run_id } = await client.startRun({ summary: "resume-point" });
    await client.registerCheckpoint({ run_id, checkpoint_id: "mid", step_id: "query_metrics", step_index: 1, resume_step_index: 2, state: { incident_id: "INC-2041", config: { triage_policy: {} } }, adapter: TRIAGE_ADAPTER_IDENTITY });
    const art = (await getCanonicalRun(run_id))!;
    const unsupported = await runHostFork({ source: art, adapter: createHostAdapter(), checkpointId: "mid", mutations: [] });
    expect(unsupported.errors[0]).toMatch(/^UNSUPPORTED_RESUME_POINT/);
  });

  it("never fabricates a server-side fork for an external checkpoint", async () => {
    const { artifact } = await liveBaseline();
    const result = await new ForkRuntime(artifact, "after_evidence", { persist: false }).fork();
    expect(result.status).toBe("UNSUPPORTED");
    expect(result.errors[0]).toMatch(/^HOST_ADAPTER_REQUIRED/);
    expect(result.steps_executed).toBe(0);
  });
});

describe("S13 offline replay of the external agent", () => {
  it("replays identical input: host re-executed, all calls substituted, output and state verified, no side effect repeated", async () => {
    const { artifact } = await liveBaseline();
    const replay = await runHostReplay({ source: artifact, adapter: createHostAdapter() });
    expect(replay).toMatchObject({ status: "MATCHED", verification: "VERIFIED", steps_executed: 7, boundaries_substituted: 5 });
    expect(replay.host_execution?.kind).toBe("HOST_REEXECUTED");
    expect(replay.output_check?.status).toBe("MATCHED");
    expect(replay.state_checks).toEqual([expect.objectContaining({ checkpoint_id: "after_evidence", status: "MATCHED" })]);
    expect(replay.boundary_matches?.find((m) => m.name === "create_ticket")?.side_effect_substituted).toBe(true);
    expect(await outboxLines("tickets.jsonl")).toBe(1);
  });

  it("detects divergence when the input changes", async () => {
    const { artifact } = await liveBaseline();
    const replay = await runHostReplay({ source: artifact, adapter: createHostAdapter(), inputMutations: [
      { mutation_id: "mut_incident", mutation_type: "state_patch", target_identifier: "/incident_id", description: "different incident", mutated_value: "INC-9999" },
    ] });
    expect(replay.status).toBe("DIVERGED");
    expect(replay.divergences[0]).toMatchObject({ divergence_type: "INPUT_HASH_MISMATCH", boundary_sequence: 0 });
  });

  it("only partially verifies inputs whose recording was redacted", async () => {
    const { artifact } = await liveBaseline({ metricsCredential: "synthetic-credential-value-1234567890" });
    const recorded = artifact.boundaries.find((b) => b.name === "query_metrics")!;
    expect(JSON.stringify(recorded)).not.toContain("synthetic-credential-value-1234567890");
    const exact = await runHostReplay({ source: artifact, adapter: createHostAdapter({ metricsCredential: "a-different-credential-0000000000" }) });
    expect(exact.status).toBe("UNSUPPORTED");
    expect(exact.divergences[0]?.divergence_type).toBe("INPUT_UNVERIFIABLE");
    const partial = await runHostReplay({ source: artifact, adapter: createHostAdapter({ metricsCredential: "a-different-credential-0000000000" }), verification: "ALLOW_PARTIAL" });
    expect(partial).toMatchObject({ status: "MATCHED", verification: "PARTIALLY_VERIFIED", deterministic_match: false });
  });

  it("blocks a host that tries live network I/O during replay", async () => {
    const { artifact } = await liveBaseline();
    const base = createHostAdapter();
    const leaky = { ...base, async run(p: Parameters<typeof base.run>[0]) { await fetch("https://example.invalid/page"); return base.run(p); } };
    const replay = await runHostReplay({ source: artifact, adapter: leaky });
    expect(replay.status).toBe("BLOCKED");
    expect(replay.divergences.map((d) => d.divergence_type)).toContain("NETWORK_ATTEMPT_BLOCKED");
  });

  it("refuses replay without a restorable start checkpoint", async () => {
    const { artifact } = await liveBaseline({ contentMode: "STRUCTURE_ONLY" });
    expect(artifact.checkpoints).toHaveLength(0);
    const replay = await runHostReplay({ source: artifact, adapter: createHostAdapter() });
    expect(replay.status).toBe("UNSUPPORTED");
  });
});

describe("S13 genuine resumed fork and semantic improvement", () => {
  async function forkScenario() {
    const { live, artifact: baseline } = await liveBaseline();
    const baselineReplay = await runHostReplay({ source: baseline, adapter: createHostAdapter() });
    const fork = await runHostFork({ source: baseline, adapter: createHostAdapter(), checkpointId: "after_evidence", mutations: POLICY_V2, forkId: `fork_${live.run_id}` });
    return { live, baseline, baselineReplay, fork, child: fork.child_artifact! };
  }

  it("resumes after the checkpoint, never re-runs the prefix, and blocks the new side effect", async () => {
    const { baseline, fork, child } = await forkScenario();
    expect(fork.status).toBe("COMPLETED");
    expect(fork.resume_proof).toMatchObject({ resume_step_index: 4, first_executed_step_index: 4, executed_step_indices: [4, 5, 6], prefix_steps_executed: 0, checkpoint_cursor: 4 });
    expect(fork.call_dispositions).toEqual([expect.objectContaining({ name: "page_oncall", disposition: "BLOCKED_SIMULATED" })]);
    expect(fork.final_output).toMatchObject({ severity: "SEV1", action: "page_oncall", policy_version: "v2" });
    expect(child.boundaries.map((b) => b.name)).toEqual(["page_oncall"]);
    expect(await outboxLines("pages.jsonl")).toBe(0);
    expect(child.lineage).toMatchObject({ parent_run_id: baseline.identity.run_id, root_run_id: baseline.identity.run_id, fork_checkpoint_id: "after_evidence" });
    expect(validateUploadedFork(baseline, child).ok).toBe(true);
  });

  it("uploads the child with correct lineage and then advertises the checkpoint as resume-verified", async () => {
    const { baseline, child } = await forkScenario();
    const stored = await postForkUpload(dash(`/api/runs/${baseline.identity.run_id}/forks`, { child_artifact: child }), params(baseline.identity.run_id));
    expect(stored.status).toBe(201);
    expect((await stored.json()).checkpoint_assessment).toMatchObject({ status: "RESTORABLE", verified_by: { kind: "RESUMED_FORK" } });
    const listing = await (await getCheckpoints(dash(`/api/runs/${baseline.identity.run_id}/checkpoints`), params(baseline.identity.run_id))).json();
    expect(listing.assessments.find((a: { checkpoint_id: string }) => a.checkpoint_id === "after_evidence").advertised_restorable).toBe(true);

    const wrongParent = { ...structuredClone(child), identity: { ...child.identity, run_id: "fork_other" }, lineage: { ...child.lineage, parent_run_id: "someone-else" } };
    const rejected = await postForkUpload(dash(`/api/runs/${baseline.identity.run_id}/forks`, { child_artifact: wrongParent }), params(baseline.identity.run_id));
    expect(rejected.status).toBe(422);
    const rerun = { ...structuredClone(child), identity: { ...child.identity, run_id: "fork_rerun" } };
    (rerun.provenance.metadata!["fork"] as { resume_proof: { prefix_steps_executed: number } }).resume_proof.prefix_steps_executed = 4;
    const notAFork = await postForkUpload(dash(`/api/runs/${baseline.identity.run_id}/forks`, { child_artifact: rerun }), params(baseline.identity.run_id));
    expect((await notAFork.json()).errors.join(" ")).toMatch(/prefix steps were re-executed/);
  });

  it("baseline fails the domain eval, the candidate passes, and the improvement is evidence-backed", async () => {
    const { baseline, baselineReplay, child } = await forkScenario();
    const be = await evaluateRun(baseline, suite, { persist: false, enrichArtifact: false });
    const ce = await evaluateRun(child, suite, { persist: false, enrichArtifact: false });
    expect(be.summary.suite_verdict).toBe("FAILED");
    expect(be.results.filter((r) => !r.passed).map((r) => r.eval_definition_id).sort()).toEqual(
      ["triage.correct_severity", "triage.no_deferral", "triage.pages_oncall", "triage.required_evidence"]);
    expect(be.results.find((r) => r.eval_definition_id === "triage.no_unauthorized_side_effects")?.passed).toBe(true);
    expect(ce.summary.suite_verdict).toBe("PASSED");

    const comparison = await compareRuns(baseline, child);
    const claim = assessImprovementClaim({ baseline, candidate: child, comparison, baselineEvaluation: be, candidateEvaluation: ce, baselineReplay });
    expect(claim.failed_conditions).toEqual([]);
    expect(claim.verdict).toBe("IMPROVEMENT_VERIFIED");
    expect(claim.fixed_eval_ids).toHaveLength(4);
    // Fork-aware alignment: the shared prefix does not diverge; the branch is the action.
    const toolDivergences = comparison.divergences.filter((d) => d.dimension === "TOOL_SELECTION");
    expect(toolDivergences.map((d) => d.description)).not.toContain("Tool 'query_metrics' invoked in baseline only");
    expect(toolDivergences[0]?.description).toMatch(/create_ticket.*page_oncall/);
    expect(claim.evidence_divergence).toBeDefined();
    // Fork state is compared against the parent's checkpoint snapshot: only the controlled mutations differ.
    const statePaths = comparison.divergences.filter((d) => d.dimension === "STATE").map((d) => d.description);
    expect(statePaths.join(" ")).toMatch(/consider_customer_impact/);
    expect(statePaths.join(" ")).not.toMatch(/sev1_error_rate|evidence_refs/);
  });

  it("makes no improvement claim for an independent rerun, an unchanged fork or an unverified replay", async () => {
    const { baseline, baselineReplay, child } = await forkScenario();
    const be = await evaluateRun(baseline, suite, { persist: false, enrichArtifact: false });
    const ce = await evaluateRun(child, suite, { persist: false, enrichArtifact: false });
    const comparison = await compareRuns(baseline, child);

    const independent = structuredClone(child);
    independent.lineage = { mutations: [] };
    expect(assessImprovementClaim({ baseline, candidate: independent, comparison, baselineEvaluation: be, candidateEvaluation: ce, baselineReplay }).failed_conditions.join(" ")).toMatch(/NOT_A_RESUMED_FORK/);

    const unchanged = await runHostFork({ source: baseline, adapter: createHostAdapter(), checkpointId: "after_evidence", mutations: [] });
    const ue = await evaluateRun(unchanged.child_artifact!, suite, { persist: false, enrichArtifact: false });
    expect(unchanged.status).toBe("COMPLETED");
    expect(assessImprovementClaim({ baseline, candidate: unchanged.child_artifact!, comparison: await compareRuns(baseline, unchanged.child_artifact!), baselineEvaluation: be, candidateEvaluation: ue, baselineReplay }).verdict).toBe("NO_IMPROVEMENT_CLAIM");

    const partialReplay = { ...baselineReplay, verification: "PARTIALLY_VERIFIED" as const };
    expect(assessImprovementClaim({ baseline, candidate: child, comparison, baselineEvaluation: be, candidateEvaluation: ce, baselineReplay: partialReplay }).verdict).toBe("NO_IMPROVEMENT_CLAIM");
    expect(assessImprovementClaim({ baseline, candidate: child, comparison, baselineEvaluation: be, candidateEvaluation: be, baselineReplay }).verdict).toBe("NO_IMPROVEMENT_CLAIM");
  });

  it("stores runner replays only when their claims are internally consistent", async () => {
    const { baseline, baselineReplay } = await forkScenario();
    const runId = baseline.identity.run_id;
    expect((await postReplayUpload(dash(`/api/runs/${runId}/replays`, { replay: baselineReplay }), params(runId))).status).toBe(201);
    const inflated = { ...baselineReplay, replay_id: "inflated", status: "DIVERGED" as const };
    expect((await postReplayUpload(dash(`/api/runs/${runId}/replays`, { replay: inflated }), params(runId))).status).toBe(422);
    const listed = await (await getReplays(dash(`/api/runs/${runId}/replays`), params(runId))).json();
    expect(listed.replays.map((r: { replay_id: string }) => r.replay_id)).toEqual([baselineReplay.replay_id]);
  });
});

describe("S13 privacy-preserving persistence and export", () => {
  it("keeps synthetic credentials out of every persisted file and honours STRUCTURE_ONLY", async () => {
    const secret = "synthetic-credential-value-1234567890";
    const { live } = await liveBaseline({ metricsCredential: secret });
    const fork = await runHostFork({ source: (await getCanonicalRun(live.run_id))!, adapter: createHostAdapter({ metricsCredential: secret }), checkpointId: "after_evidence", mutations: POLICY_V2 });
    await saveCanonicalRun(fork.child_artifact!);
    const { artifact: structureOnly } = await liveBaseline({ contentMode: "STRUCTURE_ONLY" });
    expect(structureOnly.boundaries.every((b) => b.input.content === undefined && b.output?.content === undefined)).toBe(true);
    expect(structureOnly.evidence?.final_outcome?.payload).toBeUndefined();

    const files = await readdir(join(srv.storeDir, "runs"));
    for (const file of files.filter((f) => f.endsWith(".json"))) {
      expect(await readFile(join(srv.storeDir, "runs", file), "utf8")).not.toContain(secret);
    }
  });
});

describe("S13 Studio execution-state labels", () => {
  it("labels only what the evidence shows", async () => {
    const { artifact } = await liveBaseline();
    expect(deriveExecutionStates(artifact, []).map((s) => s.label)).toEqual(["RECORDED"]);
    expect(deriveExecutionStates({ ...artifact, execution: { ...artifact.execution, status: "running" } }, []).map((s) => s.label)).toEqual(["LIVE"]);
    const verified = await runHostReplay({ source: artifact, adapter: createHostAdapter() });
    expect(deriveExecutionStates(artifact, [verified]).map((s) => s.label)).toEqual(["RECORDED", "REPLAYED"]);
    const selfCheck = { ...verified, replay_id: "self", completed_at: "9999-01-01T00:00:00.000Z", host_execution: { kind: "RECORDED_SELF_CHECK" as const, runner: "ReplayRuntime", input_mutations: [] } };
    expect(deriveExecutionStates(artifact, [verified, selfCheck]).map((s) => s.label)).toEqual(["RECORDED", "REPLAYED"]);
    const { artifact: redacted } = await liveBaseline({ metricsCredential: "synthetic-credential-value-1234567890" });
    const partial = await runHostReplay({ source: redacted, adapter: createHostAdapter({ metricsCredential: "x-credential-0000000000000000" }), verification: "ALLOW_PARTIAL" });
    expect(deriveExecutionStates(redacted, [partial]).map((s) => s.label)).toEqual(["RECORDED", "PARTIALLY VERIFIED"]);
    const refused = await runHostReplay({ source: redacted, adapter: createHostAdapter({ metricsCredential: "x-credential-0000000000000000" }) });
    expect(deriveExecutionStates(redacted, [refused]).map((s) => s.label)).toEqual(["RECORDED", "UNSUPPORTED"]);
    const fork = await runHostFork({ source: artifact, adapter: createHostAdapter(), checkpointId: "after_evidence", mutations: POLICY_V2 });
    expect(deriveExecutionStates(fork.child_artifact!, []).map((s) => s.label)).toEqual(["FORKED"]);
  });
});
