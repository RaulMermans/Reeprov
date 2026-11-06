/**
 * KARMA POLICE — H3 Independent Reproducibility & Artifact Audit Verifier.
 *
 * Verifies without mutating any H1/H2 files:
 *   1. Exact zero-diff freeze on `src/karmaPolice` and `src/baselines` since SHA 5a4bcb59...
 *   2. SHA-256 integrity of all 16 committed H2 prediction bundles against manifest.json.
 *   3. Exact conservation and recomputation of aggregate and per-domain confusion matrices,
 *      numerators, denominators, abstentions, false supports, and provenance anomalies
 *      from the 16 per-case evaluation and prediction artifacts.
 *   4. Live deterministic re-execution of all three frozen monitors over the committed
 *      external Microsoft Agent Framework canonical RunArtifact traces (`maf-cs-control-01`
 *      and `maf-cs-tamper-01`, pinned upstream SHA 82f03c81aba5c5e4b1b36589027470bc5d094422).
 *
 * Usage:
 *   npx tsx docs/research/h3-submission/scripts/verify-h3-reproducibility.ts
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunArtifact } from "../../../../lib/core/contracts/runArtifact";
import {
  PER_AGENT_MONITOR_ID,
  POOLED_EVENT_MONITOR_ID,
  runPerAgentMonitor,
  runPooledEventMonitor,
} from "../../../../research/swarmguard-testbed/src/baselines";
import {
  KARMA_POLICE_MONITOR_ID,
  runKarmaPoliceWithFindings,
} from "../../../../research/swarmguard-testbed/src/karmaPolice";

const FROZEN_DETECTOR_SHA = "5a4bcb59afa37e110b641b35db99c9a6b453137a";
const EXPECTED_SEALED_PACK_SHA256 =
  "5f380067a7e8b67985579f90b7c47d2ebfd03e269bed8dd39f3ad96b678a1132";
const PINNED_MAF_SHA = "82f03c81aba5c5e4b1b36589027470bc5d094422";

const REPO_ROOT = process.cwd();
const H2_DIR = join(REPO_ROOT, "research/swarmguard-testbed/results/h2");
const EXT_DIR = join(H2_DIR, "external-validation");

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`[AUDIT MISMATCH] ${message}: expected ${e}, got ${a}`);
  }
}

interface ConfusionCounts {
  [pair: string]: number;
}

function emptyCounts(): ConfusionCounts {
  const gold = ["supported", "contradicted", "unverified"];
  const pred = ["supported", "contradicted", "unverified", "missing", "invalid"];
  const out: ConfusionCounts = {};
  for (const g of gold) {
    for (const p of pred) {
      out[`${g}->${p}`] = 0;
    }
  }
  return out;
}

function addCounts(target: ConfusionCounts, delta: ConfusionCounts): void {
  for (const [k, v] of Object.entries(delta)) {
    target[k] = (target[k] ?? 0) + v;
  }
}

function summarizeFromCounts(c: ConfusionCounts) {
  const total = Object.values(c).reduce((acc, v) => acc + v, 0);
  const missing =
    (c["supported->missing"] ?? 0) +
    (c["contradicted->missing"] ?? 0) +
    (c["unverified->missing"] ?? 0);
  const covered = total - missing;
  const exact =
    (c["supported->supported"] ?? 0) +
    (c["contradicted->contradicted"] ?? 0) +
    (c["unverified->unverified"] ?? 0);
  const goldCon =
    (c["contradicted->supported"] ?? 0) +
    (c["contradicted->contradicted"] ?? 0) +
    (c["contradicted->unverified"] ?? 0) +
    (c["contradicted->missing"] ?? 0) +
    (c["contradicted->invalid"] ?? 0);
  const predCon =
    (c["supported->contradicted"] ?? 0) +
    (c["contradicted->contradicted"] ?? 0) +
    (c["unverified->contradicted"] ?? 0);
  const falseCon =
    (c["supported->contradicted"] ?? 0) + (c["unverified->contradicted"] ?? 0);
  const coveredNonCon =
    covered -
    ((c["contradicted->supported"] ?? 0) +
      (c["contradicted->contradicted"] ?? 0) +
      (c["contradicted->unverified"] ?? 0));
  const nonSupportedGold =
    goldCon +
    ((c["unverified->supported"] ?? 0) +
      (c["unverified->contradicted"] ?? 0) +
      (c["unverified->unverified"] ?? 0) +
      (c["unverified->missing"] ?? 0) +
      (c["unverified->invalid"] ?? 0));
  const falseSupport =
    (c["contradicted->supported"] ?? 0) + (c["unverified->supported"] ?? 0);
  const abstained =
    (c["supported->unverified"] ?? 0) +
    (c["contradicted->unverified"] ?? 0) +
    (c["unverified->unverified"] ?? 0);

  return {
    total,
    covered,
    exact,
    goldCon,
    predCon,
    trueCon: c["contradicted->contradicted"] ?? 0,
    falseCon,
    coveredNonCon,
    nonSupportedGold,
    falseSupport,
    abstained,
    missing,
  };
}

async function main(): Promise<void> {
  // 1. Verify frozen detector & baselines zero-diff
  const diff = execFileSync(
    "git",
    [
      "diff",
      FROZEN_DETECTOR_SHA,
      "--",
      "research/swarmguard-testbed/src/karmaPolice",
      "research/swarmguard-testbed/src/baselines",
    ],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  assertEqual(diff.trim(), "", "Detector and baselines must have zero diff since freeze SHA");

  // 2. Verify manifest and per-case SHA-256 digests
  const manifest = JSON.parse(await readFile(join(H2_DIR, "manifest.json"), "utf8")) as {
    sealed_pack_sha256: string;
    frozen_detector_commit_sha: string;
    cases: Array<{
      case_id: string;
      domain_id: string;
      execution_mode: string;
      committed_predictions_sha256: string;
    }>;
  };
  assertEqual(manifest.sealed_pack_sha256, EXPECTED_SEALED_PACK_SHA256, "Sealed pack SHA-256");
  assertEqual(manifest.frozen_detector_commit_sha, FROZEN_DETECTOR_SHA, "Frozen detector SHA");
  assertEqual(manifest.cases.length, 16, "H2 scenario count");

  const monitorIds = [
    PER_AGENT_MONITOR_ID,
    POOLED_EVENT_MONITOR_ID,
    KARMA_POLICE_MONITOR_ID,
  ] as const;

  const overallByMonitor: Record<string, ConfusionCounts> = {};
  const domainByMonitor: Record<string, Record<string, ConfusionCounts>> = {
    "software-engineering": {},
    investigation: {},
  };
  for (const m of monitorIds) {
    overallByMonitor[m] = emptyCounts();
    domainByMonitor["software-engineering"]![m] = emptyCounts();
    domainByMonitor["investigation"]![m] = emptyCounts();
  }

  let totalProvenanceAnomalies = 0;
  let casesWithAnomalies = 0;

  for (const entry of manifest.cases) {
    assertEqual(entry.execution_mode, "offline_fixture", `${entry.case_id} execution mode`);
    const predRaw = await readFile(
      join(H2_DIR, "predictions", `${entry.case_id}.predictions.json`),
      "utf8"
    );
    assertEqual(
      sha256(predRaw),
      entry.committed_predictions_sha256,
      `${entry.case_id} prediction SHA-256`
    );

    const predJson = JSON.parse(predRaw) as {
      karma_police_provenance_findings: {
        summary: { provenance_anomalies_detected: number };
      };
    };
    const anom = predJson.karma_police_provenance_findings.summary.provenance_anomalies_detected;
    totalProvenanceAnomalies += anom;
    if (anom > 0) casesWithAnomalies++;

    const evalRaw = await readFile(
      join(H2_DIR, "evaluations", `${entry.case_id}.evaluation.json`),
      "utf8"
    );
    const evalJson = JSON.parse(evalRaw) as {
      committed_predictions_sha256: string;
      evaluations: Record<
        string,
        { classification: { confusion: { counts: ConfusionCounts } } }
      >;
    };
    assertEqual(
      evalJson.committed_predictions_sha256,
      entry.committed_predictions_sha256,
      `${entry.case_id} evaluation->prediction hash link`
    );

    for (const m of monitorIds) {
      const counts = evalJson.evaluations[m]!.classification.confusion.counts;
      addCounts(overallByMonitor[m]!, counts);
      addCounts(domainByMonitor[entry.domain_id]![m]!, counts);
    }
  }

  // 3. Cross-check against metrics-summary.json and confusion-matrices.json
  const confusionFile = JSON.parse(
    await readFile(join(H2_DIR, "confusion-matrices.json"), "utf8")
  ) as {
    aggregate: Record<string, { counts: ConfusionCounts }>;
    per_domain: Record<string, Record<string, { counts: ConfusionCounts }>>;
  };

  for (const m of monitorIds) {
    assertEqual(
      overallByMonitor[m],
      confusionFile.aggregate[m]!.counts,
      `Aggregate confusion matrix conservation for ${m}`
    );
    assertEqual(
      domainByMonitor["software-engineering"]![m],
      confusionFile.per_domain["software-engineering"]![m]!.counts,
      `SE confusion matrix conservation for ${m}`
    );
    assertEqual(
      domainByMonitor["investigation"]![m],
      confusionFile.per_domain["investigation"]![m]!.counts,
      `INV confusion matrix conservation for ${m}`
    );
  }

  const pa = summarizeFromCounts(overallByMonitor[PER_AGENT_MONITOR_ID]!);
  const pe = summarizeFromCounts(overallByMonitor[POOLED_EVENT_MONITOR_ID]!);
  const kp = summarizeFromCounts(overallByMonitor[KARMA_POLICE_MONITOR_ID]!);

  assertEqual([pa.exact, pa.total], [29, 88], "Per-Agent accuracy 29/88");
  assertEqual([pa.trueCon, pa.goldCon], [0, 20], "Per-Agent contradiction recall 0/20");
  assertEqual([pe.exact, pe.total], [52, 88], "Pooled-Event accuracy 52/88");
  assertEqual([pe.trueCon, pe.goldCon], [4, 20], "Pooled-Event contradiction recall 4/20");
  assertEqual([kp.exact, kp.total], [68, 88], "Karma Police accuracy 68/88");
  assertEqual([kp.trueCon, kp.goldCon], [16, 20], "Karma Police contradiction recall 16/20");
  assertEqual([kp.trueCon, kp.predCon], [16, 22], "Karma Police contradiction precision 16/22");
  assertEqual([kp.falseSupport, kp.nonSupportedGold], [0, 36], "Karma Police false support 0/36");
  assertEqual([kp.covered, kp.total], [85, 88], "Karma Police prediction coverage 85/88");
  assertEqual(totalProvenanceAnomalies, 14, "Total provenance anomalies 14");
  assertEqual(casesWithAnomalies, 8, "Cases with provenance anomalies 8");

  // 4. Live deterministic re-execution of external MAF canonical RunArtifact bundles
  const extProv = JSON.parse(await readFile(join(EXT_DIR, "provenance.json"), "utf8")) as {
    upstream: { pinned_commit_sha: string };
    episodes: Array<{
      episode_id: string;
      canonical_artifact_sha256: string;
      committed_predictions_sha256: string;
      evaluation_sha256: string;
    }>;
  };
  assertEqual(extProv.upstream.pinned_commit_sha, PINNED_MAF_SHA, "Pinned MAF SHA");

  for (const ep of extProv.episodes) {
    const artRaw = await readFile(join(EXT_DIR, `${ep.episode_id}.run-artifact.json`), "utf8");
    const predRaw = await readFile(join(EXT_DIR, `${ep.episode_id}.predictions.json`), "utf8");
    const evalRaw = await readFile(join(EXT_DIR, `${ep.episode_id}.evaluation.json`), "utf8");

    assertEqual(sha256(artRaw), ep.canonical_artifact_sha256, `${ep.episode_id} artifact SHA-256`);
    assertEqual(
      sha256(predRaw),
      ep.committed_predictions_sha256,
      `${ep.episode_id} predictions SHA-256`
    );
    assertEqual(sha256(evalRaw), ep.evaluation_sha256, `${ep.episode_id} evaluation SHA-256`);

    const artifact = JSON.parse(artRaw) as RunArtifact;
    const committed = JSON.parse(predRaw) as {
      monitors: Record<
        string,
        { result: { predictions: Array<{ claim_id: string; classification: string }> } }
      >;
    };

    const livePa = runPerAgentMonitor(artifact, {
      caseId: ep.episode_id,
      domainId: "external-maf-customer-support",
    });
    const livePe = runPooledEventMonitor(artifact, {
      caseId: ep.episode_id,
      domainId: "external-maf-customer-support",
    });
    const liveKp = runKarmaPoliceWithFindings(artifact, {
      caseId: ep.episode_id,
      domainId: "external-maf-customer-support",
    });

    for (const [id, live] of [
      [PER_AGENT_MONITOR_ID, livePa],
      [POOLED_EVENT_MONITOR_ID, livePe],
      [KARMA_POLICE_MONITOR_ID, liveKp.result],
    ] as const) {
      const liveSummary = live.predictions.map((p) => `${p.claim_id}:${p.classification}`);
      const committedSummary = committed.monitors[id]!.result.predictions.map(
        (p) => `${p.claim_id}:${p.classification}`
      );
      assertEqual(
        liveSummary,
        committedSummary,
        `Live monitor parity on ${ep.episode_id} for ${id}`
      );
    }
  }

  console.log("==========================================================================");
  console.log(" KARMA POLICE H3 — REPRODUCIBILITY & ARTIFACT AUDIT PASSED");
  console.log("==========================================================================");
  console.log(` 1. Detector Freeze Zero-Diff Verified: ${FROZEN_DETECTOR_SHA}`);
  console.log(` 2. Post-Freeze H2 Manifest & 16 Prediction SHA-256 Hashes Verified`);
  console.log(`    - Per-Agent:     Acc ${pa.exact}/${pa.total}, Contra Rec ${pa.trueCon}/${pa.goldCon}, False Sup ${pa.falseSupport}/${pa.nonSupportedGold}`);
  console.log(`    - Pooled-Event:  Acc ${pe.exact}/${pe.total}, Contra Rec ${pe.trueCon}/${pe.goldCon}, False Sup ${pe.falseSupport}/${pe.nonSupportedGold}`);
  console.log(`    - Karma Police:  Acc ${kp.exact}/${kp.total}, Contra Rec ${kp.trueCon}/${kp.goldCon}, Contra Prec ${kp.trueCon}/${kp.predCon}, False Sup ${kp.falseSupport}/${kp.nonSupportedGold}`);
  console.log(`    - Coverage:      ${kp.covered}/${kp.total} (3 missing under STRUCTURE_ONLY in h2-inv-08)`);
  console.log(`    - Anomalies:     ${totalProvenanceAnomalies} across ${casesWithAnomalies}/16 scenarios`);
  console.log(` 3. Live Re-Execution Parity on External MAF (${PINNED_MAF_SHA.slice(0, 10)}) Verified`);
  console.log("==========================================================================");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
