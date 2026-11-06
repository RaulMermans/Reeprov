/**
 * CLI Runner for KARMA POLICE — Cross-Agent Evidence Verification Engine.
 *
 * Runs Karma Police on benchmark cases (default: development partition),
 * generates predictions and companion diagnostic findings,
 * evaluates diagnostic performance against the frozen baselines,
 * and exports reproducible artifacts.
 *
 * Usage:
 *   npx tsx research/swarmguard-testbed/scripts/run-karma-police.ts
 *   npx tsx research/swarmguard-testbed/scripts/run-karma-police.ts --case se-d01
 *   npx tsx research/swarmguard-testbed/scripts/run-karma-police.ts --partition development
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmarkCase } from "../src/experiment";
import { listBenchmarkCases, type Partition } from "../src/benchmark";
import { runKarmaPoliceWithFindings } from "../src/karmaPolice";
import { runPerAgentMonitor, runPooledEventMonitor } from "../src/baselines";
import { evaluateMonitor, evaluationToRow } from "../src/evaluate";
import { commitSha } from "../src/gitmeta";
import { HELDOUT_ALLOW_ENV } from "../src/heldoutAccess";

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const ROOT = dirname(fileURLToPath(import.meta.url));
const defaultOutput = join(process.cwd(), "research/swarmguard-testbed/.output");

if (!process.env["REEPROV_STORE_DIR"]) {
  process.env["REEPROV_STORE_DIR"] = join(defaultOutput, ".reeprov-store");
}
process.env["REEPROV_P3_DETECTOR_ROLE"] = "1";

async function main() {
  const outputDir = arg("--output") ?? defaultOutput;
  const mode = arg("--mode") ?? "offline_fixture";
  const caseId = arg("--case");
  const partition = (arg("--partition") as Partition | undefined) ?? (caseId ? undefined : "development");

  if (partition === "held_out" && process.env[HELDOUT_ALLOW_ENV] !== "1") {
    console.error(
      `Held-out scoring requires ${HELDOUT_ALLOW_ENV}=1. Default experiment partition is development. In-tree held-out labels are public (PR #27) and are not a blind test.`
    );
    process.exit(2);
  }

  const caseIds = caseId ? [caseId] : listBenchmarkCases(partition).map((c) => c.case_id);

  console.log("================================================================================");
  console.log(" KARMA POLICE — Cross-Agent Evidence Verification Engine (H1 Sprint)");
  console.log(" Partition: " + (partition ?? caseId ?? "development") + " (Development-set diagnostic evaluation)");
  console.log("================================================================================");

  const summaryRows = [];

  for (const id of caseIds) {
    const executed = await runBenchmarkCase({
      caseId: id,
      mode,
      outputDir,
      persist: true,
    });

    const { result: kpResult, findings: kpFindings } = runKarmaPoliceWithFindings(
      executed.artifact,
      { caseId: id, domainId: executed.domain_id }
    );

    const paResult = runPerAgentMonitor(executed.artifact, {
      caseId: id,
      domainId: executed.domain_id,
    });
    const peResult = runPooledEventMonitor(executed.artifact, {
      caseId: id,
      domainId: executed.domain_id,
    });

    const kpEval = evaluateMonitor({ prediction: kpResult, groundTruth: executed.ground_truth });
    const paEval = evaluateMonitor({ prediction: paResult, groundTruth: executed.ground_truth });
    const peEval = evaluateMonitor({ prediction: peResult, groundTruth: executed.ground_truth });

    const resultsDir = join(outputDir, "results", executed.run_id, "karma_police");
    await mkdir(resultsDir, { recursive: true });

    await writeFile(
      join(resultsDir, "reproducibility.json"),
      JSON.stringify(
        {
          format: "reeprov.swarmguard_testbed.reproducibility.v1",
          monitor_id: kpResult.monitor_id,
          monitor_version: kpResult.monitor_version,
          case_id: id,
          run_id: executed.run_id,
          domain_id: executed.domain_id,
          execution_mode: executed.execution_mode,
          commit_sha: commitSha(),
          evaluated_at: new Date().toISOString(),
          non_blind_diagnostic_partition: executed.ground_truth.case_id?.includes("-d"),
        },
        null,
        2
      )
    );

    await writeFile(join(resultsDir, "predictions.json"), JSON.stringify(kpResult, null, 2));
    await writeFile(join(resultsDir, "findings.json"), JSON.stringify(kpFindings, null, 2));
    await writeFile(join(resultsDir, "evaluation.json"), JSON.stringify(kpEval, null, 2));
    await writeFile(
      join(resultsDir, "metrics-table.json"),
      JSON.stringify([evaluationToRow(kpEval), evaluationToRow(paEval), evaluationToRow(peEval)], null, 2)
    );

    summaryRows.push({
      case_id: id,
      domain: executed.domain_id,
      claims: executed.ground_truth.oracle_labels.length,
      kp_acc: kpEval.classification.accuracy.value,
      kp_rec: kpEval.classification.contradiction_recall.value,
      pa_acc: paEval.classification.accuracy.value,
      pa_rec: paEval.classification.contradiction_recall.value,
      pe_acc: peEval.classification.accuracy.value,
      pe_rec: peEval.classification.contradiction_recall.value,
      anomalies: kpFindings.summary.provenance_anomalies_detected,
    });
  }

  console.table(summaryRows);
  console.log("\nNOTE: Results reflect development-set diagnostic performance, not independent held-out evidence.");
  console.log("Exports saved under: " + join(outputDir, "results"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
