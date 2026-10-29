import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { CaptureSession } from "../../capture/sdk";
import { getCanonicalRun } from "../../capture/persistence";
import { InMemoryContentStore, setContentStore } from "../../capture/contentStore";
import { BoundaryReplayHarness } from "../../capture/replayHarness";
import {
  RESOLVER_AGENT_ID,
  TRIAGE_AGENT_ID,
  runTwoAgentIncidentHandoff,
} from "../../capture/multiAgentHandoff";
import { exportRunEvidenceBundle } from "../../evidence/exportBundle";
import {
  isAuthoritativeEvidence,
  validateEvidenceIntegrity,
  validateVerificationSequence,
} from "../evidence";
import { runArtifactSchema, type RunArtifact } from "../runArtifact";
import { CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION } from "../runArtifact";
import { agentHandoffSchema } from "../handoff";
import { resolveExplicitAgentId } from "../identity";
import { adaptLegacyRunToRunArtifact } from "../../adapters/legacyRunAdapter";

function emptyArtifact(overrides: Partial<RunArtifact> = {}): RunArtifact {
  return runArtifactSchema.parse({
    schema_version: CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION,
    identity: {
      run_id: "run_integrity_probe",
      project_id: "p1",
      workflow_id: "w1",
      created_at: "2026-10-29T00:00:00.000Z",
    },
    execution: { status: "completed", started_at: "2026-10-29T00:00:00.000Z", summary: "probe" },
    provenance: { capture_method: "sdk_trace", redaction_verified: true },
    ...overrides,
  });
}

