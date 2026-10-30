import { describe, expect, it } from "vitest";
import { softwareEngineeringDomain } from "../domains/softwareEngineering";
import { runExperiment } from "../src/harness";
import {
  FROZEN_BASELINES,
  monitorResultSchema,
  runBaseline,
  runPerAgentMonitor,
  runPooledEventMonitor,
} from "../src/baselines";
import { extractObservableClaims } from "../src/baselines/schema";
import { findGroundTruthLeaks } from "../src/leakcheck";
import { useTestStore } from "./helpers";

describe("P3 baselines: frozen, fair, deterministic", () => {
  const store = useTestStore("p3-base");

  it("emits the same schema, uses equivalent evidence, and never reads ground truth", async () => {
    const result = await runExperiment(softwareEngineeringDomain, {
      mode: "offline_fixture",
      persist: true,
      outputDir: store.outputDir(),
      runId: "run_base_se",
      injection: { enabled: true, type: "missing_evidence", target_agent_id: "coder", config: {} },
    });
    const a = runPerAgentMonitor(result.artifact, { caseId: "se-d03", domainId: result.domain_id });
    const b = runPooledEventMonitor(result.artifact, { caseId: "se-d03", domainId: result.domain_id });
    expect(monitorResultSchema.parse(a).format).toBe("reeprov.swarmguard_testbed.monitor_result.v1");
    expect(monitorResultSchema.parse(b).format).toBe(a.format);
    expect(a.predictions.length).toBe(b.predictions.length);
    expect(a.predictions.map((item) => item.claim_id).sort()).toEqual(
      b.predictions.map((item) => item.claim_id).sort()
    );
    expect(findGroundTruthLeaks(a)).toEqual([]);
    expect(findGroundTruthLeaks(b)).toEqual([]);
    expect(JSON.stringify(a)).not.toMatch(/oracle|injection_type|ground_truth|experimental_validity/);
    expect(a.limitations.length).toBeGreaterThan(0);
    expect(b.limitations.length).toBeGreaterThan(0);

    const again = runPerAgentMonitor(result.artifact, { caseId: "se-d03", domainId: result.domain_id });
    expect(again.predictions).toEqual(a.predictions);
    expect(FROZEN_BASELINES).toEqual(["baseline.per_agent.v1", "baseline.pooled_event.v1"]);
    expect(runBaseline("baseline.per_agent.v1", result.artifact).monitor_id).toBe(a.monitor_id);
  });

  it("abstains on incomplete capture rather than inventing an observation", async () => {
    const result = await runExperiment(softwareEngineeringDomain, {
      mode: "offline_fixture",
      persist: true,
      outputDir: store.outputDir(),
      runId: "run_base_incomplete",
      capturePolicy: { contentMode: "STRUCTURE_ONLY" },
    });
    const claims = extractObservableClaims(result.artifact);
    expect(claims.some((claim) => claim.capture_incomplete)).toBe(true);
    const pooled = runPooledEventMonitor(result.artifact);
    expect(pooled.predictions.every((item) => item.classification === "unverified" && item.abstained)).toBe(
      true
    );
  });
});
