import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getCanonicalRun } from "../../../lib/core/capture/persistence";
import { exportRunEvidenceBundle, type RunEvidenceBundle } from "../../../lib/core/evidence/exportBundle";
import { runArtifactSchema, type RunArtifact } from "../../../lib/core/contracts/runArtifact";
import { assertIsolated, type GroundTruthRecord } from "./isolation";
import type { ExecutionMode, ExecutionStatus } from "./contracts";
import {
  DETECTOR_DIR_NAME,
  EVALUATOR_DIR_NAME,
  type DetectorRunRecord,
  loadDetectorEvidence,
} from "./detector";

export interface ExperimentalRunSummary {
  run_id: string;
  domain_id: string;
  scenario_id: string;
  case_id?: string;
  content_variant?: string;
  execution_mode: ExecutionMode;
  requested_mode: ExecutionMode;
  live_blocked?: string;
  status: ExecutionStatus;
  participating_agent_ids: string[];
  detector_dir: string;
  evaluator_dir: string;
  /** @deprecated Use detector_dir. Kept so older operator scripts keep working. */
  artifact_dir: string;
  commit_sha?: string;
  exit_status: string;
}

export interface PersistedExperimentalRun {
  summary: ExperimentalRunSummary;
  artifact: RunArtifact;
  bundle: RunEvidenceBundle;
  ground_truth: GroundTruthRecord;
}

export async function persistExperimentalRun(input: {
  outputDir: string;
  artifact: RunArtifact;
  groundTruth: GroundTruthRecord;
  summary: Omit<
    ExperimentalRunSummary,
    "artifact_dir" | "detector_dir" | "evaluator_dir" | "exit_status"
  > & { exit_status?: string; cost_usd?: number; tokens?: number; duration_ms?: number };
}): Promise<PersistedExperimentalRun> {
  const isolation = assertIsolated(input.artifact);
  if (!isolation.isolated) {
    throw new Error(`Ground-truth leaked into detector-visible artifact: ${isolation.leaks.join("; ")}`);
  }
  const bundle = exportRunEvidenceBundle(input.artifact);
  const bundleIsolation = assertIsolated(bundle);
  if (!bundleIsolation.isolated) {
    throw new Error(`Ground-truth leaked into evidence bundle: ${bundleIsolation.leaks.join("; ")}`);
  }

  const detectorDir = join(input.outputDir, DETECTOR_DIR_NAME, input.artifact.identity.run_id);
  const evaluatorDir = join(input.outputDir, EVALUATOR_DIR_NAME, input.artifact.identity.run_id);
  await mkdir(detectorDir, { recursive: true });
  await mkdir(evaluatorDir, { recursive: true });

  const exitStatus = input.summary.exit_status ?? input.summary.status;
  const runRecord: DetectorRunRecord = {
    format: "reeprov.swarmguard_testbed.run_record.v1",
    case_id: input.summary.case_id,
    run_id: input.summary.run_id,
    domain_id: input.summary.domain_id,
    scenario_id: input.summary.scenario_id,
    content_variant: input.summary.content_variant,
    execution_mode: input.summary.execution_mode,
    requested_mode: input.summary.requested_mode,
    live_blocked: input.summary.live_blocked,
    commit_sha: input.summary.commit_sha,
    status: input.summary.status,
    participating_agent_ids: input.summary.participating_agent_ids,
    artifact_paths: {
      artifact: join(detectorDir, "artifact.json"),
      bundle: join(detectorDir, "evidence-bundle.json"),
    },
    timing: input.summary.duration_ms !== undefined ? { duration_ms: input.summary.duration_ms } : undefined,
    cost:
      input.summary.cost_usd !== undefined || input.summary.tokens !== undefined
        ? { usd: input.summary.cost_usd, tokens: input.summary.tokens }
        : undefined,
    exit_status: exitStatus,
  };
  const recordIsolation = assertIsolated(runRecord);
  if (!recordIsolation.isolated) {
    throw new Error(`Ground-truth leaked into detector run-record: ${recordIsolation.leaks.join("; ")}`);
  }

  await writeFile(join(detectorDir, "artifact.json"), JSON.stringify(input.artifact, null, 2));
  await writeFile(join(detectorDir, "evidence-bundle.json"), JSON.stringify(bundle, null, 2));
  await writeFile(join(detectorDir, "run-record.json"), JSON.stringify(runRecord, null, 2));
  await writeFile(join(evaluatorDir, "ground-truth.json"), JSON.stringify(input.groundTruth, null, 2));

  const summary: ExperimentalRunSummary = {
    run_id: input.summary.run_id,
    domain_id: input.summary.domain_id,
    scenario_id: input.summary.scenario_id,
    case_id: input.summary.case_id,
    content_variant: input.summary.content_variant,
    execution_mode: input.summary.execution_mode,
    requested_mode: input.summary.requested_mode,
    live_blocked: input.summary.live_blocked,
    status: input.summary.status,
    participating_agent_ids: input.summary.participating_agent_ids,
    detector_dir: detectorDir,
    evaluator_dir: evaluatorDir,
    artifact_dir: detectorDir,
    commit_sha: input.summary.commit_sha,
    exit_status: exitStatus,
  };
  await writeFile(join(evaluatorDir, "summary.json"), JSON.stringify(summary, null, 2));
  return { summary, artifact: input.artifact, bundle, ground_truth: input.groundTruth };
}

export async function loadEvaluatorRecord(evaluatorDir: string): Promise<GroundTruthRecord> {
  if (evaluatorDir.includes(`${DETECTOR_DIR_NAME}` ) && !evaluatorDir.includes(EVALUATOR_DIR_NAME)) {
    throw new Error("Evaluator records are not stored under the detector root.");
  }
  return JSON.parse(await readFile(join(evaluatorDir, "ground-truth.json"), "utf8")) as GroundTruthRecord;
}

export async function loadExperimentalRun(dir: string): Promise<PersistedExperimentalRun> {
  // Operator helper: prefers split roots, falls back to a detector dir + sibling evaluator dir.
  const looksLikeDetector = dir.includes(`${join(DETECTOR_DIR_NAME)}`) || dir.endsWith(DETECTOR_DIR_NAME);
  if (looksLikeDetector) {
    const detector = await loadDetectorEvidence(dir);
    const evaluatorDir = dir.replace(DETECTOR_DIR_NAME, EVALUATOR_DIR_NAME);
    const groundTruth = await loadEvaluatorRecord(evaluatorDir);
    const summary = JSON.parse(
      await readFile(join(evaluatorDir, "summary.json"), "utf8")
    ) as ExperimentalRunSummary;
    return {
      artifact: detector.artifact,
      bundle: detector.bundle,
      ground_truth: groundTruth,
      summary,
    };
  }

  const artifact = runArtifactSchema.parse(JSON.parse(await readFile(join(dir, "artifact.json"), "utf8")));
  const bundle = JSON.parse(await readFile(join(dir, "evidence-bundle.json"), "utf8")) as RunEvidenceBundle;
  const groundTruth = JSON.parse(await readFile(join(dir, "ground-truth.json"), "utf8")) as GroundTruthRecord;
  const summary = JSON.parse(await readFile(join(dir, "summary.json"), "utf8")) as ExperimentalRunSummary;
  return { artifact, bundle, ground_truth: groundTruth, summary };
}

export async function reloadCanonicalArtifact(runId: string): Promise<RunArtifact | null> {
  return getCanonicalRun(runId);
}
