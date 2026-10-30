import { describe, expect, it } from "vitest";
import { exportRunEvidenceBundle } from "../../../lib/core/evidence/exportBundle";
import { validateEvidenceIntegrity } from "../../../lib/core/contracts/evidence";
import { softwareEngineeringDomain } from "../domains/softwareEngineering";
import { runExperiment } from "../src/harness";
import { findGroundTruthLeaks } from "../src/isolation";
import { miniDomain, turn, useTestStore } from "./helpers";

describe("P2 adversarial: missing or mismatched evidence", () => {
  const store = useTestStore("p2-adv-miss");

  it("records a missing-evidence handoff without labeling the injection in the stream", async () => {
    const result = await runExperiment(softwareEngineeringDomain, {
      mode: "offline_fixture",
      persist: true,
      outputDir: store.outputDir(),
      injection: { enabled: true, type: "missing_evidence", target_agent_id: "coder", config: {} },
    });
    const handoff = result.artifact.handoffs?.[0];
    expect(handoff?.evidence_refs ?? []).toEqual([]);
    expect(JSON.stringify(result.artifact)).not.toMatch(/missing_evidence|injection_type/);
    expect(result.ground_truth.injections[0]?.type).toBe("missing_evidence");
  });
});

describe("P2 adversarial: duplicate or reordered events", () => {
  const store = useTestStore("p2-adv-dup");

  it("keeps monotonic verification sequence indexes on a real run", async () => {
    const result = await runExperiment(miniDomain(), {
      mode: "mocked",
      persist: true,
      outputDir: store.outputDir(),
      mockTurns: {
        alpha: turn({ summary: "a", assertions: [{ claim: "one", evidence_refs: [] }] }),
        beta: turn({ summary: "b", assertions: [{ claim: "two", evidence_refs: [] }] }),
      },
    });
    const events = result.artifact.evidence?.verification_events ?? [];
    expect(events.map((event) => event.sequence_index)).toEqual(events.map((_, index) => index));
    const cloned = structuredClone(result.artifact);
    if (cloned.evidence?.verification_events[1]) {
      cloned.evidence.verification_events[1].sequence_index = 0;
    }
    const integrity = validateEvidenceIntegrity(cloned);
    expect(integrity.valid).toBe(false);
    expect(integrity.errors.some((error) => /Out-of-order|Duplicate/i.test(error))).toBe(true);
  });
});

describe("P2 adversarial: cross-run contamination", () => {
  const store = useTestStore("p2-adv-cross");

  it("preserves foreign evidence refs as unresolved cross-run pointers", async () => {
    const result = await runExperiment(softwareEngineeringDomain, {
      mode: "offline_fixture",
      persist: true,
      outputDir: store.outputDir(),
      injection: {
        enabled: true,
        type: "cross_run_evidence",
        target_agent_id: "coder",
        config: { foreign_run_id: "run_foreign_control_0001" },
      },
    });
    const integrity = validateEvidenceIntegrity(result.artifact);
    expect(integrity.references.some((ref) => ref.status === "CROSS_RUN")).toBe(true);
    expect(integrity.valid).toBe(false);
    expect(findGroundTruthLeaks(exportRunEvidenceBundle(result.artifact))).toEqual([]);
  });
});

describe("P2 adversarial: invalid model responses", () => {
  const store = useTestStore("p2-adv-invalid");

  it("records schema failures without inventing a successful model turn", async () => {
    const result = await runExperiment(miniDomain(), {
      mode: "mocked",
      persist: true,
      outputDir: store.outputDir(),
      mockTurns: {
        alpha: { not: "a turn" } as never,
        beta: turn({ summary: "beta" }),
      },
    });
    expect(result.errors.some((error) => error.code === "schema_invalid")).toBe(true);
    const alpha = result.artifact.models.find((model) => model.agent_id === "alpha");
    expect(alpha?.metadata?.["provider_http_completed"]).toBe(false);
  });
});

describe("P2 adversarial: tool failures and denied tools", () => {
  const store = useTestStore("p2-adv-tool");

  it("captures tool failure without crashing the run", async () => {
    const result = await runExperiment(miniDomain({ failingTool: true }), {
      mode: "mocked",
      persist: true,
      outputDir: store.outputDir(),
      mockTurns: {
        alpha: turn({
          summary: "alpha",
          tool_requests: [{ name: "echo", arguments: { n: 1 } }],
        }),
        beta: turn({ summary: "beta" }),
      },
    });
    expect(result.errors.some((error) => error.code === "tool_failed")).toBe(true);
    expect(result.artifact.tools[0]?.status).toBe("failed");
    expect(result.artifact.handoffs?.length).toBeGreaterThan(0);
  });

  it("denies out-of-role tools", async () => {
    const result = await runExperiment(miniDomain(), {
      mode: "mocked",
      persist: true,
      outputDir: store.outputDir(),
      mockTurns: {
        alpha: turn({
          summary: "alpha",
          tool_requests: [{ name: "secret_write", arguments: {} }],
        }),
        beta: turn({ summary: "beta" }),
      },
    });
    expect(result.errors.some((error) => error.code === "tool_denied")).toBe(true);
    expect(result.artifact.evidence?.security_events?.some((event) => event.decision === "DENY")).toBe(true);
  });
});

describe("P2 adversarial: partial agent completion", () => {
  const store = useTestStore("p2-adv-partial");

  it("persists a partial run when later agents cannot start", async () => {
    const result = await runExperiment(miniDomain(), {
      mode: "mocked",
      persist: true,
      outputDir: store.outputDir(),
      budget: { max_model_calls: 1 },
      mockTurns: {
        alpha: turn({ summary: "alpha" }),
        beta: turn({ summary: "beta" }),
      },
    });
    expect(result.participating_agent_ids).toContain("alpha");
    expect(result.artifact.identity.run_id).toBe(result.run_id);
    expect(result.persisted?.artifact.execution.status).toBeTruthy();
  });
});

describe("P2 adversarial: failure-injection leakage prevention", () => {
  const store = useTestStore("p2-adv-leak");

  it("keeps every injection category out of detector-visible export", async () => {
    const kinds = [
      "incorrect_assertion",
      "missing_evidence",
      "stale_evidence",
      "cross_run_evidence",
      "modified_handoff",
      "skipped_validation",
    ] as const;
    for (const type of kinds) {
      const result = await runExperiment(softwareEngineeringDomain, {
        mode: "offline_fixture",
        persist: true,
        outputDir: store.outputDir(),
        runId: `run_leak_${type}`,
        injection: { enabled: true, type, target_agent_id: "coder", config: {} },
      });
      const visible = exportRunEvidenceBundle(result.artifact);
      expect(findGroundTruthLeaks(visible)).toEqual([]);
      expect(JSON.stringify(visible)).not.toContain("expected_observable_violation");
      expect(result.ground_truth.injections[0]?.type).toBe(type);
    }
  });
});
