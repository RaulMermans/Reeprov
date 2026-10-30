/**
 * CLI for the SwarmGuard research testbed.
 *
 *   npx tsx research/swarmguard-testbed/scripts/run.ts --domain se --mode offline_fixture
 *   npx tsx research/swarmguard-testbed/scripts/run.ts list
 *   npx tsx research/swarmguard-testbed/scripts/run.ts run --case se-d01
 *   npx tsx research/swarmguard-testbed/scripts/run.ts experiment --partition development
 *   npx tsx research/swarmguard-testbed/scripts/run.ts freeze
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDomain } from "../src/index";
import { runExperiment } from "../src/harness";
import { NO_INJECTION, injectionPlanSchema, type InjectionPlan } from "../src/contracts";
import { classifyRecordedInvocations } from "../src/modes";
import {
  listScenarios,
  runAndEvaluate,
  validateArtifactSchema,
} from "../src/experiment";
import {
  BENCHMARK_VERSION,
  PREVIOUS_BENCHMARK_VERSION,
  listBenchmarkCases,
  oracleManifest,
  publicManifest,
  sha256Json,
  type Partition,
} from "../src/benchmark";
import { FROZEN_BASELINES } from "../src/baselines";
import { EVALUATION_FORMAT, EVALUATION_FORMAT_V1 } from "../src/evaluate";
import { HELDOUT_ALLOW_ENV } from "../src/heldoutAccess";

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

const command = process.argv[2]?.startsWith("--") ? "legacy" : (process.argv[2] ?? "legacy");
const ROOT = dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = join(ROOT, "..", "benchmark");
const defaultOutput = join(process.cwd(), "research/swarmguard-testbed/.output");

async function freezeManifests(): Promise<void> {
  await mkdir(BENCH_DIR, { recursive: true });
  const publicFile = publicManifest();
  const developmentOracles = oracleManifest("development");
  const heldOutOracles = oracleManifest("held_out");
  await writeFile(join(BENCH_DIR, "manifest.v1.json"), JSON.stringify(publicFile, null, 2) + "\n");
  await writeFile(
    join(BENCH_DIR, "oracles.development.v1.json"),
    JSON.stringify(developmentOracles, null, 2) + "\n"
  );
  await writeFile(join(BENCH_DIR, "oracles.heldout.v1.json"), JSON.stringify(heldOutOracles, null, 2) + "\n");
  const protocol = {
    format: "reeprov.swarmguard_testbed.protocol_hashes.v1",
    current_benchmark_version: BENCHMARK_VERSION,
    previous_benchmark_version: PREVIOUS_BENCHMARK_VERSION,
    evaluation_format: EVALUATION_FORMAT,
    previous_evaluation_format: EVALUATION_FORMAT_V1,
    published_v1_commit: "3912ffe82e1128a7ca6b3e83b4cc9f10c4fe92ba",
    v1_hashes: {
      public_manifest: "8d7b4bd145871085fc1adeb2f0211fbd01acf29a6ec0d7754bc6d28e7e2529ba",
      development_oracles: "6741c225d0c7504cdf2ba0ba8cd4bd515c030447e224680fff9aa04d91faf673",
      held_out_oracles: "5584709c968170c8fc72045c925e664f813cc301e314d2e33bdd0e6e8be10d83",
    },
    v1_1_hashes: {
      public_manifest: publicFile.integrity_hash,
      development_oracles: developmentOracles.integrity_hash,
      held_out_oracles: heldOutOracles.integrity_hash,
    },
    held_out_blindness:
      "p3.benchmark.v1 held-out labels were published in PR #27. Genuine H1 blindness is not established for those 16 cases. Use independently sealed packs for new private evaluation.",
    integrity_hash: "",
  };
  protocol.integrity_hash = sha256Json({ ...protocol, integrity_hash: undefined });
  await writeFile(join(BENCH_DIR, "protocol-hashes.v1.json"), JSON.stringify(protocol, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        frozen: true,
        public_hash: publicFile.integrity_hash,
        development_oracle_hash: developmentOracles.integrity_hash,
        held_out_oracle_hash: heldOutOracles.integrity_hash,
        protocol_hash: protocol.integrity_hash,
        paths: {
          manifest: join(BENCH_DIR, "manifest.v1.json"),
          development_oracles: join(BENCH_DIR, "oracles.development.v1.json"),
          held_out_oracles: join(BENCH_DIR, "oracles.heldout.v1.json"),
          protocol_hashes: join(BENCH_DIR, "protocol-hashes.v1.json"),
        },
      },
      null,
      2
    )
  );
}

if (command === "list") {
  const partition = arg("--partition") as Partition | undefined;
  console.log(JSON.stringify({ cases: await listScenarios(partition), baselines: FROZEN_BASELINES }, null, 2));
  process.exit(0);
}

if (command === "freeze") {
  await freezeManifests();
  process.exit(0);
}

if (command === "validate") {
  const outputDir = arg("--output") ?? defaultOutput;
  const spec = listBenchmarkCases("development")[0]!;
  const { result } = await runAndEvaluate({ caseId: spec.case_id, outputDir, persist: true });
  const schema = validateArtifactSchema(result);
  console.log(JSON.stringify({ case_id: spec.case_id, schema, validity: result.ground_truth.experimental_validity }, null, 2));
  process.exit(schema.ok ? 0 : 1);
}

if (command === "run" || command === "baselines" || command === "score" || command === "experiment") {
  const outputDir = arg("--output") ?? defaultOutput;
  const mode = arg("--mode") ?? "offline_fixture";
  const partition = (arg("--partition") as Partition | undefined) ?? (arg("--case") ? undefined : "development");
  if (partition === "held_out" && process.env[HELDOUT_ALLOW_ENV] !== "1") {
    console.error(
      `Held-out scoring requires ${HELDOUT_ALLOW_ENV}=1. Default experiment partition is development. In-tree held-out labels are public (PR #27) and are not a blind test.`
    );
    process.exit(2);
  }
  const caseId = arg("--case");
  const caseIds = caseId
    ? [caseId]
    : listBenchmarkCases(partition).map((item) => item.case_id);
  const reports = [];
  for (const id of caseIds) {
    const executed = await runAndEvaluate({ caseId: id, mode, outputDir, persist: true });
    reports.push({
      case_id: id,
      run_id: executed.result.run_id,
      domain_id: executed.result.domain_id,
      execution_mode: executed.result.execution_mode,
      status: executed.result.status,
      validity: executed.result.ground_truth.experimental_validity,
      schema_ok: validateArtifactSchema(executed.result).ok,
      baselines: executed.predictions.map((prediction) => prediction.monitor_id),
      evaluations: executed.evaluations.map((evaluation) => ({
        monitor_id: evaluation.monitor_id,
        accuracy: evaluation.classification.accuracy.value,
        contradiction_recall: evaluation.classification.contradiction_recall.value,
      })),
      export: executed.result.persisted?.summary.detector_dir,
    });
  }
  console.log(JSON.stringify({ command, reports }, null, 2));
  process.exit(0);
}

const domainId = arg("--domain") ?? "se";
const mode = arg("--mode") ?? "offline_fixture";
const inject = arg("--inject");
const seed = arg("--seed") ?? "cli";
const outputDir = arg("--output") ?? defaultOutput;

let injection: InjectionPlan = NO_INJECTION;
if (inject) {
  injection = injectionPlanSchema.parse({
    enabled: true,
    type: inject,
    target_agent_id: arg("--target-agent"),
    expected_observable_violation: arg("--expected"),
    config: {
      ...(arg("--foreign-run") ? { foreign_run_id: arg("--foreign-run") } : {}),
      ...(arg("--claim") ? { claim: arg("--claim") } : {}),
      ...(arg("--field") ? { field: arg("--field") } : {}),
      ...(arg("--value") ? { value: arg("--value") } : {}),
    },
  });
}

const domain = getDomain(domainId);
const result = await runExperiment(domain, {
  mode,
  injection,
  seed,
  outputDir,
  persist: true,
});

const recordedMode = classifyRecordedInvocations(result.artifact.models);
const liveProven =
  result.requested_mode === "live_llm" &&
  result.execution_mode === "live_llm" &&
  recordedMode === "live_llm" &&
  result.artifact.models.every((model) => model.metadata?.["provider_http_completed"] === true);

const report = {
  domain: result.domain_id,
  scenario_id: result.scenario_id,
  run_id: result.run_id,
  requested_mode: result.requested_mode,
  execution_mode: result.execution_mode,
  recorded_invocation_mode: recordedMode,
  live_llm_proven: liveProven,
  live_blocked: result.live_blocked,
  status: result.status,
  participating_agent_ids: result.participating_agent_ids,
  handoffs: (result.artifact.handoffs ?? []).map((handoff) => ({
    from: handoff.from_agent_id,
    to: handoff.to_agent_id,
    attribution: handoff.attribution_status,
    payload_capture_status: handoff.payload_capture_status,
  })),
  model_calls: result.artifact.models.map((model) => ({
    agent_id: model.agent_id,
    provider: model.provider,
    model: model.model_name,
    execution_mode: model.metadata?.["execution_mode"],
    provider_http_completed: model.metadata?.["provider_http_completed"] === true,
    tokens: model.total_tokens,
    cost_usd: model.cost_usd,
  })),
  tools: result.artifact.tools.map((tool) => ({
    agent_id: tool.agent_id,
    tool_name: tool.tool_name,
    status: tool.status,
  })),
  experimental_validity: result.ground_truth.experimental_validity,
  injection_count: result.ground_truth.injections.length,
  export: result.persisted?.summary.detector_dir,
  evaluator: result.persisted?.summary.evaluator_dir,
  errors: result.errors,
};

console.log(JSON.stringify(report, null, 2));

if (hasFlag("--require-live") || result.requested_mode === "live_llm") {
  if (!liveProven) {
    console.error(
      result.live_blocked ??
        "live_llm was requested but provider HTTP completion was not proven. Offline fixtures are not live execution."
    );
    process.exit(2);
  }
}
