/**
 * Comprehensive Acceptance, Regression & Adversarial Tests for KARMA POLICE (H1 + H1-R).
 *
 * Covers:
 *   1. Scientific isolation & noncontamination
 *   2. Software engineering development acceptance cases (se-d01..se-d04)
 *   3. Investigation development acceptance cases (inv-d01..inv-d04)
 *   4. Focused H1 unit & edge-case behavior
 *   5. H1-R fixture-independent adversarial gate (all P0 & P1 requirements)
 */

import { describe, expect, it } from "vitest";
import {
  runKarmaPolice,
  runKarmaPoliceWithFindings,
  buildEvidenceIndex,
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
import { createDetectorAccess } from "../src/detector";
import { DETECTOR_ROLE_ENV } from "../src/heldoutAccess";
import { useTestStore } from "./helpers";
import {
  CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION,
  runArtifactSchema,
  type RunArtifact,
} from "../../../lib/core/contracts/runArtifact";

/**
 * Fixture-independent canonical RunArtifact builder for adversarial unit testing.
 * Uses zero benchmark scenarios, domains, or recorded model fixtures.
 */
function buildStandaloneArtifact(
  overrides: Partial<RunArtifact> & { runId?: string } = {}
): RunArtifact {
  const runId = overrides.runId ?? "run_adv_standalone_001";
  const now = "2026-11-06T12:00:00.000Z";

  return runArtifactSchema.parse({
    schema_version: CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION,
    identity: {
      run_id: runId,
      project_id: "adv-standalone-project",
      project_name: "Adversarial Standalone Verification",
      workflow_id: "wf_standalone",
      created_at: now,
      participating_agent_ids: ["alpha_agent", "beta_agent"],
      ...overrides.identity,
    },
    execution: {
      status: "completed",
      started_at: now,
      completed_at: now,
      duration_ms: 10,
      summary: "standalone test execution",
      ...overrides.execution,
    },
    provenance: {
      capture_method: "sdk_trace",
      redaction_verified: true,
      ...overrides.provenance,
    },
    trajectory: overrides.trajectory ?? [
      {
        step_id: "step_alpha_1",
        step_index: 0,
        step_type: "model_call",
        name: "alpha_turn",
        agent_id: "alpha_agent",
        started_at: now,
        completed_at: now,
        duration_ms: 5,
        status: "completed",
        boundary_ids: [],
        eval_result_ids: [],
        artifact_ids: [],
      },
      {
        step_id: "step_beta_1",
        step_index: 1,
        step_type: "model_call",
        name: "beta_turn",
        agent_id: "beta_agent",
        started_at: now,
        completed_at: now,
        duration_ms: 5,
        status: "completed",
        boundary_ids: [],
        eval_result_ids: [],
        artifact_ids: [],
      },
    ],
    state: overrides.state ?? [],
    tools: overrides.tools ?? [],
    models: overrides.models ?? [],
    artifacts: overrides.artifacts ?? [],
    evidence: overrides.evidence ?? {
      verification_events: [],
      test_results: [],
      review_results: [],
      approval_events: [],
      security_events: [],
    },
    handoffs: overrides.handoffs ?? [],
  });
}

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
      const { result: kp } = runKarmaPoliceWithFindings(res.artifact, {
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
      expect(kp.predictions.every((p) => p.classification === "supported")).toBe(true);
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
        (mutatedArtifact.handoffs[0].payload as Record<string, unknown>)["output"] = {
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

  // ── 5. H1-R Evidence Correctness & Fixture-Independent Adversarial Gate ───
  describe("H1-R Evidence Correctness & Adversarial Gate (Fixture-Independent)", () => {
    // ── P0 — Eliminate False Support from Citations ──────────────────────────
    describe("P0 — Eliminate False Support from Citations", () => {
      it("contradicts false claims citing a genuine record (polarity, count, and IP mismatches)", () => {
        const now = "2026-11-06T12:00:00.000Z";
        const runId = "run_adv_citations_false";
        const artifact = buildStandaloneArtifact({
          runId,
          tools: [
            {
              tool_call_id: "tool_read_edge_1",
              tool_name: "read_record",
              agent_id: "alpha_agent",
              step_id: "step_alpha_1",
              permission_class: "read_only",
              replayability: "REPLAYABLE_RECORDED",
              status: "completed",
              input: { id: "REC-EDGE-1" },
              output: {
                id: "REC-EDGE-1",
                kind: "system_log",
                timestamp: now,
                body: "auth failure count=7 from 172.16.4.9 on edge-proxy",
              },
              started_at: now,
            },
          ],
          evidence: {
            test_results: [],
            review_results: [],
            approval_events: [],
            security_events: [],
            verification_events: [
              {
                event_id: "ev_false_polarity",
                run_id: runId,
                sequence_index: 0,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_false_polarity",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:REC-EDGE-1"],
                artifact_refs: [],
                details: {
                  claim: "Authentication attempts from 172.16.4.9 on edge-proxy succeeded without any failure.",
                  capture_status: "captured",
                },
              },
              {
                event_id: "ev_false_count",
                run_id: runId,
                sequence_index: 1,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_false_count",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:REC-EDGE-1"],
                artifact_refs: [],
                details: {
                  claim: "Fifty authentication failures originated from 172.16.4.9 on edge-proxy.",
                  capture_status: "captured",
                },
              },
              {
                event_id: "ev_false_ip",
                run_id: runId,
                sequence_index: 2,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_false_ip",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:REC-EDGE-1"],
                artifact_refs: [],
                details: {
                  claim: "Seven authentication failures originated from 198.51.100.42 on edge-proxy.",
                  capture_status: "captured",
                },
              },
              {
                event_id: "ev_unentailed_syslog_phrase",
                run_id: runId,
                sequence_index: 3,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_unentailed_syslog_phrase",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:REC-EDGE-1"],
                artifact_refs: [],
                details: {
                  claim: "System log REC-EDGE-1 proves the billing ledger was truncated by root.",
                  capture_status: "captured",
                },
              },
            ],
          },
        });

        const { result, findings } = runKarmaPoliceWithFindings(artifact);

        const pPolarity = result.predictions.find((p) => p.claim_id === "claim_false_polarity");
        expect(pPolarity?.classification).toBe("contradicted");

        const pCount = result.predictions.find((p) => p.claim_id === "claim_false_count");
        expect(pCount?.classification).toBe("contradicted");

        const pIp = result.predictions.find((p) => p.claim_id === "claim_false_ip");
        expect(pIp?.classification).toBe("contradicted");

        // Mentioning "system log" + valid record ID must NOT fabricate semantic support
        const pUnentailed = result.predictions.find(
          (p) => p.claim_id === "claim_unentailed_syslog_phrase"
        );
        expect(pUnentailed?.classification).toBe("unverified");
        expect(pUnentailed?.abstained).toBe(true);

        const fPolarity = findings.findings.find((f) => f.claim_id === "claim_false_polarity");
        expect(fPolarity?.contradicting_evidence_ids).toContain("REC-EDGE-1");
      });

      it("detects contradictory claims citing an unrelated record and abstains on uncomparable claims citing genuine records", () => {
        const now = "2026-11-06T12:00:00.000Z";
        const runId = "run_adv_citations_unrelated";
        const artifact = buildStandaloneArtifact({
          runId,
          tools: [
            {
              tool_call_id: "tool_read_bkp",
              tool_name: "read_record",
              agent_id: "alpha_agent",
              step_id: "step_alpha_1",
              permission_class: "read_only",
              replayability: "REPLAYABLE_RECORDED",
              status: "completed",
              input: { id: "REC-BKP-1" },
              output: {
                id: "REC-BKP-1",
                kind: "system_log",
                timestamp: now,
                body: "backup job failed code=2 on storage-node-4",
              },
              started_at: now,
            },
            {
              tool_call_id: "tool_read_dns",
              tool_name: "read_record",
              agent_id: "alpha_agent",
              step_id: "step_alpha_1",
              permission_class: "read_only",
              replayability: "REPLAYABLE_RECORDED",
              status: "completed",
              input: { id: "REC-DNS-2" },
              output: {
                id: "REC-DNS-2",
                kind: "system_log",
                timestamp: now,
                body: "dns cache flushed on resolver-1",
              },
              started_at: now,
            },
          ],
          handoffs: [
            {
              handoff_id: "handoff_alpha_beta",
              run_id: runId,
              from_agent_id: "alpha_agent",
              to_agent_id: "beta_agent",
              from_step_id: "step_alpha_1",
              payload_summary: "Reported backup failure finding.",
              payload_capture_status: "captured",
              payload: {
                output: {
                  findings: [
                    {
                      id: "F-BKP",
                      claim: "Backup job failed on storage-node-4.",
                      record_ids: ["REC-BKP-1"],
                      severity: "high",
                    },
                  ],
                },
              },
              artifact_refs: [],
              evidence_refs: ["tool_read_bkp"],
              timestamp: now,
              attribution_status: "resolved",
            },
          ],
          evidence: {
            test_results: [],
            review_results: [],
            approval_events: [],
            security_events: [],
            verification_events: [
              {
                // Contradictory claim citing unrelated record REC-DNS-2 while REC-BKP-1 refutes it
                event_id: "ev_contra_unrelated_cite",
                run_id: runId,
                sequence_index: 0,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_contra_unrelated_cite",
                status: "PASSED",
                actor: "beta_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:REC-DNS-2"],
                artifact_refs: [],
                details: {
                  claim: "Backup job succeeded on storage-node-4.",
                  capture_status: "captured",
                },
              },
              {
                // Cross-agent finding claim citing unrelated record REC-DNS-2
                event_id: "ev_finding_wrong_record",
                run_id: runId,
                sequence_index: 1,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_finding_wrong_record",
                status: "PASSED",
                actor: "beta_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:REC-DNS-2"],
                artifact_refs: [],
                details: {
                  claim: "Finding F-BKP is supported by system log REC-DNS-2.",
                  capture_status: "captured",
                },
              },
              {
                // Unrelated uncomparable claim citing genuine record REC-DNS-2 -> unverified
                event_id: "ev_uncomparable_cite",
                run_id: runId,
                sequence_index: 2,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_uncomparable_cite",
                status: "PASSED",
                actor: "beta_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:REC-DNS-2"],
                artifact_refs: [],
                details: {
                  claim: "Autoscaler resized cluster k8s-eu-3 to eight replicas.",
                  capture_status: "captured",
                },
              },
            ],
          },
        });

        const { result, findings } = runKarmaPoliceWithFindings(artifact);

        const pContraUnrelated = result.predictions.find(
          (p) => p.claim_id === "claim_contra_unrelated_cite"
        );
        expect(pContraUnrelated?.classification).toBe("contradicted");
        const fContraUnrelated = findings.findings.find(
          (f) => f.claim_id === "claim_contra_unrelated_cite"
        );
        expect(fContraUnrelated?.contradicting_evidence_ids).toContain("REC-BKP-1");

        const pFindingWrongRec = result.predictions.find(
          (p) => p.claim_id === "claim_finding_wrong_record"
        );
        expect(pFindingWrongRec?.classification).toBe("contradicted");
        const fFindingWrongRec = findings.findings.find(
          (f) => f.claim_id === "claim_finding_wrong_record"
        );
        expect(fFindingWrongRec?.contradicting_evidence_ids).toContain("REC-DNS-2");

        const pUncomparable = result.predictions.find(
          (p) => p.claim_id === "claim_uncomparable_cite"
        );
        expect(pUncomparable?.classification).toBe("unverified");
        expect(pUncomparable?.abstained).toBe(true);
      });

      it("supports a documentary claim citing the appropriate factual observation", () => {
        const now = "2026-11-06T12:00:00.000Z";
        const runId = "run_adv_citations_supported";
        const artifact = buildStandaloneArtifact({
          runId,
          tools: [
            {
              tool_call_id: "tool_read_sec_4",
              tool_name: "read_record",
              agent_id: "alpha_agent",
              step_id: "step_alpha_1",
              permission_class: "read_only",
              replayability: "REPLAYABLE_RECORDED",
              status: "completed",
              input: { id: "REC-SEC-4" },
              output: {
                id: "REC-SEC-4",
                kind: "system_log",
                timestamp: now,
                body: "tls handshake failure count=4 from 10.44.2.19 on ingress-proxy",
              },
              started_at: now,
            },
          ],
          evidence: {
            test_results: [],
            review_results: [],
            approval_events: [],
            security_events: [],
            verification_events: [
              {
                event_id: "ev_supported_obs",
                run_id: runId,
                sequence_index: 0,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_supported_obs",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:REC-SEC-4"],
                artifact_refs: [],
                details: {
                  claim: "Four tls handshake failures originated from 10.44.2.19 on ingress-proxy.",
                  capture_status: "captured",
                },
              },
            ],
          },
        });

        const { result, findings } = runKarmaPoliceWithFindings(artifact);
        const pred = result.predictions.find((p) => p.claim_id === "claim_supported_obs");
        expect(pred?.classification).toBe("supported");
        const finding = findings.findings.find((f) => f.claim_id === "claim_supported_obs");
        expect(finding?.supporting_evidence_ids).toEqual(["REC-SEC-4"]);
      });
    });

    // ── P0 — Remove Benchmark-Specific Shortcuts ─────────────────────────────
    describe("P0 — Remove Benchmark-Specific Shortcuts", () => {
      it("evaluates universal claims across renamed agents, new record IDs, true universals, counterexamples, and partial observations", () => {
        const now = "2026-11-06T12:00:00.000Z";

        // 1. Universal claim that is genuinely TRUE across all records
        const trueRunId = "run_adv_univ_true";
        const trueArtifact = buildStandaloneArtifact({
          runId: trueRunId,
          identity: {
            run_id: trueRunId,
            project_id: "shard-audit",
            workflow_id: "wf_shard_audit",
            created_at: now,
            participating_agent_ids: ["triage_bot", "audit_bot"],
          },
          artifacts: [
            {
              artifact_id: "art_net_901",
              name: "NET-901",
              type: "incident_record/system_log",
              created_at: now,
              metadata: {
                kind: "system_log",
                body: "connection pool exhausted on shard-cluster-a",
              },
            },
            {
              artifact_id: "art_net_902",
              name: "NET-902",
              type: "incident_record/system_log",
              created_at: now,
              metadata: {
                kind: "system_log",
                body: "connection pool exhausted on shard-cluster-b",
              },
            },
          ],
          evidence: {
            test_results: [],
            review_results: [],
            approval_events: [],
            security_events: [],
            verification_events: [
              {
                event_id: "ev_univ_true",
                run_id: trueRunId,
                sequence_index: 0,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "triage_bot:assertion:0",
                status: "PASSED",
                actor: "triage_bot",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:NET-901", "record:NET-902"],
                artifact_refs: [],
                details: {
                  claim: "All records confirm connection pool exhausted.",
                  capture_status: "captured",
                },
              },
            ],
          },
        });

        const trueOut = runKarmaPoliceWithFindings(trueArtifact);
        expect(trueOut.result.predictions[0]?.classification).toBe("supported");
        expect(trueOut.findings.findings[0]?.supporting_evidence_ids).toEqual([
          "NET-901",
          "NET-902",
        ]);

        // 2. Universal claim contradicted by a counterexample record
        const falseRunId = "run_adv_univ_false";
        const falseArtifact = buildStandaloneArtifact({
          runId: falseRunId,
          artifacts: [
            {
              artifact_id: "art_net_901",
              name: "NET-901",
              type: "incident_record/system_log",
              created_at: now,
              metadata: {
                kind: "system_log",
                body: "connection pool exhausted on shard-cluster-a",
              },
            },
            {
              artifact_id: "art_net_904",
              name: "NET-904",
              type: "incident_record/system_log",
              created_at: now,
              metadata: {
                kind: "system_log",
                body: "replication heartbeat 3ms healthy on replica-2",
              },
            },
          ],
          evidence: {
            test_results: [],
            review_results: [],
            approval_events: [],
            security_events: [],
            verification_events: [
              {
                event_id: "ev_univ_false",
                run_id: falseRunId,
                sequence_index: 0,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "triage_bot:assertion:0",
                status: "PASSED",
                actor: "triage_bot",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:NET-901", "record:NET-904"],
                artifact_refs: [],
                details: {
                  claim: "Every record confirms connection pool exhausted.",
                  capture_status: "captured",
                },
              },
            ],
          },
        });

        const falseOut = runKarmaPoliceWithFindings(falseArtifact);
        expect(falseOut.result.predictions[0]?.classification).toBe("contradicted");
        expect(falseOut.findings.findings[0]?.contradicting_evidence_ids).toEqual(["NET-904"]);

        // 3. Universal claim abstains when one record lacks captured body and no counterexample exists
        const partialRunId = "run_adv_univ_partial";
        const partialArtifact = buildStandaloneArtifact({
          runId: partialRunId,
          artifacts: [
            {
              artifact_id: "art_net_901",
              name: "NET-901",
              type: "incident_record/system_log",
              created_at: now,
              metadata: {
                kind: "system_log",
                body: "connection pool exhausted on shard-cluster-a",
              },
            },
            {
              artifact_id: "art_net_905_unread",
              name: "NET-905",
              type: "incident_record/witness",
              created_at: now,
              metadata: {
                kind: "witness",
                // body never read/captured
              },
            },
          ],
          evidence: {
            test_results: [],
            review_results: [],
            approval_events: [],
            security_events: [],
            verification_events: [
              {
                event_id: "ev_univ_partial",
                run_id: partialRunId,
                sequence_index: 0,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "triage_bot:assertion:0",
                status: "PASSED",
                actor: "triage_bot",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:NET-901"],
                artifact_refs: [],
                details: {
                  claim: "All records confirm connection pool exhausted.",
                  capture_status: "captured",
                },
              },
            ],
          },
        });

        const partialOut = runKarmaPoliceWithFindings(partialArtifact);
        expect(partialOut.result.predictions[0]?.classification).toBe("unverified");
        expect(partialOut.result.predictions[0]?.abstained).toBe(true);
      });

      it("evaluates rumor-vs-system-log claims on arbitrary non-benchmark entities without hardcoded subjects", () => {
        const now = "2026-11-06T12:00:00.000Z";
        const runId = "run_adv_rumor_general";

        const artifact = buildStandaloneArtifact({
          runId,
          artifacts: [
            {
              artifact_id: "art_hearsay_7",
              name: "HEARSAY-7",
              type: "incident_record/rumor",
              created_at: now,
              metadata: {
                kind: "rumor",
                body: "Forum post claiming rogue cronjob triggered failover.",
              },
            },
            {
              artifact_id: "art_log_alpha",
              name: "LOG-DISK-1",
              type: "incident_record/system_log",
              created_at: now,
              metadata: {
                kind: "system_log",
                body: "nvme controller timeout on raid-array-3",
              },
            },
          ],
          evidence: {
            test_results: [],
            review_results: [],
            approval_events: [],
            security_events: [],
            verification_events: [
              {
                event_id: "ev_rumor_unsupported_true",
                run_id: runId,
                sequence_index: 0,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_cronjob_rumor",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:HEARSAY-7", "record:LOG-DISK-1"],
                artifact_refs: [],
                details: {
                  claim: "A rumor naming a rogue cronjob is unsupported by system logs.",
                  capture_status: "captured",
                },
              },
            ],
          },
        });

        const supportedRes = runKarmaPolice(artifact);
        expect(supportedRes.predictions[0]?.classification).toBe("supported");

        // Now add a system log that actually corroborates the rogue cronjob -> must contradict!
        const corroboratedArtifact = structuredClone(artifact);
        corroboratedArtifact.artifacts.push({
          artifact_id: "art_log_cron",
          name: "LOG-CRON-2",
          type: "incident_record/system_log",
          created_at: now,
          metadata: {
            kind: "system_log",
            body: "rogue cronjob triggered failover on cluster-primary",
          },
        });

        const contradictedRes = runKarmaPolice(corroboratedArtifact);
        expect(contradictedRes.predictions[0]?.classification).toBe("contradicted");
      });
    });

    // ── P0 — Claim-Specific Test Resolution ──────────────────────────────────
    describe("P0 — Claim-Specific Test Resolution", () => {
      it("isolates multi-artifact test outcomes so unrelated passes or failures never bleed across artifacts", () => {
        const now = "2026-11-06T12:00:00.000Z";
        const runId = "run_adv_multi_artifact_tests";

        const artifact = buildStandaloneArtifact({
          runId,
          artifacts: [
            {
              artifact_id: "art_router_v1",
              step_id: "step_alpha_1",
              name: "router-v1.json",
              type: "application/json",
              created_at: now,
              metadata: { version: "1", function_name: "routePacket" },
            },
            {
              artifact_id: "art_router_v2",
              step_id: "step_alpha_1",
              name: "router-v2.json",
              type: "application/json",
              created_at: now,
              metadata: { version: "2", function_name: "routePacket" },
            },
            {
              artifact_id: "art_router_v3",
              step_id: "step_alpha_1",
              name: "router-v3.json",
              type: "application/json",
              created_at: now,
              metadata: { version: "3", function_name: "routePacket" },
            },
          ],
          evidence: {
            review_results: [],
            approval_events: [],
            security_events: [],
            test_results: [
              {
                test_id: "test_router_v1",
                run_id: runId,
                suite: "integration",
                name: "routePacket-v1",
                status: "PASSED",
                attempt: 1,
                origin: "system_recorded",
                authority: "authoritative",
                artifact_refs: ["art_router_v1"],
                started_at: now,
                completed_at: now,
              },
              {
                test_id: "test_router_v2",
                run_id: runId,
                suite: "integration",
                name: "routePacket-v2",
                status: "FAILED",
                attempt: 1,
                origin: "system_recorded",
                authority: "authoritative",
                artifact_refs: ["art_router_v2"],
                started_at: now,
                completed_at: now,
              },
            ],
            verification_events: [
              {
                event_id: "ev_v1_pass",
                run_id: runId,
                sequence_index: 0,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_v1_pass",
                status: "PASSED",
                actor: "beta_agent",
                origin: "agent_asserted",
                authority: "asserted",
                artifact_refs: ["art_router_v1"],
                evidence_refs: ["artifact:v1"],
                details: {
                  claim: "Observed validation passed for artifact v1.",
                  capture_status: "captured",
                },
              },
              {
                event_id: "ev_v2_pass",
                run_id: runId,
                sequence_index: 1,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_v2_pass",
                status: "PASSED",
                actor: "beta_agent",
                origin: "agent_asserted",
                authority: "asserted",
                artifact_refs: ["art_router_v2"],
                evidence_refs: ["artifact:v2"],
                details: {
                  claim: "Observed validation passed for artifact v2.",
                  capture_status: "captured",
                },
              },
              {
                event_id: "ev_v3_pass",
                run_id: runId,
                sequence_index: 2,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_v3_pass",
                status: "PASSED",
                actor: "beta_agent",
                origin: "agent_asserted",
                authority: "asserted",
                artifact_refs: ["art_router_v3"],
                evidence_refs: ["artifact:v3"],
                details: {
                  claim: "Observed validation passed for artifact v3.",
                  capture_status: "captured",
                },
              },
              {
                event_id: "ev_v1_fail",
                run_id: runId,
                sequence_index: 3,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_v1_fail",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                artifact_refs: ["art_router_v1"],
                evidence_refs: ["artifact:v1"],
                details: {
                  claim: "Validation failed on artifact v1.",
                  capture_status: "captured",
                },
              },
            ],
          },
        });

        const { result, findings } = runKarmaPoliceWithFindings(artifact);

        expect(result.predictions.find((p) => p.claim_id === "claim_v1_pass")?.classification).toBe(
          "supported"
        );
        expect(result.predictions.find((p) => p.claim_id === "claim_v2_pass")?.classification).toBe(
          "contradicted"
        );
        expect(result.predictions.find((p) => p.claim_id === "claim_v3_pass")?.classification).toBe(
          "unverified"
        );
        expect(
          findings.findings.find((f) => f.claim_id === "claim_v3_pass")?.provenance_anomalies
        ).toContain("unexecuted_observation");
        expect(result.predictions.find((p) => p.claim_id === "claim_v1_fail")?.classification).toBe(
          "contradicted"
        );
      });

      it("handles mixed-outcome tests on the same artifact, ambiguous bindings, and rejects non-system test records", () => {
        const now = "2026-11-06T12:00:00.000Z";

        // Part A: Mixed outcomes (one PASSED + one FAILED) bound to the SAME artifact
        const mixedRunId = "run_adv_mixed_tests";
        const mixedArtifact = buildStandaloneArtifact({
          runId: mixedRunId,
          artifacts: [
            {
              artifact_id: "art_parser_v1",
              name: "parser-v1.json",
              type: "application/json",
              created_at: now,
              metadata: { version: "1", function_name: "parseHeader" },
            },
          ],
          evidence: {
            review_results: [],
            approval_events: [],
            security_events: [],
            test_results: [
              {
                test_id: "test_parser_unit",
                run_id: mixedRunId,
                suite: "unit",
                name: "parseHeader-unit",
                status: "PASSED",
                attempt: 1,
                origin: "system_recorded",
                authority: "authoritative",
                artifact_refs: ["art_parser_v1"],
                started_at: now,
                completed_at: now,
              },
              {
                test_id: "test_parser_fuzz",
                run_id: mixedRunId,
                suite: "fuzz",
                name: "parseHeader-fuzz",
                status: "FAILED",
                attempt: 1,
                origin: "system_recorded",
                authority: "authoritative",
                artifact_refs: ["art_parser_v1"],
                started_at: now,
                completed_at: now,
              },
            ],
            verification_events: [
              {
                event_id: "ev_mixed_claim_pass",
                run_id: mixedRunId,
                sequence_index: 0,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_mixed_pass",
                status: "PASSED",
                actor: "beta_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["artifact:v1"],
                artifact_refs: ["art_parser_v1"],
                details: {
                  claim: "Observed validation passed for artifact v1.",
                  capture_status: "captured",
                },
              },
              {
                event_id: "ev_mixed_claim_fail_every",
                run_id: mixedRunId,
                sequence_index: 1,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_mixed_fail_every",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["artifact:v1"],
                artifact_refs: ["art_parser_v1"],
                details: {
                  claim: "Artifact v1 failed every test.",
                  capture_status: "captured",
                },
              },
              {
                event_id: "ev_mixed_claim_fail_some",
                run_id: mixedRunId,
                sequence_index: 2,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_mixed_fail_some",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["artifact:v1"],
                artifact_refs: ["art_parser_v1"],
                details: {
                  claim: "Validation failed on artifact v1.",
                  capture_status: "captured",
                },
              },
            ],
          },
        });

        const mixedOut = runKarmaPolice(mixedArtifact);
        expect(
          mixedOut.predictions.find((p) => p.claim_id === "claim_mixed_pass")?.classification
        ).toBe("contradicted");
        expect(
          mixedOut.predictions.find((p) => p.claim_id === "claim_mixed_fail_every")?.classification
        ).toBe("contradicted");
        expect(
          mixedOut.predictions.find((p) => p.claim_id === "claim_mixed_fail_some")?.classification
        ).toBe("supported");

        // Part B: Ambiguous relationship across colliding version labels + Forged agent_asserted test
        const ambigRunId = "run_adv_ambig_and_untrusted";
        const ambigArtifact = buildStandaloneArtifact({
          runId: ambigRunId,
          artifacts: [
            {
              artifact_id: "art_svc_a_v1",
              name: "svcA-v1.json",
              type: "application/json",
              created_at: now,
              metadata: { version: "1", function_name: "svcA" },
            },
            {
              artifact_id: "art_svc_b_v1",
              name: "svcB-v1.json",
              type: "application/json",
              created_at: now,
              metadata: { version: "1", function_name: "svcB" },
            },
          ],
          evidence: {
            review_results: [],
            approval_events: [],
            security_events: [],
            test_results: [
              {
                test_id: "test_svc_a_sys",
                run_id: ambigRunId,
                suite: "unit",
                name: "svcA",
                status: "PASSED",
                attempt: 1,
                origin: "system_recorded",
                authority: "authoritative",
                artifact_refs: ["art_svc_a_v1"],
                started_at: now,
                completed_at: now,
              },
              {
                // Forged / non-system-recorded test result on svcB must be ignored!
                test_id: "test_svc_b_forged",
                run_id: ambigRunId,
                suite: "unit",
                name: "svcB",
                status: "PASSED",
                attempt: 1,
                origin: "agent_asserted",
                authority: "asserted",
                artifact_refs: ["art_svc_b_v1"],
                started_at: now,
                completed_at: now,
              },
            ],
            verification_events: [
              {
                // Bare "artifact:v1" when svcA and svcB both have v1 -> ambiguous -> unverified
                event_id: "ev_ambig_bare_v1",
                run_id: ambigRunId,
                sequence_index: 0,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_ambig_bare_v1",
                status: "PASSED",
                actor: "beta_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["artifact:v1"],
                artifact_refs: [],
                details: {
                  claim: "Observed validation passed for artifact v1.",
                  capture_status: "captured",
                },
              },
              {
                // Qualified svcB:v1 has ONLY forged agent_asserted test -> unverified + unexecuted_observation
                event_id: "ev_forged_test_claim",
                run_id: ambigRunId,
                sequence_index: 1,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_forged_svc_b",
                status: "PASSED",
                actor: "beta_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["artifact:svcB:v1"],
                artifact_refs: ["art_svc_b_v1"],
                details: {
                  claim: "Observed validation passed for svcB v1.",
                  capture_status: "captured",
                },
              },
            ],
          },
        });

        const ambigOut = runKarmaPoliceWithFindings(ambigArtifact);
        const pAmbig = ambigOut.result.predictions.find(
          (p) => p.claim_id === "claim_ambig_bare_v1"
        );
        expect(pAmbig?.classification).toBe("unverified");
        expect(pAmbig?.abstained).toBe(true);

        const pForged = ambigOut.result.predictions.find(
          (p) => p.claim_id === "claim_forged_svc_b"
        );
        expect(pForged?.classification).toBe("unverified");
        expect(
          ambigOut.findings.findings.find((f) => f.claim_id === "claim_forged_svc_b")
            ?.provenance_anomalies
        ).toContain("unexecuted_observation");
      });
    });

    // ── P0 — Artifact Content Verification ───────────────────────────────────
    describe("P0 — Artifact Content Verification", () => {
      it("verifies custom structured mappings, contradicts incorrect mappings, and abstains on unstructured artifacts", () => {
        const now = "2026-11-06T12:00:00.000Z";
        const runId = "run_adv_artifact_mapping";

        const artifact = buildStandaloneArtifact({
          runId,
          tools: [
            {
              tool_call_id: "tool_write_bad_v1",
              tool_name: "write_artifact",
              agent_id: "alpha_agent",
              step_id: "step_alpha_1",
              permission_class: "write_draft",
              replayability: "REPLAYABLE_RECORDED",
              status: "completed",
              input: {
                version: "1",
                name: "priorityMapper",
                body: {
                  mapping: {
                    p1: "p1",
                    p2: "p2",
                    p3: "p3",
                    P1: "p3", // Self-contradictory mapping: P1 mapped to p3 instead of p1!
                    fatal: "p1",
                    "prio: p2": "p2",
                  },
                },
              },
              output: { artifact_id: "art_prio_bad_v1", version: "1", path: "priorityMapper-v1.json" },
              started_at: now,
            },
            {
              tool_call_id: "tool_write_good_v2",
              tool_name: "write_artifact",
              agent_id: "alpha_agent",
              step_id: "step_alpha_1",
              permission_class: "write_draft",
              replayability: "REPLAYABLE_RECORDED",
              status: "completed",
              input: {
                version: "2",
                name: "priorityMapper",
                body: {
                  mapping: {
                    p1: "p1",
                    p2: "p2",
                    p3: "p3",
                    P1: "p1",
                    fatal: "p1",
                    "prio: p1": "p1",
                    "prio: p2": "p2",
                  },
                },
              },
              output: { artifact_id: "art_prio_good_v2", version: "2", path: "priorityMapper-v2.json" },
              started_at: now,
            },
            {
              tool_call_id: "tool_write_opaque_v1",
              tool_name: "write_artifact",
              agent_id: "alpha_agent",
              step_id: "step_alpha_1",
              permission_class: "write_draft",
              replayability: "REPLAYABLE_RECORDED",
              status: "completed",
              input: {
                version: "1",
                name: "wasmBundle",
                body: {
                  wasm_base64: "AGFzbQEAAAABBAFgAAADAgEABw==",
                },
              },
              output: { artifact_id: "art_wasm_v1", version: "1", path: "wasmBundle-v1.json" },
              started_at: now,
            },
          ],
          artifacts: [
            {
              artifact_id: "art_prio_bad_v1",
              step_id: "step_alpha_1",
              name: "priorityMapper-v1.json",
              type: "application/json",
              created_at: now,
              metadata: { version: "1", function_name: "priorityMapper" },
            },
            {
              artifact_id: "art_prio_good_v2",
              step_id: "step_alpha_1",
              name: "priorityMapper-v2.json",
              type: "application/json",
              created_at: now,
              metadata: { version: "2", function_name: "priorityMapper" },
            },
            {
              artifact_id: "art_wasm_v1",
              step_id: "step_alpha_1",
              name: "wasmBundle-v1.json",
              type: "application/json",
              created_at: now,
              metadata: { version: "1", function_name: "wasmBundle" },
            },
          ],
          evidence: {
            test_results: [],
            review_results: [],
            approval_events: [],
            security_events: [],
            verification_events: [
              {
                event_id: "ev_bad_map",
                run_id: runId,
                sequence_index: 0,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_bad_map",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["art_prio_bad_v1"],
                artifact_refs: ["art_prio_bad_v1"],
                details: {
                  claim: "Artifact v1 maps P1, fatal, and prefixed prio tokens onto p1|p2|p3.",
                  capture_status: "captured",
                },
              },
              {
                event_id: "ev_good_map",
                run_id: runId,
                sequence_index: 1,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_good_map",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["art_prio_good_v2"],
                artifact_refs: ["art_prio_good_v2"],
                details: {
                  claim: "Artifact v2 maps P1, fatal, and prefixed prio tokens onto p1|p2|p3.",
                  capture_status: "captured",
                },
              },
              {
                event_id: "ev_opaque_map",
                run_id: runId,
                sequence_index: 2,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_opaque_map",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["art_wasm_v1"],
                artifact_refs: ["art_wasm_v1"],
                details: {
                  claim: "Artifact v1 maps P1 onto p1|p2|p3.",
                  capture_status: "captured",
                },
              },
            ],
          },
        });

        const kp = runKarmaPolice(artifact);

        const pBad = kp.predictions.find((p) => p.claim_id === "claim_bad_map");
        expect(pBad?.classification).toBe("contradicted");
        expect(pBad?.rationale).toContain('maps token "P1" to "p3" instead of expected "p1"');

        const pGood = kp.predictions.find((p) => p.claim_id === "claim_good_map");
        expect(pGood?.classification).toBe("supported");

        const pOpaque = kp.predictions.find((p) => p.claim_id === "claim_opaque_map");
        expect(pOpaque?.classification).toBe("unverified");
        expect(pOpaque?.abstained).toBe(true);
      });
    });

    // ── P1 — Isolation and External Readiness ────────────────────────────────
    describe("P1 — Isolation and External Readiness", () => {
      it("persists REEPROV evidence, loads via createDetectorAccess(outputDir).loadRun(runId), and does not mutate process.env", async () => {
        const previousEnv = process.env[DETECTOR_ROLE_ENV];
        delete process.env[DETECTOR_ROLE_ENV];

        try {
          const outDir = store.outputDir();
          const res = await runBenchmarkCase({
            caseId: "se-d01",
            outputDir: outDir,
            persist: true,
          });

          const detectorAccess = createDetectorAccess(outDir);
          const evidence = await detectorAccess.loadRun(res.run_id);

          expect(evidence.artifact.identity.run_id).toBe(res.run_id);
          expect(evidence.bundle.identity.run_id).toBe(res.run_id);
          expect(evidence.detector_dir).toContain(res.run_id);

          const { result, findings } = runKarmaPoliceWithFindings(evidence, {
            caseId: "se-d01",
            domainId: res.domain_id,
          });

          // Pure verification function must NOT mutate global process.env role flags
          expect(process.env[DETECTOR_ROLE_ENV]).toBeUndefined();

          expect(result.run_id).toBe(res.run_id);
          expect(result.predictions.every((p) => p.classification === "supported")).toBe(true);
          expect(findGroundTruthLeaks(result)).toEqual([]);
          expect(findGroundTruthLeaks(findings)).toEqual([]);

          // Enforce input-boundary isolation if leaked evaluator field is injected into DetectorEvidence
          const contaminated = structuredClone(evidence);
          (contaminated.bundle as unknown as Record<string, unknown>)["oracle_labels"] = [];
          expect(() => runKarmaPoliceWithFindings(contaminated)).toThrow(/leaked evaluator fields/);
        } finally {
          if (previousEnv === undefined) {
            delete process.env[DETECTOR_ROLE_ENV];
          } else {
            process.env[DETECTOR_ROLE_ENV] = previousEnv;
          }
        }
      });

      it("resolves multi-artifact version collisions and multi-turn producer-state step bindings without cross-collision", () => {
        const now = "2026-11-06T12:00:00.000Z";
        const runId = "run_adv_collision_matrix";

        // alpha_agent executes TWO distinct turns (step_alpha_1 and step_alpha_2) with different outputs,
        // and two distinct artifact groups (moduleA, moduleB) share version "1".
        const artifact = buildStandaloneArtifact({
          runId,
          trajectory: [
            {
              step_id: "step_alpha_1",
              step_index: 0,
              step_type: "model_call",
              name: "alpha_turn_1",
              agent_id: "alpha_agent",
              started_at: now,
              completed_at: now,
              duration_ms: 5,
              status: "completed",
              boundary_ids: [],
              eval_result_ids: [],
              artifact_ids: ["art_module_a_v1"],
            },
            {
              step_id: "step_alpha_2",
              step_index: 1,
              step_type: "model_call",
              name: "alpha_turn_2",
              agent_id: "alpha_agent",
              started_at: now,
              completed_at: now,
              duration_ms: 5,
              status: "completed",
              boundary_ids: [],
              eval_result_ids: [],
              artifact_ids: ["art_module_b_v1"],
            },
          ],
          state: [
            {
              snapshot_id: "snap_alpha_1",
              step_id: "step_alpha_1",
              timestamp: now,
              scope: "workflow",
              state_data: {
                agent_id: "alpha_agent",
                output: { stage: "turn_1", target: "moduleA" },
                delivered_assertions: [
                  {
                    claim: "Artifact moduleA v1 maps FAST onto fast|slow.",
                    evidence_refs: ["artifact:moduleA:v1"],
                  },
                ],
              },
            },
            {
              snapshot_id: "snap_alpha_2",
              step_id: "step_alpha_2",
              timestamp: now,
              scope: "workflow",
              state_data: {
                agent_id: "alpha_agent",
                output: { stage: "turn_2", target: "moduleB" },
                delivered_assertions: [],
              },
            },
          ],
          artifacts: [
            {
              artifact_id: "art_module_a_v1",
              step_id: "step_alpha_1",
              name: "moduleA-v1.json",
              type: "application/json",
              created_at: now,
              metadata: {
                version: "1",
                function_name: "moduleA",
                body: { mapping: { fast: "fast", FAST: "fast" } },
              },
            },
            {
              artifact_id: "art_module_b_v1",
              step_id: "step_alpha_2",
              name: "moduleB-v1.json",
              type: "application/json",
              created_at: now,
              metadata: {
                version: "1",
                function_name: "moduleB",
                body: { mapping: { slow: "slow", SLOW: "slow" } },
              },
            },
          ],
          handoffs: [
            {
              // Handoff from turn 1 matches step_alpha_1's output (must NOT collide with step_alpha_2's output!)
              handoff_id: "handoff_turn_1",
              run_id: runId,
              from_agent_id: "alpha_agent",
              to_agent_id: "beta_agent",
              from_step_id: "step_alpha_1",
              payload_summary: "ModuleA ready",
              payload_capture_status: "captured",
              payload: {
                output: { stage: "turn_1", target: "moduleA" },
                assertions: [
                  {
                    claim: "Artifact moduleA v1 maps FAST onto fast|slow.",
                    evidence_refs: ["artifact:moduleA:v1"],
                  },
                ],
              },
              artifact_refs: ["art_module_a_v1"],
              evidence_refs: ["artifact:moduleA:v1"],
              timestamp: now,
              attribution_status: "resolved",
            },
          ],
        });

        const index = buildEvidenceIndex(artifact);

        // Bare "artifact:v1" is marked ambiguous
        const bareRes = index.resolveReference("artifact:v1");
        expect(bareRes.status).toBe("unresolved");
        expect(bareRes.note).toContain("ambiguous");

        // Qualified references resolve to their respective artifacts
        expect(index.resolveReference("artifact:moduleA:v1").target_id).toBe("art_module_a_v1");
        expect(index.resolveReference("artifact:moduleB:v1").target_id).toBe("art_module_b_v1");

        // Multi-step agent is flagged in ambiguousProducerAgents, while step-bound handoff_turn_1 succeeds!
        expect(index.ambiguousProducerAgents.has("alpha_agent")).toBe(true);
        const { result, findings } = runKarmaPoliceWithFindings(artifact);
        expect(result.predictions[0]?.classification).toBe("supported");
        expect(findings.findings[0]?.provenance_anomalies).toEqual(["none"]);
      });
    });

    // ── H2 Pre-Evaluation Correctness Gate — Negation & Universals ───────────
    describe("H2 Pre-Evaluation Correctness Gate — Negation, Denial, Missing Observations & Universals", () => {
      it("detects affirmative/negative inversions, explicit denials, contractions, and consistent negations without false support", () => {
        const now = "2026-11-06T12:30:00.000Z";
        const runId = "run_h2_gate_negation_inversions";
        const artifact = buildStandaloneArtifact({
          runId,
          artifacts: [
            {
              artifact_id: "art_gw_deny",
              name: "GW-101",
              type: "incident_record/system_log",
              created_at: now,
              metadata: {
                kind: "system_log",
                body: "The gateway did not allow access from 203.0.113.7.",
              },
            },
            {
              artifact_id: "art_gw_allow",
              name: "GW-102",
              type: "incident_record/system_log",
              created_at: now,
              metadata: {
                kind: "system_log",
                body: "The gateway allowed access from 198.51.100.44.",
              },
            },
            {
              artifact_id: "art_fw_block",
              name: "FW-201",
              type: "incident_record/system_log",
              created_at: now,
              metadata: {
                kind: "system_log",
                body: "The firewall blocked egress to 192.0.2.88.",
              },
            },
            {
              artifact_id: "art_vault_ok",
              name: "VLT-301",
              type: "incident_record/system_log",
              created_at: now,
              metadata: {
                kind: "system_log",
                body: "Token rotation succeeded on vault-eu-1.",
              },
            },
            {
              artifact_id: "art_repl_zero",
              name: "REP-401",
              type: "incident_record/system_log",
              created_at: now,
              metadata: {
                kind: "system_log",
                body: "replication error count=0 on shard-4",
              },
            },
          ],
          evidence: {
            test_results: [],
            review_results: [],
            approval_events: [],
            security_events: [],
            verification_events: [
              {
                // Affirmative claim against negated record ("did not allow") -> contradicted
                event_id: "ev_affirm_vs_neg",
                run_id: runId,
                sequence_index: 0,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_affirm_vs_neg",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:GW-101"],
                artifact_refs: [],
                details: {
                  claim: "The gateway allowed access from 203.0.113.7.",
                  capture_status: "captured",
                },
              },
              {
                // Negated claim against affirmative record ("allowed") -> contradicted
                event_id: "ev_neg_vs_affirm",
                run_id: runId,
                sequence_index: 1,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_neg_vs_affirm",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:GW-102"],
                artifact_refs: [],
                details: {
                  claim: "The gateway did not allow access from 198.51.100.44.",
                  capture_status: "captured",
                },
              },
              {
                // Consistent negated claim against negated record -> supported
                event_id: "ev_neg_vs_neg",
                run_id: runId,
                sequence_index: 2,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_neg_vs_neg",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:GW-101"],
                artifact_refs: [],
                details: {
                  claim: "The gateway did not allow access from 203.0.113.7.",
                  capture_status: "captured",
                },
              },
              {
                // Affirmative permission ("permitted") vs explicit denial ("blocked") -> contradicted
                event_id: "ev_permit_vs_block",
                run_id: runId,
                sequence_index: 3,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_permit_vs_block",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:FW-201"],
                artifact_refs: [],
                details: {
                  claim: "The firewall permitted egress to 192.0.2.88.",
                  capture_status: "captured",
                },
              },
              {
                // Negated permission ("did not permit") vs explicit denial ("blocked") -> supported
                event_id: "ev_not_permit_vs_block",
                run_id: runId,
                sequence_index: 4,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_not_permit_vs_block",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:FW-201"],
                artifact_refs: [],
                details: {
                  claim: "The firewall did not permit egress to 192.0.2.88.",
                  capture_status: "captured",
                },
              },
              {
                // Contraction ("didn't succeed") vs affirmative outcome ("succeeded") -> contradicted
                event_id: "ev_contraction_contra",
                run_id: runId,
                sequence_index: 5,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_contraction_contra",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:VLT-301"],
                artifact_refs: [],
                details: {
                  claim: "Token rotation didn't succeed on vault-eu-1.",
                  capture_status: "captured",
                },
              },
              {
                // Zero-error phrasing against count=0 log -> supported
                event_id: "ev_zero_errors_sup",
                run_id: runId,
                sequence_index: 6,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_zero_errors_sup",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:REP-401"],
                artifact_refs: [],
                details: {
                  claim: "Replication had zero errors on shard-4.",
                  capture_status: "captured",
                },
              },
            ],
          },
        });

        const { result } = runKarmaPoliceWithFindings(artifact);
        const byId = new Map(result.predictions.map((p) => [p.claim_id, p]));

        expect(byId.get("claim_affirm_vs_neg")?.classification).toBe("contradicted");
        expect(byId.get("claim_neg_vs_affirm")?.classification).toBe("contradicted");
        expect(byId.get("claim_neg_vs_neg")?.classification).toBe("supported");
        expect(byId.get("claim_permit_vs_block")?.classification).toBe("contradicted");
        expect(byId.get("claim_not_permit_vs_block")?.classification).toBe("supported");
        expect(byId.get("claim_contraction_contra")?.classification).toBe("contradicted");
        expect(byId.get("claim_zero_errors_sup")?.classification).toBe("supported");
      });

      it("handles neutral-predicate 'not'/'never'/'without' inversions without falsely contradicting unrelated predicates", () => {
        const now = "2026-11-06T12:35:00.000Z";
        const runId = "run_h2_gate_neutral_negation";
        const artifact = buildStandaloneArtifact({
          runId,
          artifacts: [
            {
              artifact_id: "art_sudo_log",
              name: "AUD-11",
              type: "incident_record/system_log",
              created_at: now,
              metadata: {
                kind: "system_log",
                body: "successful sudo by svc-sync on db-replica-9",
              },
            },
            {
              artifact_id: "art_maint_nosudo",
              name: "AUD-12",
              type: "incident_record/witness",
              created_at: now,
              metadata: {
                kind: "witness",
                body: "Operator ran maintenance without sudo on cache-node-2.",
              },
            },
          ],
          evidence: {
            test_results: [],
            review_results: [],
            approval_events: [],
            security_events: [],
            verification_events: [
              {
                // "never used sudo" vs "successful sudo" -> contradicted
                event_id: "ev_never_sudo",
                run_id: runId,
                sequence_index: 0,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_never_sudo",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:AUD-11"],
                artifact_refs: [],
                details: {
                  claim: "svc-sync never sudo on db-replica-9.",
                  capture_status: "captured",
                },
              },
              {
                // "ran maintenance with sudo" vs "without sudo" -> contradicted
                event_id: "ev_with_vs_without",
                run_id: runId,
                sequence_index: 1,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_with_vs_without",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:AUD-12"],
                artifact_refs: [],
                details: {
                  claim: "Operator ran maintenance with sudo on cache-node-2.",
                  capture_status: "captured",
                },
              },
              {
                // Unrelated negated predicate on same host -> unverified (must not falsely contradict)
                event_id: "ev_unrelated_neg",
                run_id: runId,
                sequence_index: 2,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_unrelated_neg",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:AUD-11"],
                artifact_refs: [],
                details: {
                  claim: "svc-sync did not truncate tables on db-replica-9.",
                  capture_status: "captured",
                },
              },
            ],
          },
        });

        const { result } = runKarmaPoliceWithFindings(artifact);
        const byId = new Map(result.predictions.map((p) => [p.claim_id, p]));

        expect(byId.get("claim_never_sudo")?.classification).toBe("contradicted");
        expect(byId.get("claim_with_vs_without")?.classification).toBe("contradicted");
        expect(byId.get("claim_unrelated_neg")?.classification).toBe("unverified");
      });

      it("evaluates missing observations, negative universals, cherry-picked invariants, and self-contradictory compound claims", () => {
        const now = "2026-11-06T12:40:00.000Z";

        // 1. Missing observation: uncaptured record body causes abstention on direct, affirmative-universal, and negative-universal claims
        const missingRunId = "run_h2_gate_missing_obs";
        const missingArtifact = buildStandaloneArtifact({
          runId: missingRunId,
          artifacts: [
            {
              artifact_id: "art_obs_1",
              name: "OBS-1",
              type: "incident_record/system_log",
              created_at: now,
              metadata: {
                kind: "system_log",
                body: "The gateway did not allow access from 203.0.113.7.",
              },
            },
            {
              artifact_id: "art_obs_2_uncaptured",
              name: "OBS-2",
              type: "incident_record/system_log",
              created_at: now,
              metadata: {
                kind: "system_log",
                // body intentionally omitted (missing observation)
              },
            },
          ],
          evidence: {
            test_results: [],
            review_results: [],
            approval_events: [],
            security_events: [],
            verification_events: [
              {
                event_id: "ev_direct_missing",
                run_id: missingRunId,
                sequence_index: 0,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_direct_missing",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:OBS-2"],
                artifact_refs: [],
                details: {
                  claim: "The gateway allowed access from 203.0.113.7.",
                  capture_status: "captured",
                },
              },
              {
                event_id: "ev_neg_univ_missing",
                run_id: missingRunId,
                sequence_index: 1,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_neg_univ_missing",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: [],
                artifact_refs: [],
                details: {
                  claim: "No system logs show gateway allowed access from 203.0.113.7.",
                  capture_status: "captured",
                },
              },
              {
                event_id: "ev_affirm_univ_missing",
                run_id: missingRunId,
                sequence_index: 2,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_affirm_univ_missing",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: [],
                artifact_refs: [],
                details: {
                  claim: "All system logs confirm the gateway did not allow access from 203.0.113.7.",
                  capture_status: "captured",
                },
              },
            ],
          },
        });

        const missingRes = runKarmaPoliceWithFindings(missingArtifact);
        for (const pred of missingRes.result.predictions) {
          expect(pred.classification).toBe("unverified");
          expect(pred.abstained).toBe(true);
        }

        // 2. Complete observations: negative universals, cherry-picked "never" claims, and compound self-contradictions
        const univRunId = "run_h2_gate_conflicting_universals";
        const univArtifact = buildStandaloneArtifact({
          runId: univRunId,
          artifacts: [
            {
              artifact_id: "art_log_t1",
              name: "LOG-T1",
              type: "incident_record/system_log",
              created_at: "2026-11-06T12:01:00.000Z",
              metadata: {
                kind: "system_log",
                body: "The gateway did not allow access from 203.0.113.7.",
              },
            },
            {
              artifact_id: "art_log_t2",
              name: "LOG-T2",
              type: "incident_record/system_log",
              created_at: "2026-11-06T12:05:00.000Z",
              metadata: {
                kind: "system_log",
                body: "The gateway allowed access from 203.0.113.7.",
              },
            },
            {
              artifact_id: "art_log_t3",
              name: "LOG-T3",
              type: "incident_record/system_log",
              created_at: "2026-11-06T12:06:00.000Z",
              metadata: {
                kind: "system_log",
                body: "The gateway did not allow access from 198.51.100.99.",
              },
            },
          ],
          evidence: {
            test_results: [],
            review_results: [],
            approval_events: [],
            security_events: [],
            verification_events: [
              {
                // Negative universal refuted by LOG-T2 -> contradicted
                event_id: "ev_neg_univ_contra",
                run_id: univRunId,
                sequence_index: 0,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_neg_univ_contra",
                status: "PASSED",
                actor: "beta_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: [],
                artifact_refs: [],
                details: {
                  claim: "No system logs show the gateway allowed access from 203.0.113.7.",
                  capture_status: "captured",
                },
              },
              {
                // Negative universal genuinely true across all logs (for 198.51.100.99) -> supported
                event_id: "ev_neg_univ_true",
                run_id: univRunId,
                sequence_index: 1,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_neg_univ_true",
                status: "PASSED",
                actor: "beta_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: [],
                artifact_refs: [],
                details: {
                  claim: "No system logs show the gateway allowed access from 198.51.100.99.",
                  capture_status: "captured",
                },
              },
              {
                // Cherry-picked "never" claim citing LOG-T1 while LOG-T2 in the same run refutes it -> contradicted
                event_id: "ev_cherry_pick_never",
                run_id: univRunId,
                sequence_index: 2,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_cherry_pick_never",
                status: "PASSED",
                actor: "beta_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:LOG-T1"],
                artifact_refs: [],
                details: {
                  claim: "The gateway never allowed access from 203.0.113.7.",
                  capture_status: "captured",
                },
              },
              {
                // True "never" claim for 198.51.100.99 citing LOG-T3 (must NOT collide with LOG-T2's 203.0.113.7!) -> supported
                event_id: "ev_true_never_other_ip",
                run_id: univRunId,
                sequence_index: 3,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_true_never_other_ip",
                status: "PASSED",
                actor: "beta_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:LOG-T3"],
                artifact_refs: [],
                details: {
                  claim: "The gateway never allowed access from 198.51.100.99.",
                  capture_status: "captured",
                },
              },
              {
                // Self-contradictory compound claim (P ; not P) -> contradicted
                event_id: "ev_self_contra",
                run_id: univRunId,
                sequence_index: 4,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_self_contra",
                status: "PASSED",
                actor: "beta_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["record:LOG-T3"],
                artifact_refs: [],
                details: {
                  claim:
                    "The gateway allowed access from 198.51.100.99; the gateway did not allow access from 198.51.100.99.",
                  capture_status: "captured",
                },
              },
            ],
          },
        });

        const univRes = runKarmaPoliceWithFindings(univArtifact);
        const byId = new Map(univRes.result.predictions.map((p) => [p.claim_id, p]));

        expect(byId.get("claim_neg_univ_contra")?.classification).toBe("contradicted");
        expect(byId.get("claim_neg_univ_true")?.classification).toBe("supported");
        expect(byId.get("claim_cherry_pick_never")?.classification).toBe("contradicted");
        expect(byId.get("claim_true_never_other_ip")?.classification).toBe("supported");
        expect(byId.get("claim_self_contra")?.classification).toBe("contradicted");
      });

      it("verifies negated structured-artifact mapping claims and negated validation-outcome claims", () => {
        const now = "2026-11-06T12:45:00.000Z";
        const runId = "run_h2_gate_se_negation";
        const artifact = buildStandaloneArtifact({
          runId,
          artifacts: [
            {
              artifact_id: "art_mapper_v1",
              name: "mapper-v1.json",
              type: "application/json",
              created_at: now,
              metadata: {
                version: "1",
                function_name: "mapper",
                body: { mapping: { WARN: "warning", ERR: "error" } },
              },
            },
          ],
          evidence: {
            test_results: [
              {
                test_id: "test_mapper_v1",
                run_id: runId,
                suite: "gold-suite",
                name: "mapper-v1",
                status: "PASSED",
                attempt: 1,
                origin: "system_recorded",
                authority: "authoritative",
                artifact_refs: ["art_mapper_v1"],
                started_at: now,
                completed_at: now,
              },
            ],
            review_results: [],
            approval_events: [],
            security_events: [],
            verification_events: [
              {
                event_id: "ev_neg_map_contra",
                run_id: runId,
                sequence_index: 0,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_neg_map_contra",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["artifact:mapper:v1"],
                artifact_refs: ["art_mapper_v1"],
                details: {
                  claim: "Artifact mapper v1 does not map WARN onto warning.",
                  capture_status: "captured",
                },
              },
              {
                event_id: "ev_neg_map_sup",
                run_id: runId,
                sequence_index: 1,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_neg_map_sup",
                status: "PASSED",
                actor: "alpha_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["artifact:mapper:v1"],
                artifact_refs: ["art_mapper_v1"],
                details: {
                  claim: "Artifact mapper v1 does not map INFO onto critical.",
                  capture_status: "captured",
                },
              },
              {
                event_id: "ev_neg_test_contra",
                run_id: runId,
                sequence_index: 2,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_neg_test_contra",
                status: "PASSED",
                actor: "beta_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["artifact:mapper:v1"],
                artifact_refs: ["art_mapper_v1"],
                details: {
                  claim: "Validation tests did not pass for mapper v1.",
                  capture_status: "captured",
                },
              },
              {
                event_id: "ev_zero_fail_test_sup",
                run_id: runId,
                sequence_index: 3,
                event_type: "verification.passed",
                target_type: "assertion",
                target_id: "claim_zero_fail_test_sup",
                status: "PASSED",
                actor: "beta_agent",
                origin: "agent_asserted",
                authority: "asserted",
                evidence_refs: ["artifact:mapper:v1"],
                artifact_refs: ["art_mapper_v1"],
                details: {
                  claim: "Validation completed without any test failures for mapper v1.",
                  capture_status: "captured",
                },
              },
            ],
          },
        });

        const { result } = runKarmaPoliceWithFindings(artifact);
        const byId = new Map(result.predictions.map((p) => [p.claim_id, p]));

        expect(byId.get("claim_neg_map_contra")?.classification).toBe("contradicted");
        expect(byId.get("claim_neg_map_sup")?.classification).toBe("supported");
        expect(byId.get("claim_neg_test_contra")?.classification).toBe("contradicted");
        expect(byId.get("claim_zero_fail_test_sup")?.classification).toBe("supported");
      });
    });
  });
});
