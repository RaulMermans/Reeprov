/**
 * Single documented experiment interface for Sprint P3.
 *
 * Lists cases, runs offline controls and injections, runs both baselines,
 * scores independently, exports results, and records reproducibility metadata.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeSha256 } from "../../../lib/core/capture/hashing";
import { runArtifactSchema } from "../../../lib/core/contracts/runArtifact";
import { exportRunEvidenceBundle } from "../../../lib/core/evidence/exportBundle";
import { FROZEN_BASELINES, runBaseline, type MonitorResult } from "./baselines";
import {
  BENCHMARK_VERSION,
  getBenchmarkCase,
  listBenchmarkCases,
  type BenchmarkCase,
  type Partition,
  type SealedWorkspaceConfig,
} from "./benchmark";
import { evaluateMonitor, evaluationToRow, type EvaluationReport } from "./evaluate";
import { investigationDomain } from "../domains/investigation";
import { softwareEngineeringDomain } from "../domains/softwareEngineering";
import { runExperiment, type ExperimentalRunResult, type HarnessOptions } from "./harness";
import type { DomainModule, DomainWorkspace } from "./domain";
import { commitSha } from "./gitmeta";
import { scenarioSchema, type ExecutionMode } from "./contracts";
import { assertCanLoadHeldOutOracles, SEALED_EVAL_ENV } from "./heldoutAccess";
import { loadSealedEvaluationPack } from "./sealed";

const DOMAINS: Record<string, DomainModule> = {
  "software-engineering": softwareEngineeringDomain,
  investigation: investigationDomain,
};

const DOMAIN_VARIANTS = new Set(["alt_gold", "incomplete", "sudo_focus"]);

export interface ExperimentRunOptions {
  caseId: string;
  mode?: ExecutionMode | string;
  outputDir: string;
  persist?: boolean;
  runId?: string;
}

export async function listScenarios(partition?: Partition) {
  return listBenchmarkCases(partition).map((item) => ({
    case_id: item.case_id,
    partition: item.partition,
    domain_id: item.domain_id,
    content_variant: item.content_variant,
    scenario_id: item.scenario_id,
    notes: `${item.domain_id} ${item.partition} case (${item.content_variant}).`,
  }));
}

export async function resolveBenchmarkCase(caseId: string): Promise<BenchmarkCase> {
  try {
    const spec = getBenchmarkCase(caseId);
    if (spec.partition === "held_out") {
      assertCanLoadHeldOutOracles(`in-tree case ${caseId}`);
    }
    return spec;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Unknown benchmark case")) throw error;
    if (!process.env[SEALED_EVAL_ENV]) throw error;
    const sealed = await loadSealedEvaluationPack();
    const found = sealed.cases.find((item) => item.case_id === caseId);
    if (!found) {
      throw new Error(
        `Unknown benchmark case "${caseId}". In-tree catalog and sealed pack do not contain it.`
      );
    }
    return found;
  }
}

function lookupCustomMapping(mapping: Record<string, string>, input: string): string | undefined {
  if (mapping[input] !== undefined) return mapping[input];
  const lower = input.trim().toLowerCase();
  if (mapping[lower] !== undefined) return mapping[lower];
  const stripped = lower.replace(/^[a-z0-9_-]+:\s*/i, "");
  return mapping[stripped] ?? mapping[input.trim()];
}

