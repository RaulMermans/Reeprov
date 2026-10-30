import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getCanonicalRun } from "../../../lib/core/capture/persistence";
import { exportRunEvidenceBundle, type RunEvidenceBundle } from "../../../lib/core/evidence/exportBundle";
import { runArtifactSchema, type RunArtifact } from "../../../lib/core/contracts/runArtifact";
import { assertIsolated, type GroundTruthRecord } from "./isolation";
import type { ExecutionMode, ExecutionStatus } from "./contracts";

export interface ExperimentalRunSummary {
  run_id: string;
  domain_id: string;
  scenario_id: string;
  execution_mode: ExecutionMode;
  requested_mode: ExecutionMode;
  live_blocked?: string;
  status: ExecutionStatus;
  participating_agent_ids: string[];
  control: boolean;
  artifact_dir: string;
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
  summary: Omit<ExperimentalRunSummary, "artifact_dir">;
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

  const dir = join(input.outputDir, input.artifact.identity.run_id);
  await mkdir(dir, { recursive: true });
  const summary: ExperimentalRunSummary = { ...input.summary, artifact_dir: dir };
  await writeFile(join(dir, "artifact.json"), JSON.stringify(input.artifact, null, 2));
  await writeFile(join(dir, "evidence-bundle.json"), JSON.stringify(bundle, null, 2));
  await writeFile(join(dir, "ground-truth.json"), JSON.stringify(input.groundTruth, null, 2));
  await writeFile(join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  return { summary, artifact: input.artifact, bundle, ground_truth: input.groundTruth };
}

export async function loadExperimentalRun(dir: string): Promise<PersistedExperimentalRun> {
  const artifact = runArtifactSchema.parse(JSON.parse(await readFile(join(dir, "artifact.json"), "utf8")));
  const bundle = JSON.parse(await readFile(join(dir, "evidence-bundle.json"), "utf8")) as RunEvidenceBundle;
  const groundTruth = JSON.parse(await readFile(join(dir, "ground-truth.json"), "utf8")) as GroundTruthRecord;
  const summary = JSON.parse(await readFile(join(dir, "summary.json"), "utf8")) as ExperimentalRunSummary;
  return { artifact, bundle, ground_truth: groundTruth, summary };
}

export async function reloadCanonicalArtifact(runId: string): Promise<RunArtifact | null> {
  return getCanonicalRun(runId);
}
