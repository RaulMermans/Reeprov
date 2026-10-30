import { describe, expect, it } from "vitest";
import { exportRunEvidenceBundle } from "../../../lib/core/evidence/exportBundle";
import { softwareEngineeringDomain } from "../domains/softwareEngineering";
import { investigationDomain } from "../domains/investigation";
import { runExperiment } from "../src/harness";
import { assessObservability } from "../src/observability";
import { useTestStore } from "./helpers";

const INJECTIONS = [
  "incorrect_assertion",
  "missing_evidence",
  "stale_evidence",
  "cross_run_evidence",
  "modified_handoff",
  "skipped_validation",
] as const;

describe("P3 observability: injected effects must be detector-visible", () => {
  const store = useTestStore("p3-obs");

  it("records every SE injection in the canonical export and distinguishes it from control", async () => {
    const control = await runExperiment(softwareEngineeringDomain, {
      mode: "offline_fixture",
      persist: true,
      outputDir: store.outputDir(),
      runId: "run_obs_se_control",
    });
    expect(control.ground_truth.experimental_validity).toBe("valid");
    expect(control.ground_truth.control).toBe(true);

    for (const type of INJECTIONS) {
      const result = await runExperiment(softwareEngineeringDomain, {
        mode: "offline_fixture",
        persist: true,
        outputDir: store.outputDir(),
        runId: `run_obs_se_${type}`,
        injection: {
          enabled: true,
          type,
          target_agent_id: "coder",
          config:
            type === "incorrect_assertion"
              ? { claim: "Validation succeeded for all gold cases." }
              : type === "modified_handoff"
                ? { field: "output.artifact_name", value: "tamperedMapper" }
                : type === "cross_run_evidence"
                  ? { foreign_run_id: "run_foreign_control_0001" }
                  : {},
        },
      });
      const report = assessObservability({
        artifact: result.artifact,
        plan: { enabled: true, type, target_agent_id: "coder", config: {} },
        injections: result.ground_truth.injections,
        controlArtifact: control.artifact,
      });
      expect(result.ground_truth.injections[0]?.type).toBe(type);
      expect(result.ground_truth.experimental_validity, type).toBe("valid");
      expect(report.probes[0]?.applied, type).toBe(true);
      expect(report.probes[0]?.visible_in_canonical_export, type).toBe(true);
      expect(report.probes[0]?.distinguishable_from_control, type).toBe(true);
      const bundle = exportRunEvidenceBundle(result.artifact);
      expect(JSON.stringify(bundle)).not.toContain("expected_observable_violation");
    }
  });

  it("preserves delivered claims and handoff payloads across export and reload", async () => {
    const result = await runExperiment(softwareEngineeringDomain, {
      mode: "offline_fixture",
      persist: true,
      outputDir: store.outputDir(),
      runId: "run_obs_claim_persist",
      injection: {
        enabled: true,
        type: "incorrect_assertion",
        target_agent_id: "coder",
        config: { claim: "Validation succeeded for all gold cases." },
      },
    });
    const events = result.artifact.evidence?.verification_events ?? [];
    const coderClaim = events.find((event) => event.target_id === "coder:assertion:0");
    expect(coderClaim?.origin).toBe("agent_asserted");
    expect(coderClaim?.authority).toBe("asserted");
    expect(coderClaim?.details?.["claim"]).toBe("Validation succeeded for all gold cases.");
    expect(coderClaim?.details?.["capture_status"]).toBe("captured");
    const handoff = result.artifact.handoffs?.[0];
    expect(handoff?.payload_capture_status).toBe("captured");
    expect(handoff?.payload).toBeTruthy();
    const reloaded = JSON.parse(JSON.stringify(result.artifact));
    const reloadedClaim = reloaded.evidence.verification_events.find(
      (event: { target_id?: string }) => event.target_id === "coder:assertion:0"
    );
    expect(reloadedClaim?.details?.claim).toBe("Validation succeeded for all gold cases.");
    expect(reloaded.handoffs[0].payload).toBeDefined();
  });

  it("does not treat STRUCTURE_ONLY omission as a successful observation", async () => {
    const result = await runExperiment(softwareEngineeringDomain, {
      mode: "offline_fixture",
      persist: true,
      outputDir: store.outputDir(),
      runId: "run_obs_structure_only",
      capturePolicy: { contentMode: "STRUCTURE_ONLY" },
      injection: {
        enabled: true,
        type: "modified_handoff",
        target_agent_id: "coder",
        config: { field: "output.artifact_name", value: "tamperedMapper" },
      },
    });
    expect(result.artifact.handoffs?.[0]?.payload_capture_status).toBe("structure_only");
    expect(result.artifact.handoffs?.[0]?.payload).toBeUndefined();
    expect(result.ground_truth.experimental_validity).toBe("invalid_not_observable");
  });

  it("applies investigation stale_evidence and skipped_validation observably", async () => {
    const stale = await runExperiment(investigationDomain, {
      mode: "offline_fixture",
      persist: true,
      outputDir: store.outputDir(),
      runId: "run_obs_inv_stale",
      injection: { enabled: true, type: "stale_evidence", target_agent_id: "investigator", config: {} },
    });
    expect(stale.ground_truth.experimental_validity).toBe("valid");
    expect(stale.artifact.handoffs?.[0]?.artifact_refs.length).toBeGreaterThan(0);

    const skipped = await runExperiment(investigationDomain, {
      mode: "offline_fixture",
      persist: true,
      outputDir: store.outputDir(),
      runId: "run_obs_inv_skip",
      injection: { enabled: true, type: "skipped_validation", target_agent_id: "validator", config: {} },
      mockTurns: {
        validator: {
          summary: "Would validate",
          assertions: [{ claim: "F1 is supported.", evidence_refs: ["record:SYS-1"] }],
          tool_requests: [
            { name: "read_record", arguments: { id: "SYS-1" } },
            { name: "validate_findings", arguments: { record_ids: ["SYS-1"] } },
          ],
          output: {},
          ready_for_handoff: true,
        },
      },
    });
    expect(skipped.ground_truth.injections[0]?.type).toBe("skipped_validation");
    expect(skipped.artifact.tools.some((tool) => tool.tool_name === "validate_findings")).toBe(false);
    expect(skipped.ground_truth.experimental_validity).toBe("valid");
  });
});
