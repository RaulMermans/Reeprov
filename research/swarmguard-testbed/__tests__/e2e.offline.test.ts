import { describe, expect, it } from "vitest";
import { exportRunEvidenceBundle } from "../../../lib/core/evidence/exportBundle";
import { validateEvidenceIntegrity } from "../../../lib/core/contracts/evidence";
import { softwareEngineeringDomain } from "../domains/softwareEngineering";
import { investigationDomain } from "../domains/investigation";
import { runExperiment } from "../src/harness";
import { useTestStore } from "./helpers";

describe("P2 e2e: offline deterministic fixtures", () => {
  const store = useTestStore("p2-e2e");

  it("executes Domain A control and injected runs through the same harness", async () => {
    const control = await runExperiment(softwareEngineeringDomain, {
      mode: "offline_fixture",
      persist: true,
      outputDir: store.outputDir(),
      seed: "e2e-se-control",
    });
    const injected = await runExperiment(softwareEngineeringDomain, {
      mode: "offline_fixture",
      persist: true,
      outputDir: store.outputDir(),
      seed: "e2e-se-injected",
      injection: { enabled: true, type: "skipped_validation", target_agent_id: "coder", config: {} },
    });

    expect(control.execution_mode).toBe("offline_fixture");
    expect(control.ground_truth.control).toBe(true);
    expect(control.artifact.tools.some((tool) => tool.tool_name === "run_validation")).toBe(true);
    expect(injected.ground_truth.control).toBe(false);
    expect(injected.artifact.tools.some((tool) => tool.tool_name === "run_validation")).toBe(false);
    expect(
      validateEvidenceIntegrity(injected.artifact).references.some((ref) => ref.status === "CROSS_RUN")
    ).toBe(false);
    expect(control.artifact.identity.participating_agent_ids).toEqual(
      expect.arrayContaining(["coder", "reviewer", "release-decision"])
    );
    const bundle = exportRunEvidenceBundle(control.artifact);
    expect(bundle.models.length).toBe(3);
    expect(bundle.handoffs).toHaveLength(2);
  });

  it("executes Domain B through the same harness with different evidence semantics", async () => {
    const result = await runExperiment(investigationDomain, {
      mode: "offline_fixture",
      persist: true,
      outputDir: store.outputDir(),
      seed: "e2e-inv",
    });
    expect(result.execution_mode).toBe("offline_fixture");
    expect(result.artifact.tools.map((tool) => tool.tool_name).sort()).toEqual(
      expect.arrayContaining(["list_records", "read_record", "search_records"])
    );
    expect(result.artifact.artifacts.some((artifact) => artifact.type.startsWith("incident_record/"))).toBe(true);
    expect(result.artifact.handoffs?.[0]?.from_agent_id).toBe("investigator");
    expect(result.artifact.handoffs?.[1]?.to_agent_id).toBe("decision");
  });
});
