/**
 * Allowlisted detector access.
 *
 * Future SwarmGuard implementations and the frozen baselines must load evidence
 * only through this module. It cannot see evaluator storage, oracle files, or
 * ground-truth records.
 *
 * Trust boundary: detector-visible data is the canonical RunArtifact plus
 * exportRunEvidenceBundle view under the detector storage root. Private labels
 * live in a sibling evaluator root that this module refuses to read.
 */

import { readFile } from "node:fs/promises";
import { basename, join, normalize, relative, resolve, sep } from "node:path";
import { exportRunEvidenceBundle, type RunEvidenceBundle } from "../../../lib/core/evidence/exportBundle";
import { runArtifactSchema, type RunArtifact } from "../../../lib/core/contracts/runArtifact";
import { assertIsolated } from "./leakcheck";

export const DETECTOR_DIR_NAME = "detector";
export const EVALUATOR_DIR_NAME = "evaluator";

export const DETECTOR_ALLOWED_FILES = [
  "artifact.json",
  "evidence-bundle.json",
  "run-record.json",
] as const;

export class DetectorAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DetectorAccessError";
  }
}

export interface DetectorRunRecord {
  format: "reeprov.swarmguard_testbed.run_record.v1";
  case_id?: string;
  run_id: string;
  domain_id: string;
  scenario_id: string;
  content_variant?: string;
  execution_mode: string;
  requested_mode: string;
  live_blocked?: string;
  model_provider?: string;
  model_name?: string;
  commit_sha?: string;
  status: string;
  participating_agent_ids: string[];
  artifact_paths: {
    artifact: string;
    bundle: string;
  };
  timing?: { duration_ms?: number };
  cost?: { usd?: number; tokens?: number };
  exit_status: string;
}

export interface DetectorEvidence {
  artifact: RunArtifact;
  bundle: RunEvidenceBundle;
  run_record?: DetectorRunRecord;
  detector_dir: string;
}

function assertAllowedDetectorPath(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel.startsWith("..") || rel.includes(`..${sep}`) || normalize(rel).startsWith("..")) {
    throw new DetectorAccessError(`Detector path escapes detector root: ${candidate}`);
  }
  if (rel.split(sep).includes(EVALUATOR_DIR_NAME)) {
    throw new DetectorAccessError("Detector interface cannot traverse into evaluator storage.");
  }
  const base = basename(resolvedCandidate);
  if (
    base.startsWith("oracles.") ||
    base === "ground-truth.json" ||
    base.includes("sealed")
  ) {
    throw new DetectorAccessError(`Detector interface cannot read evaluator label file: ${base}`);
  }
  if (!(DETECTOR_ALLOWED_FILES as readonly string[]).includes(base)) {
    throw new DetectorAccessError(
      `Detector interface may only read ${DETECTOR_ALLOWED_FILES.join(", ")}. Refused: ${base}`
    );
  }
  return resolvedCandidate;
}

export function detectorRoot(outputDir: string): string {
  return join(outputDir, DETECTOR_DIR_NAME);
}

export function evaluatorRoot(outputDir: string): string {
  return join(outputDir, EVALUATOR_DIR_NAME);
}

export async function loadDetectorEvidence(detectorDir: string): Promise<DetectorEvidence> {
  const resolvedDir = resolve(detectorDir);
  if (resolvedDir.split(sep).includes(EVALUATOR_DIR_NAME)) {
    throw new DetectorAccessError("Detector interface cannot read evaluator storage.");
  }
  const artifactPath = assertAllowedDetectorPath(detectorDir, join(detectorDir, "artifact.json"));
  const bundlePath = assertAllowedDetectorPath(detectorDir, join(detectorDir, "evidence-bundle.json"));
  const artifact = runArtifactSchema.parse(JSON.parse(await readFile(artifactPath, "utf8")));
  const bundle = JSON.parse(await readFile(bundlePath, "utf8")) as RunEvidenceBundle;
  let run_record: DetectorRunRecord | undefined;
  try {
    const recordPath = assertAllowedDetectorPath(detectorDir, join(detectorDir, "run-record.json"));
    run_record = JSON.parse(await readFile(recordPath, "utf8")) as DetectorRunRecord;
  } catch (error) {
    if (error instanceof DetectorAccessError) throw error;
  }

  const isolation = assertIsolated(artifact);
  if (!isolation.isolated) {
    throw new DetectorAccessError(`Detector artifact failed isolation: ${isolation.leaks.join("; ")}`);
  }
  const bundleIsolation = assertIsolated(bundle);
  if (!bundleIsolation.isolated) {
    throw new DetectorAccessError(`Detector bundle failed isolation: ${bundleIsolation.leaks.join("; ")}`);
  }
  if (run_record) {
    const recordIsolation = assertIsolated(run_record);
    if (!recordIsolation.isolated) {
      throw new DetectorAccessError(`Detector run-record failed isolation: ${recordIsolation.leaks.join("; ")}`);
    }
  }

  return { artifact, bundle: bundle.format ? bundle : exportRunEvidenceBundle(artifact), run_record, detector_dir: detectorDir };
}

export function createDetectorAccess(outputDir: string) {
  const root = detectorRoot(outputDir);
  return {
    root,
    async loadRun(runId: string): Promise<DetectorEvidence> {
      if (runId.includes("..") || runId.includes(sep) || runId.includes("/") || runId.includes("\\")) {
        throw new DetectorAccessError("Run id must be a single path segment.");
      }
      return loadDetectorEvidence(join(root, runId));
    },
    async readAllowedFile(runId: string, fileName: string): Promise<string> {
      if (runId.includes("..") || runId.includes(sep)) {
        throw new DetectorAccessError("Run id must be a single path segment.");
      }
      const dir = join(root, runId);
      const path = assertAllowedDetectorPath(dir, join(dir, fileName));
      return readFile(path, "utf8");
    },
  };
}
