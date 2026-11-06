/**
 * KARMA POLICE — H2 Deterministic Matched-Monitor Evaluation Runner.
 *
 * Enforces the strict H2 experimental pipeline:
 *   1. Canonical recorded run -> isolated detector/ and evaluator/ storage
 *   2. Detector-only evidence (createDetectorAccess) -> three frozen monitors
 *   3. Predictions committed & hashed on disk BEFORE any oracle read
 *   4. Independent evaluator (evaluation.v2) -> per-case, per-domain, and aggregate metrics
 *
 * Never writes private oracle labels, justifications, or developer filesystem paths
 * into committed public results directories.
 *
 * Usage:
 *   REEPROV_P3_ALLOW_HELDOUT=1 \
 *   REEPROV_P3_SEALED_EVALUATION_PATH=<path/to/h2-sealed-pack.private.json> \
 *   npx tsx research/swarmguard-testbed/scripts/run-h2-evaluation.ts \
 *     --store-dir <isolated-store-dir> \
 *     --export-dir research/swarmguard-testbed/results/h2
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runBenchmarkCase } from "../src/experiment";
import { BENCHMARK_VERSION, listBenchmarkCases } from "../src/benchmark";
import { createDetectorAccess } from "../src/detector";
import { loadEvaluatorRecord } from "../src/persist";
import { findGroundTruthLeaks } from "../src/leakcheck";
import {
  KARMA_POLICE_MONITOR_ID,
  KARMA_POLICE_MONITOR_VERSION,
  runKarmaPoliceWithFindings,
  type KarmaPoliceFindingsReport,
} from "../src/karmaPolice";
import {
  PER_AGENT_MONITOR_ID,
  PER_AGENT_MONITOR_VERSION,
  POOLED_EVENT_MONITOR_ID,
  POOLED_EVENT_MONITOR_VERSION,
  runPerAgentMonitor,
  runPooledEventMonitor,
  type MonitorResult,
} from "../src/baselines";
import {
  EVALUATION_FORMAT,
  aggregateEvaluations,
  evaluateMonitor,
  evaluationToRow,
  type EvaluationReport,
} from "../src/evaluate";
import { loadSealedEvaluationPack, SEALED_EVALUATION_FORMAT } from "../src/sealed";
import { HELDOUT_ALLOW_ENV, SEALED_EVAL_ENV } from "../src/heldoutAccess";
import { commitSha } from "../src/gitmeta";

const FROZEN_DETECTOR_COMMIT_SHA = "5a4bcb59afa37e110b641b35db99c9a6b453137a";

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function sha256String(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function assertNoPrivatePathOrOracleLeak(serialized: string, label: string): void {
  if (/\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+/.test(serialized)) {
    throw new Error(`Private filesystem path detected in ${label}; refusing to write public artifact.`);
  }
  if (/oracle_labels|actual_modification/.test(serialized)) {
    throw new Error(`Oracle ground-truth structure detected in ${label}; refusing to write public artifact.`);
  }
}

async function writeSanitizedJson(filePath: string, value: unknown, label: string): Promise<string> {
  const serialized = JSON.stringify(value, null, 2) + "\n";
  assertNoPrivatePathOrOracleLeak(serialized, label);
  await writeFile(filePath, serialized, "utf8");
  return sha256String(serialized);
}

async function evaluateBenchmarkReference(storeDir: string, exportDir: string): Promise<void> {
  const refStoreDir = join(storeDir, "published-benchmark-ref");
  await mkdir(refStoreDir, { recursive: true });
  const detectorAccess = createDetectorAccess(refStoreDir);
  const cases = listBenchmarkCases("held_out");

  const reportsByMonitor: Record<string, EvaluationReport[]> = {
    [PER_AGENT_MONITOR_ID]: [],
    [POOLED_EVENT_MONITOR_ID]: [],
    [KARMA_POLICE_MONITOR_ID]: [],
  };

  for (const spec of cases) {
    const runId = `run_pubref_${spec.case_id}`;
    const executed = await runBenchmarkCase({
      caseId: spec.case_id,
      mode: "offline_fixture",
      outputDir: refStoreDir,
      persist: true,
      runId,
    });
    const detectorEvidence = await detectorAccess.loadRun(runId);
    if (findGroundTruthLeaks(detectorEvidence).length > 0) {
      throw new Error(`Ground-truth leak in detector evidence for ${spec.case_id}`);
    }

    const pa = runPerAgentMonitor(detectorEvidence.artifact, {
      caseId: spec.case_id,
      domainId: executed.domain_id,
    });
    const pe = runPooledEventMonitor(detectorEvidence.artifact, {
      caseId: spec.case_id,
      domainId: executed.domain_id,
    });
    const kp = runKarmaPoliceWithFindings(detectorEvidence, {
      caseId: spec.case_id,
      domainId: executed.domain_id,
    });

    const gt = await loadEvaluatorRecord(executed.persisted!.summary.evaluator_dir);
    reportsByMonitor[PER_AGENT_MONITOR_ID]!.push(
      evaluateMonitor({ prediction: pa, groundTruth: gt, domainId: executed.domain_id })
    );
    reportsByMonitor[POOLED_EVENT_MONITOR_ID]!.push(
      evaluateMonitor({ prediction: pe, groundTruth: gt, domainId: executed.domain_id })
    );
    reportsByMonitor[KARMA_POLICE_MONITOR_ID]!.push(
      evaluateMonitor({ prediction: kp.result, groundTruth: gt, domainId: executed.domain_id })
    );
  }

  const summary = {
    format: "reeprov.h2.published_benchmark_reference.v1",
    benchmark_version: BENCHMARK_VERSION,
    non_blind_public_benchmark: true,
    disclosure:
      "The 16 in-tree held-out cases from p3.benchmark.v1.1 have public oracle labels in Git history (PR #27) and are reported strictly as a non-blind regression benchmark, never as independent blind evidence.",
    frozen_detector_commit_sha: FROZEN_DETECTOR_COMMIT_SHA,
    case_count: cases.length,
    aggregates: {
      [PER_AGENT_MONITOR_ID]: aggregateEvaluations(reportsByMonitor[PER_AGENT_MONITOR_ID]!),
      [POOLED_EVENT_MONITOR_ID]: aggregateEvaluations(reportsByMonitor[POOLED_EVENT_MONITOR_ID]!),
      [KARMA_POLICE_MONITOR_ID]: aggregateEvaluations(reportsByMonitor[KARMA_POLICE_MONITOR_ID]!),
    },
  };

  await writeSanitizedJson(
    join(exportDir, "published-benchmark-reference.json"),
    summary,
    "published-benchmark-reference.json"
  );
}

async function main() {
  if (process.env[HELDOUT_ALLOW_ENV] !== "1") {
    throw new Error(`Independent H2 evaluation requires ${HELDOUT_ALLOW_ENV}=1.`);
  }
  const sealedPath = arg("--sealed-pack") ?? process.env[SEALED_EVAL_ENV];
  if (!sealedPath) {
    throw new Error(
      `Independent H2 evaluation requires ${SEALED_EVAL_ENV} or --sealed-pack pointing to an isolated sealed pack JSON.`
    );
  }
  process.env[SEALED_EVAL_ENV] = sealedPath;

  const defaultStore = join(process.cwd(), "research/swarmguard-testbed/.output/h2-isolated-store");
  const storeDir = arg("--store-dir") ?? defaultStore;
  const exportDir =
    arg("--export-dir") ?? join(process.cwd(), "research/swarmguard-testbed/results/h2");
  const includeBenchmarkRef = hasFlag("--include-published-benchmark");

  process.env["REEPROV_STORE_DIR"] = join(storeDir, ".reeprov-store");

  await mkdir(storeDir, { recursive: true });
  await mkdir(join(exportDir, "predictions"), { recursive: true });
  await mkdir(join(exportDir, "evaluations"), { recursive: true });

  // Load sealed evaluation pack in evaluator controller and verify pre-scoring hash
  const loadedPack = await loadSealedEvaluationPack(sealedPath);
  const preScoringHash = loadedPack.integrity_hash;

  // Optional check against pre-scoring-seal.json if present alongside sealed pack
  let preScoringSealTimestamp: string | undefined;
  try {
    const rawSeal = JSON.parse(
      await readFile(join(sealedPath, "..", "pre-scoring-seal.json"), "utf8")
    ) as { sealed_pack_sha256?: string; sealed_at?: string };
    if (rawSeal.sealed_pack_sha256 && rawSeal.sealed_pack_sha256 !== preScoringHash) {
      throw new Error(
        `Sealed pack hash mismatch! Expected ${rawSeal.sealed_pack_sha256} from pre-scoring-seal.json, got ${preScoringHash}.`
      );
    }
    preScoringSealTimestamp = rawSeal.sealed_at;
  } catch (err) {
    if (err instanceof Error && err.message.includes("Sealed pack hash mismatch")) {
      throw err;
    }
  }

  console.log("================================================================================");
  console.log(" KARMA POLICE — H2 Post-Freeze Evaluator-Controlled Matched Comparison");
  console.log(` Pack Version:        ${loadedPack.pack.version}`);
  console.log(` Pre-Scoring SHA256:  ${preScoringHash}`);
  console.log(` Frozen Detector SHA: ${FROZEN_DETECTOR_COMMIT_SHA}`);
  console.log(` Cases:               ${loadedPack.cases.length}`);
  console.log("================================================================================");

  // -------------------------------------------------------------------------
  // PHASE 1 & 2: Canonical Runs -> Detector-Only Evidence -> Commit Predictions
  // (No oracle scoring occurs until ALL monitor predictions are committed!)
  // -------------------------------------------------------------------------
  const detectorAccess = createDetectorAccess(storeDir);

  interface CommittedCaseRun {
    caseId: string;
    runId: string;
    domainId: string;
    scenarioId: string;
    contentVariant: string;
    executionMode: string;
    evaluatorDir: string;
    predictionsSha256: string;
    perAgent: MonitorResult;
    pooledEvent: MonitorResult;
    karmaPolice: MonitorResult;
    karmaPoliceFindings: KarmaPoliceFindingsReport;
    captureCompleteness: {
      steps: number;
      tools: number;
      artifacts: number;
      handoffs: number;
      verification_events: number;
    };
  }

  const committedRuns: CommittedCaseRun[] = [];

  for (const spec of loadedPack.cases) {
    const runId = `run_h2_${spec.case_id}`;
    const executed = await runBenchmarkCase({
      caseId: spec.case_id,
      mode: "offline_fixture",
      outputDir: storeDir,
      persist: true,
      runId,
    });

    if (executed.ground_truth.experimental_validity !== "valid") {
      throw new Error(
        `Invalid experimental run for ${spec.case_id}: experimental_validity=${executed.ground_truth.experimental_validity}`
      );
    }

    // Load strictly detector-visible canonical evidence
    const detectorEvidence = await detectorAccess.loadRun(runId);
    const leaks = findGroundTruthLeaks(detectorEvidence);
    if (leaks.length > 0) {
      throw new Error(`Ground-truth leak detected in ${spec.case_id}: ${leaks.join("; ")}`);
    }

    // Execute all three frozen monitors on the IDENTICAL canonical RunArtifact
    const canonicalArtifact = detectorEvidence.artifact;
    const perAgent = runPerAgentMonitor(canonicalArtifact, {
      caseId: spec.case_id,
      domainId: executed.domain_id,
    });
    const pooledEvent = runPooledEventMonitor(canonicalArtifact, {
      caseId: spec.case_id,
      domainId: executed.domain_id,
    });
    const { result: karmaPolice, findings: karmaPoliceFindings } = runKarmaPoliceWithFindings(
      detectorEvidence,
      {
        caseId: spec.case_id,
        domainId: executed.domain_id,
      }
    );

    const casePredictionBundle = {
      format: "reeprov.h2.case_predictions.v1",
      case_id: spec.case_id,
      run_id: runId,
      domain_id: executed.domain_id,
      scenario_id: executed.scenario_id,
      content_variant: spec.content_variant,
      execution_mode: executed.execution_mode,
      frozen_detector_commit_sha: FROZEN_DETECTOR_COMMIT_SHA,
      monitors: {
        [PER_AGENT_MONITOR_ID]: perAgent,
        [POOLED_EVENT_MONITOR_ID]: pooledEvent,
        [KARMA_POLICE_MONITOR_ID]: karmaPolice,
      },
      karma_police_provenance_findings: karmaPoliceFindings,
    };

    const predictionsSha256 = await writeSanitizedJson(
      join(exportDir, "predictions", `${spec.case_id}.predictions.json`),
      casePredictionBundle,
      `predictions/${spec.case_id}.predictions.json`
    );

    committedRuns.push({
      caseId: spec.case_id,
      runId,
      domainId: executed.domain_id,
      scenarioId: executed.scenario_id,
      contentVariant: spec.content_variant,
      executionMode: executed.execution_mode,
      evaluatorDir: executed.persisted!.summary.evaluator_dir,
      predictionsSha256,
      perAgent,
      pooledEvent,
      karmaPolice,
      karmaPoliceFindings,
      captureCompleteness: {
        steps: (canonicalArtifact.trajectory ?? []).length,
        tools: (canonicalArtifact.tools ?? []).length,
        artifacts: (canonicalArtifact.artifacts ?? []).length,
        handoffs: (canonicalArtifact.handoffs ?? []).length,
        verification_events: (canonicalArtifact.evidence?.verification_events ?? []).length,
      },
    });
  }

  const predictionsCommitCompletedAt = new Date().toISOString();

  // -------------------------------------------------------------------------
  // PHASE 3: Independent Evaluator Scoring (evaluation.v2) AFTER Commit
  // -------------------------------------------------------------------------
  const reportsByMonitor: Record<string, EvaluationReport[]> = {
    [PER_AGENT_MONITOR_ID]: [],
    [POOLED_EVENT_MONITOR_ID]: [],
    [KARMA_POLICE_MONITOR_ID]: [],
  };

  const perCaseRows: Array<Record<string, unknown>> = [];
  const provenanceSeparationSummary: Array<Record<string, unknown>> = [];

  for (const run of committedRuns) {
    const groundTruth = await loadEvaluatorRecord(run.evaluatorDir);

    const evalPa = evaluateMonitor({
      prediction: run.perAgent,
      groundTruth,
      domainId: run.domainId,
    });
    const evalPe = evaluateMonitor({
      prediction: run.pooledEvent,
      groundTruth,
      domainId: run.domainId,
    });
    const evalKp = evaluateMonitor({
      prediction: run.karmaPolice,
      groundTruth,
      domainId: run.domainId,
    });

    reportsByMonitor[PER_AGENT_MONITOR_ID]!.push(evalPa);
    reportsByMonitor[POOLED_EVENT_MONITOR_ID]!.push(evalPe);
    reportsByMonitor[KARMA_POLICE_MONITOR_ID]!.push(evalKp);

    const caseEvalBundle = {
      format: "reeprov.h2.case_evaluation.v1",
      evaluator_protocol: EVALUATION_FORMAT,
      case_id: run.caseId,
      run_id: run.runId,
      domain_id: run.domainId,
      scenario_id: run.scenarioId,
      content_variant: run.contentVariant,
      committed_predictions_sha256: run.predictionsSha256,
      evaluations: {
        [PER_AGENT_MONITOR_ID]: evalPa,
        [POOLED_EVENT_MONITOR_ID]: evalPe,
        [KARMA_POLICE_MONITOR_ID]: evalKp,
      },
    };

    await writeSanitizedJson(
      join(exportDir, "evaluations", `${run.caseId}.evaluation.json`),
      caseEvalBundle,
      `evaluations/${run.caseId}.evaluation.json`
    );

    perCaseRows.push({
      case_id: run.caseId,
      domain_id: run.domainId,
      variant: run.contentVariant,
      gold_claims: evalKp.gold_claims,
      pa_acc: evalPa.classification.accuracy.value,
      pe_acc: evalPe.classification.accuracy.value,
      kp_acc: evalKp.classification.accuracy.value,
      pa_contra_rec: evalPa.classification.contradiction_recall.value,
      pe_contra_rec: evalPe.classification.contradiction_recall.value,
      kp_contra_rec: evalKp.classification.contradiction_recall.value,
      kp_provenance_anomalies: run.karmaPoliceFindings.summary.provenance_anomalies_detected,
    });

    provenanceSeparationSummary.push({
      case_id: run.caseId,
      domain_id: run.domainId,
      content_variant: run.contentVariant,
      provenance_anomalies_detected: run.karmaPoliceFindings.summary.provenance_anomalies_detected,
      anomaly_breakdown: run.karmaPoliceFindings.findings
        .flatMap((f) => f.provenance_anomalies)
        .filter((a) => a !== "none"),
    });
  }

  const aggPerAgent = aggregateEvaluations(reportsByMonitor[PER_AGENT_MONITOR_ID]!);
  const aggPooledEvent = aggregateEvaluations(reportsByMonitor[POOLED_EVENT_MONITOR_ID]!);
  const aggKarmaPolice = aggregateEvaluations(reportsByMonitor[KARMA_POLICE_MONITOR_ID]!);

  const monitorsMetadata = {
    format: "reeprov.h2.monitors.v1",
    frozen_detector_commit_sha: FROZEN_DETECTOR_COMMIT_SHA,
    evaluation_runner_commit_sha: commitSha(),
    monitors: [
      {
        monitor_id: PER_AGENT_MONITOR_ID,
        monitor_version: PER_AGENT_MONITOR_VERSION,
        frozen_at_commit_sha: FROZEN_DETECTOR_COMMIT_SHA,
        scope: "Single-agent local tool and assertion history only; ignores cross-agent handoffs and system test/artifact tables.",
        uses_llm_judge: false,
        measured_tokens: 0,
        measured_cost_usd: 0,
      },
      {
        monitor_id: POOLED_EVENT_MONITOR_ID,
        monitor_version: POOLED_EVENT_MONITOR_VERSION,
        frozen_at_commit_sha: FROZEN_DETECTOR_COMMIT_SHA,
        scope: "Pooled event stream bag without claim-specific entity/version binding or producer-vs-delivered handoff comparison.",
        uses_llm_judge: false,
        measured_tokens: 0,
        measured_cost_usd: 0,
      },
      {
        monitor_id: KARMA_POLICE_MONITOR_ID,
        monitor_version: KARMA_POLICE_MONITOR_VERSION,
        frozen_at_commit_sha: FROZEN_DETECTOR_COMMIT_SHA,
        scope: "Deterministic cross-agent claim-to-evidence resolver over canonical RunArtifact with provenance-anomaly separation.",
        uses_llm_judge: false,
        measured_tokens: 0,
        measured_cost_usd: 0,
      },
    ],
  };

  const metricsSummary = {
    format: "reeprov.h2.metrics_summary.v1",
    evaluator_protocol: EVALUATION_FORMAT,
    evaluation_regime: "post_freeze_evaluator_controlled",
    blind_claim: false,
    regime_note:
      "Detector logic was committed and frozen (SHA 5a4bcb59afa37e110b641b35db99c9a6b453137a) before any H2 scenario or oracle was authored. Because scenarios were authored in the same research sprint after freeze, this evaluation is reported as post-freeze, evaluator-controlled rather than third-party blind.",
    sealed_pack_format: SEALED_EVALUATION_FORMAT,
    sealed_pack_version: loadedPack.pack.version,
    sealed_pack_sha256: preScoringHash,
    pre_scoring_seal_recorded_at: preScoringSealTimestamp ?? null,
    predictions_committed_at: predictionsCommitCompletedAt,
    scored_at: new Date().toISOString(),
    case_count: committedRuns.length,
    domain_case_counts: {
      "software-engineering": committedRuns.filter((r) => r.domainId === "software-engineering")
        .length,
      investigation: committedRuns.filter((r) => r.domainId === "investigation").length,
    },
    aggregates: {
      [PER_AGENT_MONITOR_ID]: aggPerAgent,
      [POOLED_EVENT_MONITOR_ID]: aggPooledEvent,
      [KARMA_POLICE_MONITOR_ID]: aggKarmaPolice,
    },
    table_rows: [
      evaluationToRow(aggPerAgent),
      evaluationToRow(aggPooledEvent),
      evaluationToRow(aggKarmaPolice),
    ],
    per_case_overview: perCaseRows,
    provenance_anomaly_summary: {
      note: "Provenance anomalies are tracked in companion findings (reeprov.karma_police.findings.v1) and are never folded into factual classification accuracy.",
      total_anomalies_across_pack: provenanceSeparationSummary.reduce(
        (acc, item) => acc + Number(item["provenance_anomalies_detected"] ?? 0),
        0
      ),
      per_case: provenanceSeparationSummary,
    },
    execution_and_cost: {
      episode_execution_mode: "offline_fixture",
      provider_http_completed: false,
      monitor_token_usage: "not_applicable_deterministic_monitors_0_tokens",
      monitor_cost_usd: 0,
      total_monitor_latency_ms: {
        [PER_AGENT_MONITOR_ID]: aggPerAgent.latency_ms,
        [POOLED_EVENT_MONITOR_ID]: aggPooledEvent.latency_ms,
        [KARMA_POLICE_MONITOR_ID]: aggKarmaPolice.latency_ms,
      },
    },
  };

  const confusionMatrices = {
    format: "reeprov.h2.confusion_matrices.v1",
    evaluator_protocol: EVALUATION_FORMAT,
    sealed_pack_sha256: preScoringHash,
    aggregate: {
      [PER_AGENT_MONITOR_ID]: aggPerAgent.classification.confusion,
      [POOLED_EVENT_MONITOR_ID]: aggPooledEvent.classification.confusion,
      [KARMA_POLICE_MONITOR_ID]: aggKarmaPolice.classification.confusion,
    },
    per_domain: {
      "software-engineering": {
        [PER_AGENT_MONITOR_ID]:
          aggPerAgent.per_domain?.["software-engineering"]?.classification.confusion,
        [POOLED_EVENT_MONITOR_ID]:
          aggPooledEvent.per_domain?.["software-engineering"]?.classification.confusion,
        [KARMA_POLICE_MONITOR_ID]:
          aggKarmaPolice.per_domain?.["software-engineering"]?.classification.confusion,
      },
      investigation: {
        [PER_AGENT_MONITOR_ID]:
          aggPerAgent.per_domain?.["investigation"]?.classification.confusion,
        [POOLED_EVENT_MONITOR_ID]:
          aggPooledEvent.per_domain?.["investigation"]?.classification.confusion,
        [KARMA_POLICE_MONITOR_ID]:
          aggKarmaPolice.per_domain?.["investigation"]?.classification.confusion,
      },
    },
  };

  const manifest = {
    format: "reeprov.h2.evaluation_manifest.v1",
    sealed_pack_format: SEALED_EVALUATION_FORMAT,
    sealed_pack_version: loadedPack.pack.version,
    sealed_pack_sha256: preScoringHash,
    pre_scoring_seal_recorded_at: preScoringSealTimestamp ?? null,
    frozen_detector_commit_sha: FROZEN_DETECTOR_COMMIT_SHA,
    evaluation_runner_commit_sha: commitSha(),
    evaluator_protocol: EVALUATION_FORMAT,
    evaluation_regime: "post_freeze_evaluator_controlled",
    cases: committedRuns.map((r) => ({
      case_id: r.caseId,
      run_id: r.runId,
      domain_id: r.domainId,
      scenario_id: r.scenarioId,
      content_variant: r.contentVariant,
      execution_mode: r.executionMode,
      committed_predictions_sha256: r.predictionsSha256,
      capture_completeness: r.captureCompleteness,
    })),
    reproduction_commands: {
      run_post_freeze_sealed_evaluation:
        "REEPROV_P3_ALLOW_HELDOUT=1 REEPROV_P3_SEALED_EVALUATION_PATH=<path-to-h2-sealed-pack.private.json> npx tsx research/swarmguard-testbed/scripts/run-h2-evaluation.ts --store-dir <isolated-store-dir> --export-dir research/swarmguard-testbed/results/h2",
      run_published_benchmark_reference:
        "REEPROV_P3_ALLOW_HELDOUT=1 REEPROV_P3_SEALED_EVALUATION_PATH=<path-to-h2-sealed-pack.private.json> npx tsx research/swarmguard-testbed/scripts/run-h2-evaluation.ts --store-dir <isolated-store-dir> --export-dir research/swarmguard-testbed/results/h2 --include-published-benchmark",
      run_pre_evaluation_regression_tests:
        "npx vitest run research/swarmguard-testbed/__tests__/karmaPolice.test.ts",
    },
  };

  await writeSanitizedJson(join(exportDir, "monitors.json"), monitorsMetadata, "monitors.json");
  await writeSanitizedJson(
    join(exportDir, "metrics-summary.json"),
    metricsSummary,
    "metrics-summary.json"
  );
  await writeSanitizedJson(
    join(exportDir, "confusion-matrices.json"),
    confusionMatrices,
    "confusion-matrices.json"
  );
  await writeSanitizedJson(join(exportDir, "manifest.json"), manifest, "manifest.json");

  if (includeBenchmarkRef) {
    await evaluateBenchmarkReference(storeDir, exportDir);
  }

  console.table(perCaseRows);
  console.log("\nAggregate Three-Monitor Summary (Post-Freeze H2 Pack):");
  console.table([
    evaluationToRow(aggPerAgent),
    evaluationToRow(aggPooledEvent),
    evaluationToRow(aggKarmaPolice),
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