describe("Sprint P1: runtime identity, evidence integrity, persistence, replay, export", () => {
  const testStoreDir = join(process.cwd(), ".reeprov-test-p1-runs");
  const origStoreDir = process.env["REEPROV_STORE_DIR"] ?? process.env["AGENTPULSE_STORE_DIR"];

  beforeEach(() => {
    setContentStore(new InMemoryContentStore());
    process.env["REEPROV_STORE_DIR"] = testStoreDir;
    process.env["AGENTPULSE_STORE_DIR"] = testStoreDir;
  });

  afterEach(async () => {
    if (origStoreDir) {
      process.env["REEPROV_STORE_DIR"] = origStoreDir;
      process.env["AGENTPULSE_STORE_DIR"] = origStoreDir;
    } else {
      delete process.env["REEPROV_STORE_DIR"];
      delete process.env["AGENTPULSE_STORE_DIR"];
    }
    await rm(testStoreDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("does not invent agent identity from empty or generic labels", () => {
    expect(resolveExplicitAgentId(undefined, "", "  ")).toBeUndefined();
    expect(resolveExplicitAgentId("agent", "actor", "unknown")).toBeUndefined();
    expect(resolveExplicitAgentId(" triage-agent ")).toBe("triage-agent");
  });

  it("captures two distinct agent identities, a handoff, and an observed tool result", async () => {
    const session = new CaptureSession({
      projectId: "incident-triage",
      workflowId: "two-agent-handoff-v1",
      summary: "P1 two-agent harness",
      runId: "run_p1_two_agent_001",
    });

    const result = await runTwoAgentIncidentHandoff(session);
    const artifact = result.artifact;

    expect(artifact.identity.participating_agent_ids).toEqual(
      expect.arrayContaining([TRIAGE_AGENT_ID, RESOLVER_AGENT_ID])
    );
    const agentIds = new Set(artifact.trajectory.map((step) => step.agent_id).filter(Boolean));
    expect(agentIds.has(TRIAGE_AGENT_ID)).toBe(true);
    expect(agentIds.has(RESOLVER_AGENT_ID)).toBe(true);
    expect(artifact.handoffs).toHaveLength(1);
    expect(artifact.handoffs[0]?.attribution_status).toBe("resolved");
    expect(artifact.handoffs[0]?.from_agent_id).toBe(TRIAGE_AGENT_ID);
    expect(artifact.handoffs[0]?.to_agent_id).toBe(RESOLVER_AGENT_ID);
    expect(artifact.tools.some((tool) => tool.tool_name === "lookup_incident_ticket")).toBe(true);
    expect(artifact.tools[0]?.agent_id).toBe(TRIAGE_AGENT_ID);
  });

  it("keeps agent-asserted validation distinct from authoritative observations", async () => {
    const session = new CaptureSession({
      projectId: "incident-triage",
      workflowId: "two-agent-handoff-v1",
      summary: "claim vs observation",
      runId: "run_p1_claim_vs_obs",
    });
    const { artifact } = await runTwoAgentIncidentHandoff(session);
    const integrity = validateEvidenceIntegrity(artifact);

    const asserted = integrity.records.find((record) => record.id.includes("agent_claim"));
    const observed = integrity.records.find((record) => record.kind === "test.passed" && record.authoritative);
    expect(asserted?.origin).toBe("agent_asserted");
    expect(asserted?.authoritative).toBe(false);
    expect(observed).toBeDefined();
    expect(isAuthoritativeEvidence("agent_asserted", "authoritative")).toBe(false);
    expect(integrity.asserted_only_verification_count).toBeGreaterThan(0);
    expect(integrity.authoritative_verification_count).toBeGreaterThan(0);
    expect(integrity.outcome_authoritative).toBe(true);
  });

  it("marks missing, malformed, duplicate, out-of-order, and cross-run refs without promoting them to verified evidence", () => {
    const artifact = emptyArtifact({
      identity: {
        run_id: "run_integrity_probe",
        project_id: "p1",
        workflow_id: "w1",
        created_at: "2026-10-29T00:00:00.000Z",
      },
      evidence: {
        verification_events: [
          {
            event_id: "vevt_1",
            run_id: "run_integrity_probe",
            event_type: "test.passed",
            target_type: "test",
            status: "PASSED",
            actor: "resolver-agent",
            evidence_refs: ["", "missing-proof", "run_other:step_9", "step_local"],
            artifact_refs: ["missing-proof"],
            sequence_index: 1,
            origin: "agent_asserted",
            authority: "asserted",
          },
          {
            event_id: "vevt_1",
            run_id: "run_foreign",
            event_type: "test.passed",
            target_type: "test",
            status: "PASSED",
            actor: "resolver-agent",
            evidence_refs: ["step_local"],
            artifact_refs: [],
            sequence_index: 0,
            origin: "agent_asserted",
            authority: "authoritative",
          },
        ],
        test_results: [],
        review_results: [],
        approval_events: [],
        security_events: [],
        final_outcome: {
          status: "SUCCESS",
          verification_status: "PASS",
          completed_at: "2026-10-29T00:00:01.000Z",
        },
      },
      trajectory: [
        {
          step_id: "step_local",
          step_index: 0,
          step_type: "node",
          name: "local",
          started_at: "2026-10-29T00:00:00.000Z",
          status: "completed",
          boundary_ids: [],
          tool_invocation_ids: [],
          model_invocation_ids: [],
          memory_operation_ids: [],
          retrieval_operation_ids: [],
          eval_result_ids: [],
          artifact_ids: [],
        },
      ],
    });

    const sequence = validateVerificationSequence(artifact.evidence?.verification_events ?? []);
    expect(sequence.valid).toBe(false);
    expect(sequence.errors.some((error) => error.includes("Duplicate"))).toBe(true);
    expect(sequence.errors.some((error) => error.includes("Out-of-order"))).toBe(true);

    const integrity = validateEvidenceIntegrity(artifact);
    expect(integrity.valid).toBe(false);
    expect(integrity.references.some((ref) => ref.status === "MALFORMED")).toBe(true);
    expect(integrity.references.some((ref) => ref.status === "MISSING")).toBe(true);
    expect(integrity.references.some((ref) => ref.status === "CROSS_RUN")).toBe(true);
    expect(integrity.references.some((ref) => ref.status === "RESOLVED" && ref.resolved_id === "step_local")).toBe(true);
    expect(integrity.outcome_authoritative).toBe(false);
    expect(integrity.records.every((record) => record.origin !== "agent_asserted" || !record.authoritative)).toBe(true);
  });

  it("persists the two-agent run and reloads identity, handoff, and evidence after a store restart", async () => {
    const session = new CaptureSession({
      projectId: "incident-triage",
      workflowId: "two-agent-handoff-v1",
      summary: "persist",
      runId: "run_p1_persist_001",
    });
    const { artifact } = await runTwoAgentIncidentHandoff(session);
    const reloaded = await getCanonicalRun(artifact.identity.run_id);
    expect(reloaded).toBeDefined();
    expect(reloaded?.identity.participating_agent_ids).toEqual(
      expect.arrayContaining([TRIAGE_AGENT_ID, RESOLVER_AGENT_ID])
    );
    expect(reloaded?.handoffs[0]?.handoff_id).toBe(artifact.handoffs[0]?.handoff_id);
    expect(reloaded?.tools[0]?.tool_name).toBe("lookup_incident_ticket");
  });

  it("replays the captured tool observation by substitution without live side effects", async () => {
    const session = new CaptureSession({
      projectId: "incident-triage",
      workflowId: "two-agent-handoff-v1",
      summary: "replay",
      runId: "run_p1_replay_001",
    });
    const { artifact } = await runTwoAgentIncidentHandoff(session);
    const toolBoundary = artifact.boundaries.find((boundary) => boundary.boundary_type === "tool_call");
    expect(toolBoundary).toBeDefined();
    const harness = new BoundaryReplayHarness([toolBoundary!]);
    const substituted = await harness.substituteTool("lookup_incident_ticket", { ticket_id: "INC-1042" });
    expect(substituted.output).toEqual({ ticket_id: "INC-1042", severity: "high", status: "open" });
    expect(substituted.boundary.replayability).toBe("REPLAYABLE_RECORDED");
  });

  it("exports a machine-readable evidence bundle with identifiers and integrity", async () => {
    const session = new CaptureSession({
      projectId: "incident-triage",
      workflowId: "two-agent-handoff-v1",
      summary: "export",
      runId: "run_p1_export_001",
    });
    const { artifact } = await runTwoAgentIncidentHandoff(session);
    const bundle = exportRunEvidenceBundle(artifact);
    expect(bundle.format).toBe("reeprov.evidence_bundle.v1");
    expect(bundle.identity.run_id).toBe("run_p1_export_001");
    expect(bundle.participating_agent_ids).toEqual(
      expect.arrayContaining([TRIAGE_AGENT_ID, RESOLVER_AGENT_ID])
    );
    expect(bundle.handoffs[0]?.attribution_status).toBe("resolved");
    expect(bundle.trajectory.some((step) => step.attribution === "unknown")).toBe(false);
    expect(bundle.integrity.references.every((ref) => ref.status !== "CROSS_RUN")).toBe(true);
    expect(bundle.artifact.schema_version).toBe(CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION);
    expect(agentHandoffSchema.parse(bundle.handoffs[0]!).run_id).toBe(artifact.identity.run_id);
  });

  it("preserves unknown handoff attribution instead of inventing agents", () => {
    const parsed = agentHandoffSchema.parse({
      handoff_id: "handoff_unknown",
      run_id: "run_x",
      timestamp: "2026-10-29T00:00:00.000Z",
      attribution_status: "unknown",
    });
    expect(parsed.from_agent_id).toBeUndefined();
    expect(parsed.to_agent_id).toBeUndefined();
    expect(parsed.attribution_status).toBe("unknown");
  });

  it("lifts HTTP tool_call events into canonical tools when toolCalls are absent", () => {
    const artifact = adaptLegacyRunToRunArtifact({
      runRecord: {
        run_id: "run_http_tools",
        workflow_id: "two-agent-handoff-v1",
        project_id: "incident-triage",
        project_name: "Incident Triage",
        status: "completed",
        started_at: "2026-10-29T00:00:00.000Z",
        completed_at: "2026-10-29T00:00:01.000Z",
        summary: "http ingest",
        model_calls_count: 0,
        tool_calls_count: 0,
        evals_passed: 0,
        evals_failed: 0,
        artifact_refs: [],
      },
      traceEvents: [
        {
          event_id: "triage.lookup",
          run_id: "run_http_tools",
          workflow_id: "two-agent-handoff-v1",
          timestamp: "2026-10-29T00:00:00.500Z",
          event_type: "tool_call_completed",
          status: "completed",
          node_id: "triage.lookup",
          agent_id: TRIAGE_AGENT_ID,
          parent_event_id: "triage.classify",
          metadata: { tool_name: "lookup_incident_ticket", permission_class: "read_only" },
        },
      ],
      toolCalls: [
        {
          tool_call_id: "triage.lookup",
          run_id: "run_http_tools",
          node_id: "triage.lookup",
          tool_name: "lookup_incident_ticket",
          permission_class: "read_only",
          status: "completed",
          started_at: "2026-10-29T00:00:00.500Z",
        },
      ],
    });

    expect(artifact.tools).toHaveLength(1);
    expect(artifact.tools[0]?.tool_name).toBe("lookup_incident_ticket");
    expect(artifact.tools[0]?.agent_id).toBe(TRIAGE_AGENT_ID);
    expect(artifact.trajectory[0]?.parent_step_id).toBe("triage.classify");
  });
});
