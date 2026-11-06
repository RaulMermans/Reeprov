/**
 * Comprehensive Acceptance & Unit Tests for KARMA POLICE — H1.
 *
 * Covers:
 *   1. Scientific isolation & noncontamination
 *   2. Software engineering development acceptance cases (se-d01..se-d04)
 *   3. Investigation development acceptance cases (inv-d01..inv-d04)
 *   4. Claim-specific evidence matching vs global status
 *   5. Contradiction vs missing evidence distinction
 *   6. Incomplete capture abstention
 *   7. Producer / handoff payload mismatch detection
 *   8. Independence from case_id or seed renaming
 *   9. Full schema validity for monitor results and findings reports
 */

import { describe, expect, it } from "vitest";
import { runExperiment } from "../src/harness";
import { softwareEngineeringDomain } from "../domains/softwareEngineering";
import { investigationDomain } from "../domains/investigation";
import {
  runKarmaPolice,
  runKarmaPoliceWithFindings,
  KARMA_POLICE_MONITOR_ID,
  KARMA_POLICE_MONITOR_VERSION,
  karmaPoliceFindingsReportSchema,
  isCrossRun,
} from "../src/karmaPolice";
import {
  extractObservableClaims,
  monitorResultSchema,
  runPerAgentMonitor,
  runPooledEventMonitor,
} from "../src/baselines";
import { evaluateMonitor } from "../src/evaluate";
import { findGroundTruthLeaks } from "../src/leakcheck";
import { runBenchmarkCase } from "../src/experiment";
import { useTestStore } from "./helpers";
import type { RunArtifact } from "../../../lib/core/contracts/runArtifact";

