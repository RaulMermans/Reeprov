import { describe, expect, it } from "vitest";
import { exportRunEvidenceBundle } from "../../../lib/core/evidence/exportBundle";
import { getCanonicalRun } from "../../../lib/core/capture/persistence";
import { softwareEngineeringDomain } from "../domains/softwareEngineering";
import { investigationDomain } from "../domains/investigation";
import { runExperiment } from "../src/harness";
import { loadExperimentalRun } from "../src/persist";
import { invokeModel, ModelInvocationError } from "../src/llm";
import { useTestStore } from "./helpers";
import { join } from "node:path";

describe("P2 integration: both domains through CaptureSession", () => {
  const store = useTestStore("p2-int");

  it("runs software-engineering offline with three distinct agent identities", async () => {
    const result = await runExperiment(softwareEngineeringDomain, {
      mode: "offline_fixture",
      persist: true,
      outputDir: store.outputDir(),
      seed: "int-se",
    });
    expect(result.execution_mode).toBe("offline_fixture");
    expect(result.participating_agent_ids).toEqual(
      expect.arrayContaining(["coder", "reviewer", "release-decision"])
    );
    expect(result.artifact.models.every((model) => model.metadata?.["execution_mode"] === "offline_fixture")).toBe(true);
    expect(result.artifact.models.every((model) => model.metadata?.["provider_http_completed"] !== true)).toBe(true);
    expect(result.artifact.handoffs).toHaveLength(2);
    expect(result.artifact.tools.some((tool) => tool.tool_name === "run_validation")).toBe(true);
    expect(result.artifact.artifacts.length).toBeGreaterThan(0);
    expect(result.artifact.evidence?.test_results?.some((test) => test.origin === "system_recorded")).toBe(true);
    expect(result.artifact.evidence?.verification_events?.some((event) => event.origin === "agent_asserted")).toBe(true);
  });

  it("runs investigation offline with documentary evidence semantics", async () => {
    const result = await runExperiment(investigationDomain, {
      mode: "offline_fixture",
      persist: true,
      outputDir: store.outputDir(),
      seed: "int-inv",
    });
    expect(result.participating_agent_ids).toEqual(
      expect.arrayContaining(["investigator", "validator", "decision"])
    );
    expect(result.artifact.tools.some((tool) => tool.tool_name === "read_record")).toBe(true);
    expect(result.artifact.tools.some((tool) => tool.tool_name === "write_artifact")).toBe(false);
    expect(result.artifact.artifacts.some((artifact) => artifact.name === "SYS-1")).toBe(true);
    const investigator = result.artifact.models.find((model) => model.agent_id === "investigator");
    expect(investigator?.agent_id).toBe("investigator");
  });

  it("preserves handoff provenance and exports a parseable evidence bundle", async () => {
    const result = await runExperiment(softwareEngineeringDomain, {
      mode: "offline_fixture",
      persist: true,
      outputDir: store.outputDir(),
      seed: "int-export",
    });
    const bundle = exportRunEvidenceBundle(result.artifact);
    expect(bundle.format).toBe("reeprov.evidence_bundle.v1");
    expect(bundle.participating_agent_ids).toEqual(
      expect.arrayContaining(["coder", "reviewer", "release-decision"])
    );
    expect(bundle.handoffs?.[0]?.attribution_status).toBe("resolved");
    expect(bundle.integrity.valid).toBe(true);
    const dir = result.persisted!.summary.artifact_dir;
    const reloaded = await loadExperimentalRun(dir);
    expect(reloaded.artifact.identity.run_id).toBe(result.run_id);
    expect(reloaded.ground_truth.run_id).toBe(result.run_id);
    const canonical = await getCanonicalRun(result.run_id);
    expect(canonical?.identity.run_id).toBe(result.run_id);
    expect(canonical?.handoffs?.[0]?.from_agent_id).toBe("coder");
  });

  it("records provider errors as incomplete rather than fabricated success", async () => {
    await expect(
      invokeModel({
        mode: "mocked",
        agentId: "alpha",
        domainId: "mini",
        scenarioId: "mini-v1",
        messages: [],
        maxTokens: 10,
        timeoutMs: 1000,
        mockTurn: { summary: "" } as never,
      })
    ).rejects.toBeInstanceOf(ModelInvocationError);
  });

  it("keeps experimental files isolated from the detector-visible bundle", async () => {
    const result = await runExperiment(investigationDomain, {
      mode: "offline_fixture",
      persist: true,
      outputDir: store.outputDir(),
      seed: "int-iso",
      injection: {
        enabled: true,
        type: "incorrect_assertion",
        target_agent_id: "investigator",
        config: { claim: "All records confirm the intern did it." },
      },
    });
    const bundleText = JSON.stringify(exportRunEvidenceBundle(result.artifact));
    expect(bundleText).not.toMatch(/injection_type|ground_truth|evaluator_only|experimental_seed/);
    const gt = await loadExperimentalRun(join(result.persisted!.summary.artifact_dir));
    expect(gt.ground_truth.injections[0]?.type).toBe("incorrect_assertion");
    expect(gt.ground_truth.control).toBe(false);
  });
});