function buildDomainForCase(spec: BenchmarkCase, baseDomain: DomainModule): DomainModule {
  const cfg: SealedWorkspaceConfig | undefined = spec.workspaceConfig;
  if (!cfg) return baseDomain;

  if (spec.domain_id === "software-engineering") {
    interface CustomSeWorkspace extends DomainWorkspace {
      rootDir: string;
      goldCases: Array<{ input: string; expected: string }>;
    }
    return {
      ...baseDomain,
      buildScenario(seed = spec.seed, variant = spec.content_variant) {
        const base = baseDomain.buildScenario(seed, "default");
        return scenarioSchema.parse({
          ...base,
          id: spec.scenario_id || base.id,
          title: cfg.title ?? base.title,
          variant,
          seed,
          task: cfg.task ?? base.task,
        });
      },
      async createWorkspace(scenario) {
        if (!cfg.goldCases) {
          return baseDomain.createWorkspace(scenario);
        }
        const rootDir = await mkdtemp(join(tmpdir(), "reeprov-h2-se-"));
        return {
          kind: "software-engineering-custom",
          rootDir,
          goldCases: cfg.goldCases.map((g) => ({ ...g })),
          close: async () => {
            await rm(rootDir, { recursive: true, force: true });
          },
        } satisfies CustomSeWorkspace;
      },
      registerTools(registry, workspace) {
        if (!cfg.goldCases && !cfg.artifactFilePrefix) {
          baseDomain.registerTools(registry, workspace);
          return;
        }
        const customWs = workspace as CustomSeWorkspace & { rootDir: string; goldCases: Array<{ input: string; expected: string }> };
        const filePrefix = cfg.artifactFilePrefix ?? "artifact";

        registry.register({
          name: "write_artifact",
          description: "Write a versioned JSON artifact into the disposable workspace.",
          permissionClass: "write_draft",
          allowedAgentIds: ["coder"],
          execute: async (args, ctx) => {
            const version = String(args["version"] ?? "1");
            const name = String(args["name"] ?? filePrefix);
            const body = (args["body"] ?? args["artifact_body"] ?? {}) as Record<string, unknown>;
            const fileName = `${filePrefix}-v${version}.json`;
            const filePath = join(customWs.rootDir, fileName);
            const serialized = JSON.stringify({ name, version, body }, null, 2);
            await writeFile(filePath, serialized);
            const recorded = ctx.session.recordArtifact({
              name: fileName,
              type: "application/json",
              uri: filePath,
              sizeBytes: Buffer.byteLength(serialized),
              hash: computeSha256(serialized),
              metadata: { version, function_name: name },
              stepId: ctx.stepId,
            });
            ctx.shared.previousArtifactId = ctx.shared.currentArtifactId;
            ctx.shared.currentArtifactId = recorded.artifact_id;
            ctx.shared.artifactVersions.push({
              artifact_id: recorded.artifact_id,
              version,
              name,
              body,
            });
            ctx.shared.symbolic[`artifact:v${version}`] = recorded.artifact_id;
            ctx.shared.symbolic[`artifact:${name}:v${version}`] = recorded.artifact_id;
            ctx.shared.symbolic["artifact:current"] = recorded.artifact_id;
            return { artifact_id: recorded.artifact_id, version, path: fileName };
          },
        });

        registry.register({
          name: "read_workspace",
          description: "List workspace artifact versions and the current head.",
          permissionClass: "read_only",
          allowedAgentIds: ["coder", "reviewer", "release-decision"],
          execute: async (_args, ctx) => ({
            current_artifact_id: ctx.shared.currentArtifactId,
            versions: ctx.shared.artifactVersions.map((item) => ({
              artifact_id: item.artifact_id,
              version: item.version,
              name: item.name,
            })),
          }),
        });

        registry.register({
          name: "run_validation",
          description: "Run gold-case validation against a workspace artifact mapping. Does not execute model-authored code.",
          permissionClass: "read_only",
          allowedAgentIds: ["coder"],
          execute: async (args, ctx) => {
            const version = String(args["version"] ?? ctx.shared.artifactVersions.at(-1)?.version ?? "1");
            const filePath = join(customWs.rootDir, `${filePrefix}-v${version}.json`);
            const raw = JSON.parse(await readFile(filePath, "utf8")) as {
              name?: string;
              body?: { mapping?: Record<string, string> };
            };
            const mapping = raw.body?.mapping ?? {};
            const cases = customWs.goldCases.map((testCase) => {
              const actual = lookupCustomMapping(mapping, testCase.input);
              return {
                input: testCase.input,
                expected: testCase.expected,
                actual: actual ?? null,
                passed: actual === testCase.expected,
              };
            });
            const passed = cases.every((item) => item.passed);
            const targetName = raw.name ?? filePrefix;
            const verification = ctx.session.verification.startTest("gold-cases", targetName, {
              stepId: ctx.stepId,
            });
            const artifactId = ctx.shared.symbolic[`artifact:v${version}`];
            if (passed) verification.pass({ artifactRefs: artifactId ? [artifactId] : [] });
            else {
              verification.fail({
                failureMessage: "One or more gold cases failed.",
                artifactRefs: artifactId ? [artifactId] : [],
              });
            }
            return { passed, version, cases };
          },
        });
      },
    };
  }

  // Investigation custom workspace
  interface CustomInvWorkspace extends DomainWorkspace {
    records: Array<{
      id: string;
      kind: "system_log" | "witness" | "rumor";
      timestamp: string;
      body: string;
    }>;
  }
  return {
    ...baseDomain,
    buildScenario(seed = spec.seed, variant = spec.content_variant) {
      const base = baseDomain.buildScenario(seed, "default");
      return scenarioSchema.parse({
        ...base,
        id: spec.scenario_id || base.id,
        title: cfg.title ?? base.title,
        variant,
        seed,
        task: cfg.task ?? base.task,
      });
    },
    async createWorkspace(scenario) {
      if (!cfg.records) {
        return baseDomain.createWorkspace(scenario);
      }
      return {
        kind: "investigation-custom",
        records: cfg.records.map((r) => ({ ...r })),
      } satisfies CustomInvWorkspace;
    },
    async seedEvidence(session, workspace, shared) {
      if (!cfg.records && !cfg.caseFilePrefix) {
        if (baseDomain.seedEvidence) {
          await baseDomain.seedEvidence(session, workspace, shared);
        }
        return;
      }
      const records = (workspace as CustomInvWorkspace).records;
      for (const record of records) {
        const artifact = session.recordArtifact({
          name: record.id,
          type: `incident_record/${record.kind}`,
          metadata: { kind: record.kind, timestamp: record.timestamp },
        });
        shared.symbolic[`record:${record.id}`] = artifact.artifact_id;
        shared.artifactVersions.push({
          artifact_id: artifact.artifact_id,
          version: record.id,
          name: record.id,
          body: record,
        });
      }
      const prefix = cfg.caseFilePrefix ?? "case-dossier";
      const v1 = session.recordArtifact({
        name: `${prefix}-v1`,
        type: "application/json",
        metadata: { version: "1", kind: "case_file" },
      });
      const v2 = session.recordArtifact({
        name: `${prefix}-v2`,
        type: "application/json",
        metadata: { version: "2", kind: "case_file" },
      });
      shared.previousArtifactId = v1.artifact_id;
      shared.currentArtifactId = v2.artifact_id;
      shared.symbolic["artifact:v1"] = v1.artifact_id;
      shared.symbolic["artifact:v2"] = v2.artifact_id;
      shared.symbolic["artifact:current"] = v2.artifact_id;
      shared.artifactVersions.push(
        { artifact_id: v1.artifact_id, version: "1", name: `${prefix}-v1`, body: { records: records.map((r) => r.id) } },
        { artifact_id: v2.artifact_id, version: "2", name: `${prefix}-v2`, body: { records: records.map((r) => r.id), compiled: true } }
      );
    },
  };
}