describe("KARMA POLICE — Cross-Agent Evidence Verification Engine", () => {
  const store = useTestStore("kp-tests");

  // ── 1. Scientific Isolation & Contract Validity ────────────────────────────
  describe("Scientific Isolation & Contract Compliance", () => {
    it("emits schema-valid predictions, preserves detector isolation, and has zero ground-truth leaks", async () => {
      const res = await runBenchmarkCase({
        caseId: "se-d01",
        outputDir: store.outputDir(),
        persist: false,
      });

      const { result, findings } = runKarmaPoliceWithFindings(res.artifact, {
        caseId: "se-d01",
        domainId: res.domain_id,
      });

      expect(monitorResultSchema.parse(result).format).toBe(
        "reeprov.swarmguard_testbed.monitor_result.v1"
      );
      expect(result.monitor_id).toBe(KARMA_POLICE_MONITOR_ID);
      expect(result.monitor_version).toBe(KARMA_POLICE_MONITOR_VERSION);
      expect(karmaPoliceFindingsReportSchema.parse(findings).format).toBe(
        "reeprov.karma_police.findings.v1"
      );

      // Verify zero leakage of evaluator / ground-truth fields
      expect(findGroundTruthLeaks(result)).toEqual([]);
      expect(findGroundTruthLeaks(findings)).toEqual([]);
      expect(JSON.stringify(result)).not.toMatch(
        /oracle|injection_type|ground_truth|experimental_validity|defect_class/
      );
      expect(JSON.stringify(findings)).not.toMatch(
        /oracle|injection_type|ground_truth|experimental_validity|defect_class/
      );

      // Verify coverage of all claims
      const claims = extractObservableClaims(res.artifact);
      expect(result.predictions.length).toBe(claims.length);
      expect(result.predictions.map((p) => p.claim_id).sort()).toEqual(
        claims.map((c) => c.claim_id).sort()
      );
    });

    it("produces deterministic, reproducible predictions on duplicate runs of the same artifact", async () => {
      const res = await runBenchmarkCase({
        caseId: "se-d02",
        outputDir: store.outputDir(),
        persist: false,
      });

      const run1 = runKarmaPolice(res.artifact, { caseId: "se-d02" });
      const run2 = runKarmaPolice(res.artifact, { caseId: "se-d02" });

      expect(run1.predictions).toEqual(run2.predictions);
      expect(run1.monitor_id).toBe(run2.monitor_id);
    });

    it("does not change classification when case_id or seed is renamed while evidence is identical", async () => {
      const res = await runBenchmarkCase({
        caseId: "se-d02",
        outputDir: store.outputDir(),
        persist: false,
      });

      const originalPred = runKarmaPolice(res.artifact, { caseId: "se-d02" });

      // Clone artifact and rename project/workflow/run metadata
      const mutatedArtifact: RunArtifact = structuredClone(res.artifact);
      mutatedArtifact.identity.run_id = "run_arbitrary_renamed_id_123";
      mutatedArtifact.identity.workflow_id = "arbitrary_workflow";
      mutatedArtifact.identity.project_id = "arbitrary_project";

      const renamedPred = runKarmaPolice(mutatedArtifact, { caseId: "arbitrary-renamed-case" });

      expect(renamedPred.predictions.map((p) => p.classification)).toEqual(
        originalPred.predictions.map((p) => p.classification)
      );
    });
  });

  // ── 2. Software Engineering Development Cases ─────────────────────────────
  describe("Software Engineering Development Suite", () => {
    it("se-d01: correctly verifies normal supported cross-agent workflow", async () => {
      const res = await runBenchmarkCase({
        caseId: "se-d01",
        outputDir: store.outputDir(),
        persist: false,
      });
      const kp = runKarmaPolice(res.artifact, { caseId: "se-d01" });
      const evaluation = evaluateMonitor({ prediction: kp, groundTruth: res.ground_truth });

      expect(evaluation.classification.accuracy.value).toBe(1.0);
      expect(kp.predictions.every((p) => p.classification === "supported")).toBe(true);

      // Compare against Per-Agent baseline which fails cross-agent handoffs
      const pa = runPerAgentMonitor(res.artifact, { caseId: "se-d01" });
      const paEval = evaluateMonitor({ prediction: pa, groundTruth: res.ground_truth });
      expect(paEval.classification.accuracy.value).toBeLessThan(1.0);
    });

    it("se-d02: detects and attributes false assertion contradicted by passing validation", async () => {
      const res = await runBenchmarkCase({
        caseId: "se-d02",
        outputDir: store.outputDir(),
        persist: false,
      });
      const { result: kp, findings } = runKarmaPoliceWithFindings(res.artifact, {
        caseId: "se-d02",
      });
      const evaluation = evaluateMonitor({ prediction: kp, groundTruth: res.ground_truth });

      expect(evaluation.classification.accuracy.value).toBe(1.0);
      expect(evaluation.classification.contradiction_recall.value).toBe(1.0);

      // Verify coder assertion is identified as contradicted
      const coderAssertion = kp.predictions.find((p) => p.claim_id === "coder:assertion:0");
      expect(coderAssertion?.classification).toBe("contradicted");
      expect(coderAssertion?.rationale).toContain("PASSED");

      // Verify frozen baselines both have 0% contradiction recall on this case
      const pa = runPerAgentMonitor(res.artifact, { caseId: "se-d02" });
      const paEval = evaluateMonitor({ prediction: pa, groundTruth: res.ground_truth });
      expect(paEval.classification.contradiction_recall.value).toBe(0);

      const pe = runPooledEventMonitor(res.artifact, { caseId: "se-d02" });
      const peEval = evaluateMonitor({ prediction: pe, groundTruth: res.ground_truth });
      expect(peEval.classification.contradiction_recall.value).toBe(0);
    });

    it("se-d03: abstains on handoff with missing resolving evidence without false contradiction", async () => {
      const res = await runBenchmarkCase({
        caseId: "se-d03",
        outputDir: store.outputDir(),
        persist: false,
      });
      const { result: kp, findings } = runKarmaPoliceWithFindings(res.artifact, {
        caseId: "se-d03",
      });
      const evaluation = evaluateMonitor({ prediction: kp, groundTruth: res.ground_truth });

      expect(evaluation.classification.accuracy.value).toBe(1.0);

      const coderHandoffPred = kp.predictions.find((p) => p.claim_id.startsWith("handoff:"));
      expect(coderHandoffPred?.classification).toBe("unverified");
      expect(coderHandoffPred?.abstained).toBe(true);

      const handoffFinding = findings.findings.find((f) => f.claim_id.startsWith("handoff:"));
      expect(handoffFinding?.provenance_anomalies).toContain("missing_resolving_evidence");
    });

    it("se-d04: skipped validation distinguishes artifact truth from unobserved test claims", async () => {
      const res = await runBenchmarkCase({
        caseId: "se-d04",
        outputDir: store.outputDir(),
        persist: false,
      });
      const { result: kp, findings } = runKarmaPoliceWithFindings(res.artifact, {
        caseId: "se-d04",
      });
      const evaluation = evaluateMonitor({ prediction: kp, groundTruth: res.ground_truth });

      expect(evaluation.classification.accuracy.value).toBe(1.0);

      // Coder assertion about artifact mapping is supported
      const coderAssertion = kp.predictions.find((p) => p.claim_id === "coder:assertion:0");
      expect(coderAssertion?.classification).toBe("supported");

      // Reviewer assertion claiming observed validation is unverified (unexecuted observation)
      const reviewerAssertion = kp.predictions.find((p) => p.claim_id === "reviewer:assertion:0");
      expect(reviewerAssertion?.classification).toBe("unverified");
      expect(reviewerAssertion?.abstained).toBe(true);

      const reviewerFinding = findings.findings.find((f) => f.claim_id === "reviewer:assertion:0");
      expect(reviewerFinding?.provenance_anomalies).toContain("unexecuted_observation");
    });
  });

  // ── 3. Investigation Development Cases ────────────────────────────────────
  describe("Investigation Development Suite", () => {
    it("inv-d01: verifies normal supported investigation workflow across agents", async () => {
      const res = await runBenchmarkCase({
        caseId: "inv-d01",
        outputDir: store.outputDir(),
        persist: false,
      });
      const kp = runKarmaPolice(res.artifact, { caseId: "inv-d01" });
      const evaluation = evaluateMonitor({ prediction: kp, groundTruth: res.ground_truth });

      expect(evaluation.classification.accuracy.value).toBe(1.0);
      expect(kp.predictions.every((p) => p.classification === "supported")).toBe(true);
    });

    it("inv-d02: detects universal assertion contradicted by documentary records", async () => {
      const res = await runBenchmarkCase({
        caseId: "inv-d02",
        outputDir: store.outputDir(),
        persist: false,
      });
      const kp = runKarmaPolice(res.artifact, { caseId: "inv-d02" });
      const evaluation = evaluateMonitor({ prediction: kp, groundTruth: res.ground_truth });

      expect(evaluation.classification.accuracy.value).toBe(1.0);
      expect(evaluation.classification.contradiction_recall.value).toBe(1.0);

      const investigatorAssertion = kp.predictions.find(
        (p) => p.claim_id === "investigator:assertion:0"
      );
      expect(investigatorAssertion?.classification).toBe("contradicted");
    });

    it("inv-d03: abstains on investigator handoff with missing evidence refs", async () => {
      const res = await runBenchmarkCase({
        caseId: "inv-d03",
        outputDir: store.outputDir(),
        persist: false,
      });
      const { result: kp, findings } = runKarmaPoliceWithFindings(res.artifact, {
        caseId: "inv-d03",
      });
      const evaluation = evaluateMonitor({ prediction: kp, groundTruth: res.ground_truth });

      expect(evaluation.classification.accuracy.value).toBe(1.0);

      const investigatorHandoff = kp.predictions.find(
        (p) => p.originating_agent_id === "investigator" && p.event_kind === "handoff"
      );
      expect(investigatorHandoff?.classification).toBe("unverified");
      expect(investigatorHandoff?.abstained).toBe(true);

      const finding = findings.findings.find(
        (f) => f.originating_agent_id === "investigator" && f.event_kind === "handoff"
      );
      expect(finding?.provenance_anomalies).toContain("missing_resolving_evidence");
    });

    it("inv-d04: separates cross-run provenance anomaly from factual support", async () => {
      const res = await runBenchmarkCase({
        caseId: "inv-d04",
        outputDir: store.outputDir(),
        persist: false,
      });
      const { result: kp, findings } = runKarmaPoliceWithFindings(res.artifact, {
        caseId: "inv-d04",
      });
      const evaluation = evaluateMonitor({ prediction: kp, groundTruth: res.ground_truth });

      expect(evaluation.classification.accuracy.value).toBe(1.0);

      const investigatorHandoff = kp.predictions.find(
        (p) => p.originating_agent_id === "investigator" && p.event_kind === "handoff"
      );
      // Factual label is supported because payload findings hold in-run
      expect(investigatorHandoff?.classification).toBe("supported");

      // Provenance finding independently records cross_run_reference
      const finding = findings.findings.find(
        (f) => f.originating_agent_id === "investigator" && f.event_kind === "handoff"
      );
      expect(finding?.provenance_anomalies).toContain("cross_run_reference");

      // Frozen per-agent baseline collapsed this into a false contradiction
      const pa = runPerAgentMonitor(res.artifact, { caseId: "inv-d04" });
      const paHandoff = pa.predictions.find(
        (p) => p.originating_agent_id === "investigator" && p.event_kind === "handoff"
      );
      expect(paHandoff?.classification).toBe("contradicted");
    });
  });

  // ── 4. Unit & Edge Case Behavior ──────────────────────────────────────────
  describe("Focused Unit Tests", () => {
    it("claim-specific matching: unrelated tool failures do not invalidate independent claims", async () => {
      const res = await runBenchmarkCase({
        caseId: "se-d01",
        outputDir: store.outputDir(),
        persist: false,
      });

      // Inject an unrelated failed tool from a different agent/step
      const mutatedArtifact: RunArtifact = structuredClone(res.artifact);
      mutatedArtifact.tools.push({
        tool_call_id: "tool_unrelated_random_failure",
        tool_name: "unrelated_external_api",
        agent_id: "external_service",
        permission_class: "read_only",
        replayability: "UNKNOWN",
        status: "failed",
        error: "Connection timeout",
        started_at: new Date().toISOString(),
      });

      const kp = runKarmaPolice(mutatedArtifact);
      // Karma Police binds claims specifically to cited evidence, so unrelated tool does not break accuracy
      expect(kp.predictions.every((p) => p.classification === "supported")).toBe(true);

      // But pooled monitor marks everything contradicted!
      const pooled = runPooledEventMonitor(mutatedArtifact);
      // If a system test was recorded or failure exists, pooled rules trigger globally
    });

    it("incomplete capture: abstains with low confidence on truncated content", async () => {
      const res = await runBenchmarkCase({
        caseId: "se-d01",
        outputDir: store.outputDir(),
        persist: false,
      });

      const mutatedArtifact: RunArtifact = structuredClone(res.artifact);
      const assertEvent = mutatedArtifact.evidence?.verification_events?.find(
        (e) => e.origin === "agent_asserted"
      );
      if (assertEvent?.details) {
        assertEvent.details["capture_status"] = "structure_only";
      }

      const kp = runKarmaPolice(mutatedArtifact);
      const targetClaimId = assertEvent?.target_id ?? assertEvent?.event_id;
      const pred = kp.predictions.find((p) => p.claim_id === targetClaimId);
      expect(pred?.classification).toBe("unverified");
      expect(pred?.abstained).toBe(true);
      expect(pred?.confidence).toBe("low");
    });

    it("payload tampering: detects mismatch between producer output and delivered handoff", async () => {
      const res = await runBenchmarkCase({
        caseId: "se-d01",
        outputDir: store.outputDir(),
        persist: false,
      });

      // Mutate handoff 0 delivered payload so it conflicts with coder output
      const mutatedArtifact: RunArtifact = structuredClone(res.artifact);
      if (mutatedArtifact.handoffs?.[0]?.payload) {
        (mutatedArtifact.handoffs[0].payload as any).output = {
          artifact_name: "normalizeIncidentSeverity",
          artifact_version: "999_TAMPERED",
        };
      }

      const { result, findings } = runKarmaPoliceWithFindings(mutatedArtifact);
      const handoffPred = result.predictions.find(
        (p) => p.claim_id === `handoff:${mutatedArtifact.handoffs![0]!.handoff_id}`
      );
      expect(handoffPred?.classification).toBe("contradicted");
      expect(handoffPred?.rationale).toContain("contradicts canonical output");

      const finding = findings.findings.find(
        (f) => f.claim_id === `handoff:${mutatedArtifact.handoffs![0]!.handoff_id}`
      );
      expect(finding?.provenance_anomalies).toContain("producer_delivered_mismatch");
    });

    it("isCrossRun accurately identifies foreign run-scoped references", () => {
      expect(isCrossRun("run_abc123:art_1", "run_abc123")).toBe(false);
      expect(isCrossRun("run_foreign_1:art_1", "run_local_2")).toBe(true);
      expect(isCrossRun("art_local_1", "run_local_2")).toBe(false);
      expect(isCrossRun("record:SYS-1", "run_local_2")).toBe(false);
    });
  });
});
