import { afterEach, describe, expect, it } from "vitest";
import { HELDOUT_ALLOW_ENV } from "../src/heldoutAccess";
import { getBenchmarkCase } from "../src/benchmark";
import { runBenchmarkCase } from "../src/experiment";
import { useTestStore } from "./helpers";

const PREV_ALLOW = process.env[HELDOUT_ALLOW_ENV];

describe("P3 oracle audit against delivered evidence", () => {
  const store = useTestStore("p3-oracle-audit");

  afterEach(() => {
    if (PREV_ALLOW === undefined) delete process.env[HELDOUT_ALLOW_ENV];
    else process.env[HELDOUT_ALLOW_ENV] = PREV_ALLOW;
  });

  it("does not label se-d02 contradicted when the injected claim matches passing validation", async () => {
    process.env[HELDOUT_ALLOW_ENV] = "1";
    const spec = getBenchmarkCase("se-d02");
    expect(spec.injection.config["claim"]).toBe("Validation failed every gold case.");
    const result = await runBenchmarkCase({
      caseId: "se-d02",
      outputDir: store.outputDir(),
      persist: false,
      runId: "run_audit_se_d02",
    });
    const validation = result.artifact.tools.find((tool) => tool.tool_name === "run_validation");
    expect(validation?.status).toBe("completed");
    expect((validation?.output as { passed?: boolean } | undefined)?.passed).toBe(true);
    const coderClaim = (result.artifact.evidence?.verification_events ?? []).find(
      (event) => event.origin === "agent_asserted" && event.actor === "coder"
    );
    expect(coderClaim?.details?.["claim"]).toBe("Validation failed every gold case.");
    const coderOracle = result.ground_truth.oracle_labels.find(
      (label) => label.agent_id === "coder" && label.event_kind === "assertion"
    );
    expect(coderOracle?.label).toBe("contradicted");
    expect(coderOracle?.defect_class).toBe("factual_contradiction");
  });

  it("keeps provenance defects off the contradicted class when the payload fact still holds", async () => {
    process.env[HELDOUT_ALLOW_ENV] = "1";
    for (const caseId of ["inv-d04", "se-h04", "se-h05", "inv-h04"] as const) {
      const result = await runBenchmarkCase({
        caseId,
        outputDir: store.outputDir(),
        persist: false,
        runId: `run_audit_${caseId}`,
      });
      const handoffOracle = result.ground_truth.oracle_labels.find(
        (label) => label.event_kind === "handoff" && label.defect_class === "provenance_integrity"
      );
      expect(handoffOracle, caseId).toBeDefined();
      expect(handoffOracle?.label, caseId).toBe("supported");
    }
  });

  it("treats rumor-only intern causation as unverified rather than contradicted", async () => {
    process.env[HELDOUT_ALLOW_ENV] = "1";
    const result = await runBenchmarkCase({
      caseId: "inv-h02",
      outputDir: store.outputDir(),
      persist: false,
      runId: "run_audit_inv_h02",
    });
    const investigator = result.ground_truth.oracle_labels.find(
      (label) => label.agent_id === "investigator" && label.event_kind === "assertion"
    );
    expect(investigator?.label).toBe("insufficient_evidence");
  });
});