export async function runBenchmarkCase(options: ExperimentRunOptions): Promise<ExperimentalRunResult> {
  const spec = await resolveBenchmarkCase(options.caseId);
  const baseDomain = DOMAINS[spec.domain_id];
  if (!baseDomain) throw new Error(`Unknown domain ${spec.domain_id}`);
  const domain = buildDomainForCase(spec, baseDomain);
  const variant = DOMAIN_VARIANTS.has(spec.content_variant) ? spec.content_variant : "default";
  const harness: HarnessOptions = {
    mode: options.mode ?? "offline_fixture",
    injection: spec.injection,
    seed: spec.seed,
    variant: spec.workspaceConfig ? spec.content_variant : variant,
    caseId: spec.case_id,
    mockTurns: spec.fixtureTurns,
    persist: options.persist ?? true,
    outputDir: options.outputDir,
    runId: options.runId,
    oracleTemplates: spec.oracle,
    capturePolicy: spec.workspaceConfig?.capturePolicy,
  };
  return runExperiment(domain, harness);
}

export function runBaselinesOnArtifact(
  result: ExperimentalRunResult,
  caseId?: string
): MonitorResult[] {
  const detectorArtifact = result.artifact;
  return FROZEN_BASELINES.map((id) =>
    runBaseline(id, detectorArtifact, { caseId: caseId ?? result.ground_truth.case_id, domainId: result.domain_id })
  );
}

export function scorePredictions(
  predictions: MonitorResult[],
  result: ExperimentalRunResult
): EvaluationReport[] {
  return predictions.map((prediction) =>
    evaluateMonitor({
      prediction,
      groundTruth: result.ground_truth,
      domainId: result.domain_id,
    })
  );
}

export async function exportExperimentBundle(input: {
  outputDir: string;
  result: ExperimentalRunResult;
  predictions: MonitorResult[];
  evaluations: EvaluationReport[];
}): Promise<{ dir: string }> {
  const dir = join(input.outputDir, "results", input.result.run_id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "reproducibility.json"),
    JSON.stringify(
      {
        format: "reeprov.swarmguard_testbed.reproducibility.v1",
        benchmark_version: BENCHMARK_VERSION,
        case_id: input.result.ground_truth.case_id,
        run_id: input.result.run_id,
        domain_id: input.result.domain_id,
        execution_mode: input.result.execution_mode,
        requested_mode: input.result.requested_mode,
        commit_sha: commitSha(),
        scenario_id: input.result.scenario_id,
        status: input.result.status,
        live_blocked: input.result.live_blocked,
        artifact_paths: {
          detector: input.result.persisted?.summary.detector_dir,
          evaluator: input.result.persisted?.summary.evaluator_dir,
        },
        exit_status: input.result.status,
      },
      null,
      2
    )
  );
  await writeFile(join(dir, "predictions.json"), JSON.stringify(input.predictions, null, 2));
  await writeFile(join(dir, "evaluations.json"), JSON.stringify(input.evaluations, null, 2));
  await writeFile(
    join(dir, "metrics-table.json"),
    JSON.stringify(input.evaluations.map(evaluationToRow), null, 2)
  );
  return { dir };
}

export function validateArtifactSchema(result: ExperimentalRunResult): { ok: boolean; issues: string[] } {
  const parsed = runArtifactSchema.safeParse(result.artifact);
  const issues: string[] = [];
  if (!parsed.success) {
    issues.push(...parsed.error.issues.map((issue) => issue.message));
  }
  try {
    exportRunEvidenceBundle(result.artifact);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  return { ok: issues.length === 0, issues };
}

export async function runAndEvaluate(options: ExperimentRunOptions): Promise<{
  result: ExperimentalRunResult;
  predictions: MonitorResult[];
  evaluations: EvaluationReport[];
}> {
  const result = await runBenchmarkCase(options);
  const predictions = runBaselinesOnArtifact(result, options.caseId);
  const evaluations = scorePredictions(predictions, result);
  if (options.persist !== false) {
    await exportExperimentBundle({
      outputDir: options.outputDir,
      result,
      predictions,
      evaluations,
    });
  }
  return { result, predictions, evaluations };
}

