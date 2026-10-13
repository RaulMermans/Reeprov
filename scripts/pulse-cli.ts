/**
 * AgentPulse CLI — Replay & Fork Runtime Entry Point.
 *
 * Usage:
 *   pulse replay <run-id|file-path> [--strict] [--validate-only] [--from-start] [--json]
 *   pulse checkpoints <run-id|file-path> [--json]
 *   pulse fork <run-id|file-path> --checkpoint <checkpoint-id> [--mutations <file>] [--json]
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getCanonicalRun } from "../lib/core/capture/persistence";
import { runArtifactSchema, type RunArtifact } from "../lib/core/contracts/runArtifact";
import { buildReplayPlan } from "../lib/core/replay/planner";
import { ReplayRuntime } from "../lib/core/replay/runtime";
import type { ReplayMode } from "../lib/core/replay/contracts";
import { ForkRuntime } from "../lib/core/fork/runtime";
import type { ExperimentMutation } from "../lib/core/contracts/lineage";
import { computeEvidenceCompleteness, type EvidencePolicy } from "../lib/core/contracts/evidence";
import { diffConfiguration } from "../lib/core/contracts/configuration";
import { compareRuns, saveRunComparison } from "../lib/core/comparison";
import { comparisonPolicySchema, type ComparisonPolicy } from "../lib/core/contracts/comparison";
import { analyzeRunContext } from "../lib/core/intelligence/contextAnalyzer";
import { analyzeRunMemory } from "../lib/core/intelligence/memoryAnalyzer";
import {
  saveContextIntelligenceReport,
  saveMemoryIntelligenceReport,
} from "../lib/core/intelligence/persistence";
import {
  listEvalDefinitions,
  listEvalSuites,
  getEvalSuite,
  listEvalDatasets,
  listEvaluationRuns,
  saveEvaluationRun,
} from "../lib/core/evals/persistence";
import { evaluateRun } from "../lib/core/evals/runner";
import { evalSuiteSchema } from "../lib/core/contracts/evalDefinitions";
import {
  experimentDefinitionSchema,
  type ExperimentDefinition,
} from "../lib/core/contracts/experiment";
import { ExperimentPlanner } from "../lib/core/experiment/planner";
import { ExperimentRunner } from "../lib/core/experiment/runner";
import {
  getExperimentDefinition,
  getExperimentResult,
  listExperimentResults,
} from "../lib/core/experiment/persistence";
import { BaselineManager } from "../lib/core/regression/baseline";
import { RegressionGateEngine } from "../lib/core/regression/gate";
import {
  listRegressionBaselines,
  getRegressionBaseline,
  saveRegressionBaseline,
  BaselineManager,
  RegressionGateEngine,
  getRegressionGatePolicy,
  saveRegressionGatePolicy,
} from "../lib/core/regression";
import {
  regressionGatePolicySchema,
  type RegressionGatePolicy,
} from "../lib/core/contracts/regression";
import {
  listCapabilitySnapshots,
  getCapabilitySnapshot,
  CapabilityDriftEngine,
  CapabilitySnapshotEngine,
} from "../lib/core/capability";
import {
  PolicySnapshotEngine,
  PolicyDriftDetector,
  getPolicyBehaviorSnapshot,
} from "../lib/core/policyDrift";

export interface BaselineListCliOptions {
  command: "baseline-list";
  projectId?: string;
  json: boolean;
}

export interface BaselineSetCliOptions {
  command: "baseline-set";
  targetId: string;
  suiteId: string;
  datasetId?: string;
  agentId?: string;
  json: boolean;
}

export interface RegressionCheckCliOptions {
  command: "regression-check";
  candidateRunId: string;
  baselineId: string;
  policyIdOrPath?: string;
  json: boolean;
}

export interface CapabilityShowCliOptions {
  command: "capability-show";
  agentId: string;
  json: boolean;
}

export interface CapabilityDiffCliOptions {
  command: "capability-diff";
  versionA: string;
  versionB: string;
  agentId?: string;
  json: boolean;
}

export interface PolicyDriftCliOptions {
  command: "policy-drift";
  baselineRunId: string;
  candidateRunId: string;
  json: boolean;
}

export interface DiffCliOptions {
  command: "diff";
  runA: string;
  runB: string;
  semantic: boolean;
  json: boolean;
  policyPath?: string;
  firstDivergenceOnly: boolean;
}

export interface ReplayCliOptions {
  command: "replay";
  runIdOrPath: string;
  mode: ReplayMode;
  validateOnly: boolean;
  fromStart: boolean;
  json: boolean;
}

export interface CheckpointsCliOptions {
  command: "checkpoints";
  runIdOrPath: string;
  json: boolean;
}

export interface ForkCliOptions {
  command: "fork";
  runIdOrPath: string;
  checkpointId: string;
  mutationsPath?: string;
  json: boolean;
}

export interface ContextCliOptions {
  command: "context";
  runIdOrPath: string;
  stepId?: string;
  snapshotId?: string;
  signals: boolean;
  json: boolean;
}

export interface MemoryCliOptions {
  command: "memory";
  runIdOrPath: string;
  memoryId?: string;
  timeline: boolean;
  signals: boolean;
  json: boolean;
}

export interface AblateCliOptions {
  command: "ablate";
  runIdOrPath: string;
  checkpointId: string;
  contextItemId?: string;
  memoryId?: string;
  json: boolean;
}

export interface EvidenceCliOptions {
  command: "evidence";
  runIdOrPath: string;
  policyPath?: string;
  json: boolean;
}

export interface ConfigCliOptions {
  command: "config";
  runIdOrPath: string;
  json: boolean;
}

export interface ConfigDiffCliOptions {
  command: "config-diff";
  runA: string;
  runB: string;
  json: boolean;
}

export interface EvalListCliOptions {
  command: "eval-list";
  json: boolean;
}

export interface EvalRunCliOptions {
  command: "eval-run";
  runIdOrPath: string;
  suiteIdOrPath: string;
  json: boolean;
}

export interface DatasetListCliOptions {
  command: "dataset-list";
  json: boolean;
}

export interface ExperimentPlanCliOptions {
  command: "experiment-plan";
  definitionPathOrId: string;
  json: boolean;
}

export interface ExperimentRunCliOptions {
  command: "experiment-run";
  definitionPathOrId: string;
  json: boolean;
}

export interface ExperimentShowCliOptions {
  command: "experiment-show";
  experimentId: string;
  json: boolean;
}

export type CliCommandOptions =
  | ReplayCliOptions
  | CheckpointsCliOptions
  | ForkCliOptions
  | ContextCliOptions
  | MemoryCliOptions
  | AblateCliOptions
  | EvidenceCliOptions
  | ConfigCliOptions
  | ConfigDiffCliOptions
  | DiffCliOptions
  | EvalListCliOptions
  | EvalRunCliOptions
  | DatasetListCliOptions
  | ExperimentPlanCliOptions
  | ExperimentRunCliOptions
  | ExperimentShowCliOptions
  | BaselineListCliOptions
  | BaselineSetCliOptions
  | RegressionCheckCliOptions
  | CapabilityShowCliOptions
  | CapabilityDiffCliOptions
  | PolicyDriftCliOptions;

export function parseArgs(args: string[]): CliCommandOptions | null {
  // Baseline subcommands: pulse baseline list, pulse baseline set <run|release> --suite <suite> [--dataset <dataset>]
  if (args[0] === "baseline") {
    const json = args.includes("--json");
    if (args[1] === "list") {
      let projectId: string | undefined;
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--project" && args[i + 1]) {
          projectId = args[i + 1];
          i++;
        }
      }
      return { command: "baseline-list", projectId, json };
    }
    if (args[1] === "set" && args[2]) {
      const targetId = args[2];
      let suiteId = "";
      let datasetId: string | undefined;
      let agentId: string | undefined;
      for (let i = 3; i < args.length; i++) {
        if (args[i] === "--suite" && args[i + 1]) {
          suiteId = args[i + 1]!;
          i++;
        } else if (args[i] === "--dataset" && args[i + 1]) {
          datasetId = args[i + 1];
          i++;
        } else if (args[i] === "--agent" && args[i + 1]) {
          agentId = args[i + 1];
          i++;
        }
      }
      if (!suiteId) return null;
      return { command: "baseline-set", targetId, suiteId, datasetId, agentId, json };
    }
    return null;
  }

  // Baseline subcommands: pulse baseline list, pulse baseline set
  if (args[0] === "baseline" || args.includes("baseline-list") || args.includes("baseline-set")) {
    const json = args.includes("--json");
    if (args[1] === "list" || args.includes("baseline-list")) {
      const idx = args.indexOf("baseline-list");
      const proj = idx !== -1 ? args[idx + 1] : args[2];
      const projectId = proj && !proj.startsWith("--") ? proj : undefined;
      return { command: "baseline-list", projectId, json };
    }
    if (args[1] === "set" || args.includes("baseline-set")) {
      const idx = args.indexOf("baseline-set");
      const baseIdx = idx !== -1 ? idx : 1;
      const baselineId = args[baseIdx + 1];
      const projectId = args[baseIdx + 2];
      const evalSuiteId = args[baseIdx + 3];
      const datasetId = args[baseIdx + 4];
      if (!baselineId || !projectId || !evalSuiteId || !datasetId) return null;
      return { command: "baseline-set", baselineId, projectId, evalSuiteId, datasetId, json };
    }
    return null;
  }

  // Regression subcommands: pulse regression check <candidate> [baseline]
  if (args[0] === "regression" || args.includes("regression-check")) {
    const json = args.includes("--json");
    if (args[1] === "check" || args.includes("regression-check")) {
      const idx = args.indexOf("regression-check");
      const baseIdx = idx !== -1 ? idx : 1;
      const candidateRunId = args[baseIdx + 1];
      if (!candidateRunId) return null;
      const candidateBaseline = args[baseIdx + 2];
      const baselineId = candidateBaseline && !candidateBaseline.startsWith("--") ? candidateBaseline : undefined;
      return { command: "regression-check", candidateRunId, baselineId, json };
    }
    return null;
  }

  // Regression / gate subcommands: pulse regression check <candidate> --baseline <baseline> [--policy <policy>]
  // or alias: pulse gate <candidate> --baseline <baseline> [--policy <policy>]
  if ((args[0] === "regression" && args[1] === "check" && args[2]) || (args[0] === "gate" && args[1])) {
    const json = args.includes("--json");
    const isGate = args[0] === "gate";
    const candidateRunId = isGate ? args[1]! : args[2]!;
    let baselineId = "";
    let policyIdOrPath: string | undefined;
    const startIdx = isGate ? 2 : 3;
    for (let i = startIdx; i < args.length; i++) {
      if (args[i] === "--baseline" && args[i + 1]) {
        baselineId = args[i + 1]!;
        i++;
      } else if (args[i] === "--policy" && args[i + 1]) {
        policyIdOrPath = args[i + 1];
        i++;
      }
    }
    if (!baselineId) return null;
    return { command: "regression-check", candidateRunId, baselineId, policyIdOrPath, json };
  }

  // Capability subcommands: pulse capability show <agent>, pulse capability diff <vA> <vB> [--agent <agent>]
  if (args[0] === "capability") {
    const json = args.includes("--json");
    if (args[1] === "show" && args[2]) {
      return { command: "capability-show", agentId: args[2], json };
    }
    if (args[1] === "diff" && args[2] && args[3]) {
      const versionA = args[2];
      const versionB = args[3];
      let agentId: string | undefined;
      for (let i = 4; i < args.length; i++) {
        if (args[i] === "--agent" && args[i + 1]) {
          agentId = args[i + 1];
          i++;
        }
      }
      return { command: "capability-diff", versionA, versionB, agentId, json };
    }
    return null;
  }

  // Policy drift: pulse policy-drift <baseline> <candidate>
  if (args[0] === "policy-drift" && args[1] && args[2]) {
    const json = args.includes("--json");
    return { command: "policy-drift", baselineRunId: args[1], candidateRunId: args[2], json };
  }

  // Eval subcommands: pulse eval list, pulse eval run <run> --suite <suite>
  if (args[0] === "eval") {
    const json = args.includes("--json");
    if (args[1] === "list") {
      return { command: "eval-list", json };
    }
    if (args[1] === "run" && args[2]) {
      const runIdOrPath = args[2];
      let suiteIdOrPath = "";
      for (let i = 3; i < args.length; i++) {
        if (args[i] === "--suite" && args[i + 1]) {
          suiteIdOrPath = args[i + 1]!;
          i++;
        }
      }
      if (!suiteIdOrPath) return null;
      return { command: "eval-run", runIdOrPath, suiteIdOrPath, json };
    }
    return null;
  }

  // Dataset subcommands: pulse dataset list
  if (args[0] === "dataset") {
    const json = args.includes("--json");
    if (args[1] === "list") {
      return { command: "dataset-list", json };
    }
    return null;
  }

  // Experiment subcommands: pulse experiment plan <def>, pulse experiment run <def>, pulse experiment show <id>
  if (args[0] === "experiment") {
    const json = args.includes("--json");
    if (args[1] === "plan" && args[2]) {
      return { command: "experiment-plan", definitionPathOrId: args[2], json };
    }
    if (args[1] === "run" && args[2]) {
      return { command: "experiment-run", definitionPathOrId: args[2], json };
    }
    if (args[1] === "show" && args[2]) {
      return { command: "experiment-show", experimentId: args[2], json };
    }
    return null;
  }

  if (args.includes("diff") && !args.includes("config-diff")) {
    const idx = args.indexOf("diff");
    const runA = args[idx + 1];
    const runB = args[idx + 2];
    if (!runA || !runB) return null;
    const semantic = args.includes("--semantic");
    const json = args.includes("--json");
    const firstDivergenceOnly = args.includes("--first-divergence");
    let policyPath: string | undefined;
    for (let i = idx + 3; i < args.length; i++) {
      if (args[i] === "--policy" && args[i + 1]) {
        policyPath = args[i + 1];
        i++;
      }
    }
    return {
      command: "diff",
      runA,
      runB,
      semantic,
      json,
      policyPath,
      firstDivergenceOnly,
    };
  }
  if (args.includes("checkpoints")) {
    const idx = args.indexOf("checkpoints");
    const runIdOrPath = args[idx + 1];
    if (!runIdOrPath) return null;
    const json = args.includes("--json");
    return { command: "checkpoints", runIdOrPath, json };
  }

  if (args.includes("fork")) {
    const idx = args.indexOf("fork");
    const runIdOrPath = args[idx + 1];
    if (!runIdOrPath) return null;

    let checkpointId = "";
    let mutationsPath: string | undefined;
    const json = args.includes("--json");

    for (let i = idx + 2; i < args.length; i++) {
      if (args[i] === "--checkpoint" && args[i + 1]) {
        checkpointId = args[i + 1]!;
        i++;
      } else if (args[i] === "--mutations" && args[i + 1]) {
        mutationsPath = args[i + 1];
        i++;
      }
    }

    if (!checkpointId) return null;
    return { command: "fork", runIdOrPath, checkpointId, mutationsPath, json };
  }

  if (args.includes("context")) {
    const idx = args.indexOf("context");
    const runIdOrPath = args[idx + 1];
    if (!runIdOrPath) return null;
    const json = args.includes("--json");
    const signals = args.includes("--signals");
    let stepId: string | undefined;
    let snapshotId: string | undefined;

    for (let i = idx + 2; i < args.length; i++) {
      if (args[i] === "--step" && args[i + 1]) {
        stepId = args[i + 1];
        i++;
      } else if (args[i] === "--snapshot" && args[i + 1]) {
        snapshotId = args[i + 1];
        i++;
      }
    }

    return { command: "context", runIdOrPath, stepId, snapshotId, signals, json };
  }

  if (args.includes("memory")) {
    const idx = args.indexOf("memory");
    const runIdOrPath = args[idx + 1];
    if (!runIdOrPath) return null;
    const json = args.includes("--json");
    const timeline = args.includes("--timeline");
    const signals = args.includes("--signals");
    let memoryId: string | undefined;

    for (let i = idx + 2; i < args.length; i++) {
      if (args[i] === "--memory" && args[i + 1]) {
        memoryId = args[i + 1];
        i++;
      }
    }

    return { command: "memory", runIdOrPath, memoryId, timeline, signals, json };
  }

  if (args.includes("ablate")) {
    const idx = args.indexOf("ablate");
    const runIdOrPath = args[idx + 1];
    if (!runIdOrPath) return null;
    let checkpointId = "";
    let contextItemId: string | undefined;
    let memoryId: string | undefined;
    const json = args.includes("--json");

    for (let i = idx + 2; i < args.length; i++) {
      if (args[i] === "--checkpoint" && args[i + 1]) {
        checkpointId = args[i + 1]!;
        i++;
      } else if (args[i] === "--context-item" && args[i + 1]) {
        contextItemId = args[i + 1];
        i++;
      } else if (args[i] === "--memory" && args[i + 1]) {
        memoryId = args[i + 1];
        i++;
      }
    }

    if (!checkpointId || (!contextItemId && !memoryId)) return null;
    return { command: "ablate", runIdOrPath, checkpointId, contextItemId, memoryId, json };
  }

  const replayIdx = args.indexOf("replay");
  if (replayIdx !== -1 && args[replayIdx + 1]) {
    const runIdOrPath = args[replayIdx + 1]!;
    let mode: ReplayMode = "STRICT_OFFLINE";
    let validateOnly = false;
    let fromStart = true;
    let json = false;

    for (let i = replayIdx + 2; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--strict") {
        mode = "STRICT_OFFLINE";
      } else if (arg === "--best-effort") {
        mode = "BEST_EFFORT_OFFLINE";
      } else if (arg === "--validate-only") {
        validateOnly = true;
      } else if (arg === "--from-start") {
        fromStart = true;
      } else if (arg === "--json") {
        json = true;
      }
    }

    return { command: "replay", runIdOrPath, mode, validateOnly, fromStart, json };
  }

  if (args.includes("evidence")) {
    const idx = args.indexOf("evidence");
    const runIdOrPath = args[idx + 1];
    if (!runIdOrPath) return null;
    const json = args.includes("--json");
    let policyPath: string | undefined;
    for (let i = idx + 2; i < args.length; i++) {
      if (args[i] === "--policy" && args[i + 1]) {
        policyPath = args[i + 1];
        i++;
      }
    }
    return { command: "evidence", runIdOrPath, policyPath, json };
  }

  if (args.includes("config-diff")) {
    const idx = args.indexOf("config-diff");
    const runA = args[idx + 1];
    const runB = args[idx + 2];
    if (!runA || !runB) return null;
    const json = args.includes("--json");
    return { command: "config-diff", runA, runB, json };
  }

  if (args.includes("config")) {
    const idx = args.indexOf("config");
    const runIdOrPath = args[idx + 1];
    if (!runIdOrPath) return null;
    const json = args.includes("--json");
    return { command: "config", runIdOrPath, json };
  }

  return null;
}

export async function loadArtifact(idOrPath: string): Promise<RunArtifact> {
  if (!idOrPath) {
    throw new Error("Run ID or file path is required.");
  }
  // 1. If it looks like a file path or exists as a file, try reading it
  if (idOrPath.endsWith(".json") || idOrPath.includes("/") || idOrPath.includes("\\")) {
    const absPath = resolve(process.cwd(), idOrPath);
    try {
      const raw = await readFile(absPath, "utf8");
      const parsed = JSON.parse(raw);
      return runArtifactSchema.parse(parsed);
    } catch (err) {
      throw new Error(`Failed to load RunArtifact from file "${absPath}": ${(err as Error).message}`);
    }
  }

  // 2. Try looking up by run ID in persistence
  const fromStore = await getCanonicalRun(idOrPath);
  if (fromStore) {
    return fromStore;
  }

  // 3. Fallback: check if idOrPath is a direct file path without .json extension
  try {
    const raw = await readFile(resolve(process.cwd(), idOrPath), "utf8");
    return runArtifactSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error(`Run "${idOrPath}" not found in store or filesystem.`);
  }
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(argv);

  if (!options) {
    console.error(`AgentPulse CLI

    pulse diff <run-a> <run-b> [--semantic] [--json] [--policy <file>] [--first-divergence]
    pulse evidence <run-id|file-path> [--policy <file>] [--json]
    pulse config <run-id|file-path> [--json]
    pulse config-diff <run-a> <run-b> [--json]
    pulse context <run-id|file-path> [--step <id>] [--snapshot <id>] [--signals] [--json]
    pulse memory <run-id|file-path> [--memory <id>] [--timeline] [--signals] [--json]
    pulse ablate <run-id|file-path> --checkpoint <checkpoint-id> [--context-item <id>] [--memory <id>] [--json]
    pulse checkpoints <run-id|file-path> [--json]
    pulse fork <run-id|file-path> --checkpoint <checkpoint-id> [--mutations <file>] [--json]
    pulse replay <run-id|file-path> [options]
    pulse eval list [--json]
    pulse eval run <run-id|file-path> --suite <suite-id|file-path> [--json]
    pulse dataset list [--json]
    pulse experiment plan <definition-file|id> [--json]
    pulse experiment run <definition-file|id> [--json]
    pulse experiment show <experiment-id> [--json]

  Replay Options:
    --strict          Enforce strict offline execution with 0 network calls (default)
    --best-effort     Allow best-effort offline execution
    --validate-only   Build and validate ReplayPlan without executing the replay
    --from-start      Execute replay from the initial step (default: true)
    --json            Output machine-readable JSON to stdout
  `);
      return 1;
    }

    try {
      if (options.command === "diff") {
        const artifactA = await loadArtifact(options.runA);
        const artifactB = await loadArtifact(options.runB);

        let policy: ComparisonPolicy | undefined;
        if (options.policyPath) {
          const raw = await readFile(resolve(process.cwd(), options.policyPath), "utf8");
          policy = comparisonPolicySchema.parse(JSON.parse(raw));
        }

        const comparison = await compareRuns(artifactA, artifactB, {
          enableSemantic: options.semantic,
          policy,
        });

        await saveRunComparison(comparison);

        if (options.json) {
          if (options.firstDivergenceOnly) {
            console.log(
              JSON.stringify(
                comparison.first_meaningful_divergence ??
                comparison.first_structural_divergence ??
                null,
                null,
                2
              )
            );
          } else {
            console.log(JSON.stringify(comparison, null, 2));
          }
          return 0;
        }

        if (options.firstDivergenceOnly) {
          const div = comparison.first_meaningful_divergence ?? comparison.first_structural_divergence;
          console.log(`\nFIRST DIVERGENCE`);
          console.log(`────────────────────────────────────`);
          if (!div) {
            console.log(`No divergence detected.`);
          } else {
            console.log(`Dimension:    ${div.dimension}`);
            console.log(`Description:  ${div.description}`);
            console.log(`Severity:     ${div.severity}`);
            console.log(`Causal:       ${div.causal_status}`);
            if (div.step_name || div.step_id) {
              console.log(`Step:         ${div.step_name ?? div.step_id}`);
            }
          }
          console.log(`────────────────────────────────────\n`);
          return 0;
        }

        console.log(`\nRUN COMPARISON`);
        console.log(`────────────────────────────────────\n`);
        console.log(`Baseline     ${options.runA}`);
        console.log(`Candidate    ${options.runB}`);
        console.log(`Relation     ${comparison.relationship}\n`);

        console.log(`Configuration`);
        if (comparison.configuration_diff.summary.length === 0) {
          console.log(`unchanged\n`);
        } else {
          for (const s of comparison.configuration_diff.summary) {
            console.log(`${s}`);
          }
          console.log(``);
        }

        console.log(`First meaningful divergence`);
        if (comparison.first_meaningful_divergence) {
          const div = comparison.first_meaningful_divergence;
          const stepDesc = div.step_name ?? div.step_id ?? "initial";
          console.log(`${stepDesc} / ${div.dimension.toLowerCase()}`);
        } else {
          console.log(`none detected`);
        }
        console.log(``);

        console.log(`Evidence`);
        const testPassedBase = (artifactA.evidence?.test_results ?? []).filter((t) => t.status === "PASSED").length;
        const testTotalBase = (artifactA.evidence?.test_results ?? []).length;
        const testPassedCand = (artifactB.evidence?.test_results ?? []).filter((t) => t.status === "PASSED").length;
        const testTotalCand = (artifactB.evidence?.test_results ?? []).length;
        if (testTotalBase > 0 || testTotalCand > 0) {
          console.log(`tests        ${testPassedBase}/${testTotalBase} → ${testPassedCand}/${testTotalCand}`);
        }
        const revStatusBase = artifactA.evidence?.review_results?.[0]?.status ?? "none";
        const revStatusCand = artifactB.evidence?.review_results?.[0]?.status ?? "none";
        if (revStatusBase !== "none" || revStatusCand !== "none") {
          console.log(`review       ${revStatusBase} → ${revStatusCand}`);
        }
        console.log(`outcome      ${comparison.outcome_diff.baseline_status} → ${comparison.outcome_diff.candidate_status}\n`);

        console.log(`Metrics`);
        const costBase = artifactA.observability.total_cost_usd ?? 0;
        const costCand = artifactB.observability.total_cost_usd ?? 0;
        console.log(`cost         $${costBase.toFixed(2)} → $${costCand.toFixed(2)}`);
        const durBase = (artifactA.observability.total_duration_ms ?? 0) / 1000;
        const durCand = (artifactB.observability.total_duration_ms ?? 0) / 1000;
        console.log(`latency      ${durBase.toFixed(1)}s → ${durCand.toFixed(1)}s\n`);

        console.log(`VERDICT      ${comparison.verdict}\n`);

        return 0;
      }
    if (options.command === "config-diff") {
      const artifactA = await loadArtifact(options.runA);
      const artifactB = await loadArtifact(options.runB);

      if (!artifactA.configuration_snapshot) {
        throw new Error(`Run A "${options.runA}" does not have an AgentConfigurationSnapshot.`);
      }
      if (!artifactB.configuration_snapshot) {
        throw new Error(`Run B "${options.runB}" does not have an AgentConfigurationSnapshot.`);
      }

      const diff = diffConfiguration(artifactA.configuration_snapshot, artifactB.configuration_snapshot);

      if (options.json) {
        console.log(JSON.stringify(diff, null, 2));
      } else {
        console.log(`\n========================================================================`);
        console.log(` Configuration Diff: ${options.runA} vs ${options.runB}`);
        console.log(`========================================================================`);
        console.log(`Identical:             ${diff.identical ? "YES" : "NO"}`);
        console.log(`Changed Agent:         ${diff.changed_agent ? "YES" : "NO"}`);
        console.log(`Changed Model:         ${diff.changed_model ? "YES" : "NO"}`);
        console.log(`Changed Parameters:    ${diff.changed_parameters ? "YES" : "NO"}`);
        console.log(`Changed Prompts:       ${diff.changed_prompts ? "YES" : "NO"}`);
        console.log(`Changed Skills:        ${diff.changed_skills ? "YES" : "NO"}`);
        console.log(`Changed Tools:         ${diff.changed_tools ? "YES" : "NO"}`);
        console.log(`Changed Permissions:   ${diff.changed_permissions ? "YES" : "NO"}`);
        console.log(`Changed Workflow:      ${diff.changed_workflow ? "YES" : "NO"}`);
        console.log(`Changed Runtime:       ${diff.changed_runtime_config ? "YES" : "NO"}`);

        if (diff.summary.length > 0) {
          console.log(`\nDifferences Summary:`);
          for (const s of diff.summary) {
            console.log(`  - ${s}`);
          }
        }
        console.log(`========================================================================\n`);
      }
      return diff.identical ? 0 : 1;
    }

    const artifact = "runIdOrPath" in options ? await loadArtifact(options.runIdOrPath) : (null as any);

    if (options.command === "checkpoints") {
      const checkpoints =
        artifact.checkpoints && artifact.checkpoints.length > 0
          ? artifact.checkpoints
          : artifact.lineage?.checkpoint_reference
            ? [artifact.lineage.checkpoint_reference]
            : [];

      if (options.json) {
        console.log(JSON.stringify(checkpoints, null, 2));
      } else {
        console.log(`\n========================================================================`);
        console.log(` Checkpoints for Run: ${artifact.identity.run_id}`);
        console.log(`========================================================================`);
        console.log(`${"CHECKPOINT".padEnd(26)} ${"STEP".padEnd(24)} ${"POSITION".padEnd(14)} RESTORABLE`);
        console.log(`${"-".repeat(25)} ${"-".repeat(23)} ${"-".repeat(13)} ${"-".repeat(10)}`);

        for (const chk of checkpoints) {
          const chkId = chk.checkpoint_id.padEnd(26);
          const stepId = chk.step_id.padEnd(24);
          const pos = (chk.position ?? "AFTER_STEP").padEnd(14);
          const restorable = chk.restorable !== false ? "YES" : "NO";
          console.log(`${chkId} ${stepId} ${pos} ${restorable}`);
        }
        console.log(`========================================================================\n`);
      }
      return 0;
    }

    if (options.command === "fork") {
      let mutations: ExperimentMutation[] = [];
      if (options.mutationsPath) {
        const rawMut = await readFile(resolve(process.cwd(), options.mutationsPath), "utf8");
        mutations = JSON.parse(rawMut);
      }

      const runtime = new ForkRuntime(artifact, options.checkpointId, {
        mutations,
        executionMode: "SAFE_OFFLINE_FORK",
      });

      const result = await runtime.fork();

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        const isSuccess = result.status === "COMPLETED";
        console.log(`\n=================================================`);
        console.log(` AgentPulse Fork Execution: ${result.fork_id}`);
        console.log(`=================================================`);
        console.log(`Derived Run ID:      ${result.derived_run_id}`);
        console.log(`Parent Run ID:       ${result.parent_run_id}`);
        console.log(`Checkpoint ID:       ${result.checkpoint_id}`);
        console.log(`Status:              ${result.status} ${isSuccess ? "✓" : "✗"}`);
        console.log(`Mutations Applied:   ${result.mutations_applied.length}`);
        console.log(`Steps Executed:      ${result.steps_executed}`);
        console.log(`Boundaries Recorded: ${result.boundaries_recorded}`);
        console.log(`Blocked Actions:     ${result.blocked_actions} (Side-Effect Guard)`);
        if (result.final_output !== undefined) {
          console.log(`Final Output:        ${typeof result.final_output === "string" ? result.final_output : JSON.stringify(result.final_output)}`);
        }
        if (result.errors.length > 0) {
          console.log(`Errors:`);
          for (const err of result.errors) {
            console.log(`  - ${err}`);
          }
        }
        console.log(`=================================================\n`);
      }

      return result.status === "COMPLETED" ? 0 : 1;
    }

    if (options.command === "replay") {
      const plan = await buildReplayPlan(artifact, {
        mode: options.mode,
      });

      if (options.validateOnly) {
        if (options.json) {
          console.log(JSON.stringify(plan, null, 2));
        } else {
          console.log(`\n========================================`);
          console.log(` AgentPulse Replay Plan: ${plan.replay_id}`);
          console.log(`========================================`);
          console.log(`Source Run ID:          ${plan.source_run_id}`);
          console.log(`Mode:                   ${plan.mode}`);
          console.log(`Verdict:                ${plan.replayability_verdict}`);
          console.log(`Expected Steps:         ${plan.expected_steps.length}`);
          console.log(`Expected Boundaries:    ${plan.expected_boundaries.length}`);
          console.log(`Unsupported Features:   ${plan.unsupported_features.length}`);
          console.log(`Missing Evidence:       ${plan.missing_evidence.length}`);

          if (plan.unsupported_features.length > 0) {
            console.log(`\nUnsupported Features:`);
            for (const feature of plan.unsupported_features) {
              console.log(`  - ${feature}`);
            }
          }
          if (plan.missing_evidence.length > 0) {
            console.log(`\nMissing Evidence:`);
            for (const missing of plan.missing_evidence) {
              console.log(`  - ${missing}`);
            }
          }
        }

        return plan.replayability_verdict === "NOT_REPLAYABLE" ? 1 : 0;
      }

      const runtime = new ReplayRuntime(artifact, {
        mode: options.mode,
      });

      const result = await runtime.replay();

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        const isSuccess = result.status === "MATCHED";
        console.log(`\n=================================================`);
        console.log(` AgentPulse Replay Execution: ${result.replay_id}`);
        console.log(`=================================================`);
        console.log(`Source Run ID:           ${result.source_run_id}`);
        console.log(`Status:                  ${result.status} ${isSuccess ? "✓" : "✗"}`);
        console.log(`Mode:                    ${result.mode}`);
        console.log(`Deterministic Match:     ${result.deterministic_match ? "YES" : "NO"}`);
        console.log(`Steps Replayed:          ${result.steps_executed} / ${result.steps_expected}`);
        console.log(`Boundaries Substituted:  ${result.boundaries_substituted} / ${result.boundaries_expected}`);
        console.log(`Live Calls Blocked:      ${result.live_calls_blocked} (Network Kill Switch)`);

        if (result.divergences.length > 0) {
          console.log(`\nDivergences (${result.divergences.length}):`);
          for (const div of result.divergences) {
            console.log(`  - [${div.divergence_type}] Step ${div.step_index ?? "N/A"}: ${div.message}`);
            if (div.actual && Object.keys(div.actual).length > 0) {
              console.log(`    Actual:   ${JSON.stringify(div.actual)}`);
            }
          }
        }
        console.log(`=================================================\n`);
      }

      return result.status === "MATCHED" ? 0 : 1;
    }

    if (options.command === "evidence") {
      let policy: Partial<EvidencePolicy> | undefined;
      if (options.policyPath) {
        const raw = await readFile(resolve(process.cwd(), options.policyPath), "utf8");
        policy = JSON.parse(raw);
      }

      const completeness = computeEvidenceCompleteness(artifact, policy);
      const outcome =
        artifact.evidence?.final_outcome?.status ??
        (artifact.execution.status === "completed" ? "SUCCESS" : "FAILURE");
      const verificationStatus = artifact.evidence?.final_outcome?.verification_status ?? "NOT_RUN";
      const configHash = artifact.configuration_snapshot?.config_hash ?? "NOT_CAPTURED";
      const testsCount = artifact.evidence?.test_results?.length ?? 0;
      const testsPassed = artifact.evidence?.test_results?.filter((t: any) => t.status === "PASSED").length ?? 0;
      const reviewsCount = artifact.evidence?.review_results?.length ?? 0;
      const approvalsGranted =
        artifact.evidence?.approval_events?.filter((a: any) => a.decision === "GRANTED").length ?? 0;
      const approvalsRejected =
        artifact.evidence?.approval_events?.filter((a: any) => a.decision === "REJECTED").length ?? 0;
      const blocksCount =
        artifact.evidence?.security_events?.filter(
          (s: any) => s.decision === "BLOCKED" || s.decision === "DENY"
        ).length ?? 0;
      const artifactsCount = artifact.artifacts?.length ?? 0;

      const summaryData = {
        runId: artifact.identity.run_id,
        outcome,
        verificationStatus,
        configHash,
        tests: `${testsPassed} / ${testsCount} passed`,
        reviews: `${reviewsCount} reviews`,
        approvals: `${approvalsGranted} granted, ${approvalsRejected} rejected`,
        blocks: blocksCount,
        artifacts: artifactsCount,
        completenessScore: `${completeness.score}%`,
        completenessCoverage: completeness.coverage,
        missingRequired: completeness.missing_required,
        passedPolicy: completeness.passed_policy,
      };

      if (options.json) {
        console.log(JSON.stringify(summaryData, null, 2));
      } else {
        console.log(`\n========================================================================`);
        console.log(` Run Evidence Summary: ${artifact.identity.run_id}`);
        console.log(`========================================================================`);
        console.log(`Outcome:                 ${outcome} ${outcome === "SUCCESS" ? "✓" : "✗"}`);
        console.log(`Verification:            ${verificationStatus}`);
        console.log(`Configuration Hash:      ${configHash}`);
        console.log(`Tests:                   ${testsPassed} / ${testsCount} passed`);
        console.log(`Reviews:                 ${reviewsCount} recorded`);
        console.log(`Approvals:               ${approvalsGranted} granted, ${approvalsRejected} rejected`);
        console.log(`Security Blocks:         ${blocksCount} blocked`);
        console.log(`Artifacts:               ${artifactsCount} artifacts`);
        console.log(`Evidence Completeness:   ${completeness.score}% [Policy: ${completeness.passed_policy ? "PASSED" : "FAILED"}]`);
        console.log(`Coverage Breakdown:`);
        for (const [key, val] of Object.entries(completeness.coverage)) {
          const icon = val === "PRESENT" ? "✓" : val === "MISSING_REQUIRED" ? "✗" : "-";
          console.log(`  - ${key.padEnd(16)}: ${val} [${icon}]`);
        }
        if (completeness.missing_required.length > 0) {
          console.log(`Missing Required Evidence: ${completeness.missing_required.join(", ")}`);
        }
        console.log(`========================================================================\n`);
      }
      return completeness.passed_policy ? 0 : 1;
    }

    if (options.command === "config") {
      const cfg = artifact.configuration_snapshot;
      if (!cfg) {
        if (options.json) {
          console.log(JSON.stringify({ error: "No configuration snapshot recorded" }));
        } else {
          console.log(`\n[AgentPulse] No AgentConfigurationSnapshot captured for run "${artifact.identity.run_id}".\n`);
        }
        return 1;
      }

      if (options.json) {
        console.log(JSON.stringify(cfg, null, 2));
      } else {
        console.log(`\n========================================================================`);
        console.log(` Agent Configuration Snapshot: ${cfg.snapshot_id}`);
        console.log(`========================================================================`);
        console.log(`Run ID:            ${cfg.run_id}`);
        console.log(`Config Hash:       ${cfg.config_hash}`);
        console.log(`Captured At:       ${cfg.captured_at}`);
        console.log(`Agent:             ${cfg.agent.id}@${cfg.agent.version}${cfg.agent.name ? ` (${cfg.agent.name})` : ""}`);
        console.log(`Model:             ${cfg.model.provider}/${cfg.model.model_id}${cfg.model.resolved_revision ? ` [${cfg.model.resolved_revision}]` : ""}`);
        console.log(`Parameters:        ${JSON.stringify(cfg.model.parameters)}`);
        console.log(`Prompts (${cfg.prompts.length}):`);
        for (const p of cfg.prompts) {
          console.log(`  - ${p.id}@${p.version}${p.content_hash ? ` [${p.content_hash.slice(0, 16)}...]` : ""}`);
        }
        console.log(`Skills (${cfg.skills.length}):`);
        for (const s of cfg.skills) {
          console.log(`  - ${s.id}@${s.version}`);
        }
        console.log(`Tools (${cfg.tools.length}):`);
        for (const t of cfg.tools) {
          console.log(`  - ${t.id}@${t.version}${t.permission_class ? ` (perm: ${t.permission_class})` : ""}`);
        }
        console.log(`Permissions:       Policy ${cfg.permissions.policy_id ?? "default"}@${cfg.permissions.policy_version ?? "1"} [granted: ${cfg.permissions.granted_capabilities.join(", ")}]`);
        if (cfg.runtime) {
          console.log(`Runtime:           ${cfg.runtime.framework ?? "custom"} | ${cfg.runtime.language_runtime ?? "node"} | Git: ${cfg.runtime.git_sha ?? "n/a"}`);
        }
        console.log(`========================================================================\n`);
      }
      return 0;
    }

    if (options.command === "context") {
      const report = analyzeRunContext(artifact);
      await saveContextIntelligenceReport(report);

      let snapshotsToDisplay = report.snapshots;
      if (options.stepId) {
        snapshotsToDisplay = snapshotsToDisplay.filter((s) => s.step_id === options.stepId);
      }
      if (options.snapshotId) {
        snapshotsToDisplay = snapshotsToDisplay.filter((s) => s.snapshot_id === options.snapshotId);
      }

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              report_id: report.report_id,
              run_id: report.run_id,
              run_summary: report.run_summary,
              snapshots: snapshotsToDisplay,
              signals: options.signals ? report.signals : report.signals.slice(0, 5),
              ablation_candidates: report.ablation_candidates,
            },
            null,
            2
          )
        );
      } else {
        console.log(`\n========================================================================`);
        console.log(` AgentPulse Context Intelligence: ${artifact.identity.run_id}`);
        console.log(`========================================================================`);
        console.log(`Decisions Analyzed:        ${report.run_summary.total_decisions}`);
        console.log(`Total Context Tokens:      ${report.run_summary.total_context_tokens.toLocaleString()}`);
        console.log(`Exact Repeated Tokens:     ${report.run_summary.exact_repeated_tokens.toLocaleString()}`);
        console.log(`Tool Definition Tokens:    ${report.run_summary.tool_definition_tokens.toLocaleString()}`);
        console.log(
          `Retrieved Docs Admitted:   ${report.run_summary.retrieved_docs_admitted_count} / ${report.run_summary.retrieved_docs_total_count} (${(report.run_summary.retrieved_docs_admission_rate * 100).toFixed(1)}%)`
        );
        console.log(`Memory Items Injected:     ${report.run_summary.memory_items_injected_count}`);
        console.log(`Provenance Coverage:       ${(report.run_summary.provenance_coverage_ratio * 100).toFixed(1)}%`);
        console.log(`Exact Duplicates:          ${report.run_summary.exact_duplicates_count}`);
        console.log(`Provenance Gaps:           ${report.run_summary.provenance_gaps_count}`);

        for (const snap of snapshotsToDisplay) {
          console.log(`\n--- Decision Snapshot: ${snap.snapshot_id} (Step: ${snap.step_id ?? "n/a"}) ---`);
          console.log(
            `Total Tokens: ${snap.composition.total_tokens.toLocaleString()} | Quality: ${snap.measurement_quality.exact_measured_percentage}% measured, ${snap.measurement_quality.estimated_percentage}% estimated`
          );
          console.log(`Composition by Source:`);
          for (const s of snap.composition.by_source_type) {
            console.log(`  - ${s.source_type.padEnd(30)}: ${s.tokens.toString().padStart(6)} tokens (${s.percentage}%)`);
          }
        }

        if (options.signals || report.signals.length > 0) {
          console.log(`\nDiagnostic Signals (${report.signals.length}):`);
          for (const sig of report.signals) {
            const badge = sig.severity === "CRITICAL" ? "🔴" : sig.severity === "WARNING" ? "⚠️" : "ℹ️";
            console.log(`  ${badge} [${sig.code}] ${sig.bounded_finding}`);
          }
        }

        if (report.ablation_candidates.length > 0) {
          console.log(`\nAblation Candidates (${report.ablation_candidates.length}):`);
          for (const cand of report.ablation_candidates) {
            console.log(
              `  - [Candidate] ${cand.item_id} (${cand.source_type}): ${cand.rationale} (Est. savings: ${cand.token_savings_estimate} tokens)`
            );
          }
        }
        console.log(`========================================================================\n`);
      }
      return 0;
    }

    if (options.command === "memory") {
      const report = analyzeRunMemory(artifact);
      await saveMemoryIntelligenceReport(report);

      let injectionsToDisplay = report.injections;
      let lifecyclesToDisplay = report.lifecycles;
      if (options.memoryId) {
        injectionsToDisplay = injectionsToDisplay.filter((i) => i.memory_id === options.memoryId);
        lifecyclesToDisplay = lifecyclesToDisplay.filter((l) => l.memory_id === options.memoryId);
      }

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              report_id: report.report_id,
              run_id: report.run_id,
              operations_summary: report.operations_summary,
              retrieval_summary: report.retrieval_summary,
              lifecycles: lifecyclesToDisplay,
              injections: injectionsToDisplay,
              diagnostics: report.diagnostics,
              ablation_candidates: report.ablation_candidates,
            },
            null,
            2
          )
        );
      } else {
        console.log(`\n========================================================================`);
        console.log(` AgentPulse Memory Intelligence: ${artifact.identity.run_id}`);
        console.log(`========================================================================`);
        console.log(`Total Memory Operations:   ${report.operations_summary.total_operations}`);
        console.log(`Unique Memories Seen:      ${report.operations_summary.unique_memories_observed}`);
        console.log(`Committed Writes:          ${report.operations_summary.writes_committed_count}`);
        console.log(`Updates:                   ${report.operations_summary.updates_count}`);
        console.log(`Supersedes:                ${report.operations_summary.supersedes_count}`);
        console.log(`Retrievals:                ${report.retrieval_summary.total_retrieval_ops}`);
        console.log(`Injections into Context:   ${report.injections.length}`);
        console.log(`Admission Rate:            ${(report.retrieval_summary.admission_rate * 100).toFixed(1)}%`);
        console.log(`Stale/Superseded Injected: ${report.retrieval_summary.superseded_retrieved_count}`);

        if (options.timeline) {
          console.log(`\nMemory Lifecycles:`);
          for (const lc of lifecyclesToDisplay) {
            console.log(
              `  - Memory: ${lc.memory_id} (Provider: ${lc.provider ?? "custom"}, Category: ${lc.category}, Superseded: ${lc.is_superseded})`
            );
            for (const node of lc.nodes) {
              console.log(
                `      ↳ [${node.operation_type}] Op: ${node.operation_id} (version: ${node.version ?? "none"}) at ${node.timestamp}`
              );
            }
          }
        }

        console.log(`\nMemory Injections:`);
        for (const inj of injectionsToDisplay) {
          console.log(
            `  - Memory ${inj.memory_id} (version: ${inj.memory_version ?? "n/a"}) → Snapshot ${inj.context_snapshot_id} (Item: ${inj.context_item_id}, ${inj.injected_tokens ?? 0} tokens)${inj.is_stale_at_injection ? " [STALE]" : ""}`
          );
        }

        if (options.signals || report.diagnostics.length > 0) {
          console.log(`\nDiagnostic Signals (${report.diagnostics.length}):`);
          for (const sig of report.diagnostics) {
            const badge = sig.severity === "CRITICAL" ? "🔴" : sig.severity === "WARNING" ? "⚠️" : "ℹ️";
            console.log(`  ${badge} [${sig.code}] ${sig.bounded_finding}`);
          }
        }

        if (report.ablation_candidates.length > 0) {
          console.log(`\nAblation Candidates (${report.ablation_candidates.length}):`);
          for (const cand of report.ablation_candidates) {
            console.log(`  - [Candidate] Memory ${cand.memory_id}: ${cand.rationale}`);
          }
        }
        console.log(`========================================================================\n`);
      }
      return 0;
    }

    if (options.command === "ablate") {
      const mutation: ExperimentMutation = options.contextItemId
        ? {
            mutation_id: `mut_ablate_ctx_${Date.now()}`,
            mutation_type: "context_exclusion",
            target_identifier: options.contextItemId,
            description: `Ablate context item ${options.contextItemId}`,
            mutated_value: { excluded: true, item_id: options.contextItemId },
          }
        : {
            mutation_id: `mut_ablate_mem_${Date.now()}`,
            mutation_type: "memory_exclusion",
            target_identifier: options.memoryId!,
            description: `Ablate memory ${options.memoryId}`,
            mutated_value: { excluded: true, memory_id: options.memoryId },
          };

      const runtime = new ForkRuntime(artifact, options.checkpointId, {
        mutations: [mutation],
        candidateModelHandler: async (inp) => {
          return {
            status: "success",
            text: "Candidate response generated under controlled ablation.",
            ablated_input: inp.prompt,
          };
        },
      });

      const result = await runtime.fork();
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`\n========================================================================`);
        console.log(` AgentPulse Controlled Ablation Fork: ${result.fork_id}`);
        console.log(`========================================================================`);
        console.log(`Parent Run ID:       ${result.parent_run_id}`);
        console.log(`Checkpoint ID:       ${result.checkpoint_id}`);
        console.log(`Status:              ${result.status}`);
        console.log(
          `Ablation Applied:    ${options.contextItemId ? `context_exclusion(${options.contextItemId})` : `memory_exclusion(${options.memoryId})`}`
        );
        console.log(
          `Candidate Tokens:    ${result.child_artifact?.context[0]?.total_token_estimate ?? "n/a"}`
        );
        console.log(`Steps Executed:      ${result.steps_executed}`);
        console.log(`Boundaries Recorded: ${result.boundaries_recorded}`);
        console.log(`========================================================================\n`);
      }
      return result.status === "COMPLETED" ? 0 : 1;
    }

    if (options.command === "eval-list") {
      const definitions = await listEvalDefinitions();
      const suites = await listEvalSuites();
      if (options.json) {
        console.log(JSON.stringify({ definitions, suites }, null, 2));
      } else {
        console.log(`\n========================================================================`);
        console.log(` AgentPulse Eval Studio: Library & Suites`);
        console.log(`========================================================================`);
        console.log(`Eval Definitions (${definitions.length}):`);
        for (const d of definitions) {
          console.log(`  - [${d.family}] ${d.eval_definition_id}@${d.version}: ${d.name} (${d.grader_type}, ${d.severity})`);
        }
        console.log(`\nEval Suites (${suites.length}):`);
        for (const s of suites) {
          console.log(`  - ${s.suite_id}@${s.version}: ${s.name} (${s.definitions.length} defs, mode: ${s.pass_policy.mode})`);
        }
        console.log(`========================================================================\n`);
      }
      return 0;
    }

    if (options.command === "eval-run") {
      const artifact = await loadArtifact(options.runIdOrPath);
      let suite: any = null;
      if (options.suiteIdOrPath.endsWith(".json") || options.suiteIdOrPath.includes("/")) {
        const raw = await readFile(resolve(process.cwd(), options.suiteIdOrPath), "utf8");
        suite = evalSuiteSchema.parse(JSON.parse(raw));
      } else {
        const parts = options.suiteIdOrPath.split("@");
        const suiteId = parts[0]!;
        const version = parts[1] ? parseInt(parts[1], 10) : 1;
        suite = await getEvalSuite(suiteId, version);
      }
      if (!suite) {
        throw new Error(`EvalSuite "${options.suiteIdOrPath}" not found.`);
      }

      const evalRun = await evaluateRun(artifact, suite);
      if (options.json) {
        console.log(JSON.stringify(evalRun, null, 2));
      } else {
        console.log(`\n========================================================================`);
        console.log(` AgentPulse Post-Hoc Evaluation: ${evalRun.evaluation_run_id}`);
        console.log(`========================================================================`);
        console.log(`Run ID:              ${artifact.identity.run_id}`);
        console.log(`Eval Suite:          ${evalRun.suite_id}@${evalRun.suite_version}`);
        console.log(`Suite Verdict:       ${evalRun.summary.suite_verdict === "PASSED" ? "✅ PASSED" : "❌ FAILED"}`);
        console.log(`Verdict Reason:      ${evalRun.summary.verdict_reason}`);
        console.log(`Pass Rate:           ${(evalRun.summary.pass_rate * 100).toFixed(1)}% (${evalRun.summary.passed}/${evalRun.summary.total})`);
        console.log(`Grader Cost:         $${evalRun.cost_usd.toFixed(4)}`);
        console.log(`Duration:            ${evalRun.duration_ms}ms`);
        console.log(`\nResults:`);
        for (const r of evalRun.results) {
          const badge = r.passed ? "✅" : "❌";
          const status = r.grader_status ?? (r.passed ? "PASSED" : "FAILED");
          console.log(`  ${badge} [${r.eval_type}] ${r.name}: ${status} (${r.findings.join("; ")})`);
        }
        console.log(`========================================================================\n`);
      }
      return evalRun.summary.suite_verdict === "PASSED" ? 0 : 1;
    }

    if (options.command === "dataset-list") {
      const datasets = await listEvalDatasets();
      if (options.json) {
        console.log(JSON.stringify(datasets, null, 2));
      } else {
        console.log(`\n========================================================================`);
        console.log(` AgentPulse Eval Datasets (${datasets.length})`);
        console.log(`========================================================================`);
        for (const d of datasets) {
          console.log(`  - ${d.dataset_id}@${d.version}: ${d.name} (${d.cases.length} cases)`);
        }
        console.log(`========================================================================\n`);
      }
      return 0;
    }

    if (options.command === "experiment-plan") {
      let def: ExperimentDefinition;
      if (options.definitionPathOrId.endsWith(".json") || options.definitionPathOrId.includes("/")) {
        const raw = await readFile(resolve(process.cwd(), options.definitionPathOrId), "utf8");
        def = experimentDefinitionSchema.parse(JSON.parse(raw));
      } else {
        const fetched = await getExperimentDefinition(options.definitionPathOrId);
        if (!fetched) throw new Error(`Experiment definition "${options.definitionPathOrId}" not found.`);
        def = fetched;
      }

      const plan = ExperimentPlanner.plan(def);
      if (options.json) {
        console.log(JSON.stringify(plan, null, 2));
      } else {
        console.log(`\n========================================================================`);
        console.log(` AgentPulse Experiment Plan: ${def.name}`);
        console.log(`========================================================================`);
        console.log(`Valid:               ${plan.valid ? "YES" : "NO"}`);
        console.log(`Total Arms:          ${plan.total_arms}`);
        console.log(`Total Trials:        ${plan.total_trials}`);
        console.log(`Single Variable:     ${plan.single_variable ? "YES (Strong Causal Attribution)" : "NO (Confounded)"}`);
        if (plan.warnings.length > 0) {
          console.log(`\nWarnings:`);
          for (const w of plan.warnings) console.log(`  ⚠️ ${w}`);
        }
        if (plan.errors.length > 0) {
          console.log(`\nErrors:`);
          for (const e of plan.errors) console.log(`  ❌ ${e}`);
        }
        console.log(`\nCandidate Arms (${plan.arms.length}):`);
        for (const a of plan.arms) {
          console.log(`  - [${a.is_baseline ? "BASELINE" : "CANDIDATE"}] ${a.arm_id}: ${a.name} (${a.mutations.length} mutations)`);
        }
        console.log(`========================================================================\n`);
      }
      return plan.valid ? 0 : 1;
    }

    if (options.command === "experiment-run") {
      let def: ExperimentDefinition;
      if (options.definitionPathOrId.endsWith(".json") || options.definitionPathOrId.includes("/")) {
        const raw = await readFile(resolve(process.cwd(), options.definitionPathOrId), "utf8");
        def = experimentDefinitionSchema.parse(JSON.parse(raw));
      } else {
        const fetched = await getExperimentDefinition(options.definitionPathOrId);
        if (!fetched) throw new Error(`Experiment definition "${options.definitionPathOrId}" not found.`);
        def = fetched;
      }

      const result = await ExperimentRunner.run(def);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`\n========================================================================`);
        console.log(` AgentPulse Experiment Result: ${result.experiment_id}`);
        console.log(`========================================================================`);
        console.log(`Status:              ${result.status}`);
        console.log(`Baseline Arm:        ${result.baseline_arm_id}`);
        console.log(`Recommended Arm:     ${result.recommended_candidate ?? "None"}`);
        console.log(`Recommendation:      ${result.recommendation_basis}`);
        console.log(`\nArm Summary:`);
        for (const agg of result.aggregates) {
          const repNote = agg.repeatability_note ? ` [${agg.repeatability_note}]` : "";
          console.log(
            `  - ${agg.arm_name} (${agg.is_baseline ? "Baseline" : "Candidate"}): Pass Rate ${(agg.pass_rate * 100).toFixed(0)}%, Mean Score: ${agg.mean_score.toFixed(3)}, Cost: $${agg.mean_total_cost.toFixed(4)}, Latency: ${agg.mean_latency_ms.toFixed(0)}ms${repNote}`
          );
        }
        console.log(`========================================================================\n`);
      }
      return result.recommended_candidate ? 0 : 1;
    }

    if (options.command === "experiment-show") {
      const result = await getExperimentResult(options.experimentId);
      if (!result) throw new Error(`Experiment result "${options.experimentId}" not found.`);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`\n========================================================================`);
        console.log(` AgentPulse Experiment: ${result.experiment_id}`);
        console.log(`========================================================================`);
        console.log(`Status:              ${result.status}`);
        console.log(`Recommended:         ${result.recommended_candidate ?? "None"}`);
        console.log(`Recommendation:      ${result.recommendation_basis}`);
        console.log(`Trials Executed:     ${result.trial_summaries.length}`);
        console.log(`Cost Consumed:       $${result.budget_consumed.cost_usd.toFixed(4)}`);
        console.log(`========================================================================\n`);
      }
      return 0;
    }

    if (options.command === "baseline-list") {
      const baselines = await listRegressionBaselines(options.projectId);
      if (options.json) {
        console.log(JSON.stringify(baselines, null, 2));
      } else {
        console.log(`\n========================================================================`);
        console.log(` AgentPulse Regression Baselines (${baselines.length})`);
        console.log(`========================================================================`);
        for (const b of baselines) {
          console.log(`  - [${b.status}] ${b.baseline_id}: agent=${b.agent_id ?? "unknown"} suite=${b.eval_suite_id}@${b.eval_suite_version} dataset=${b.dataset_id ?? "none"} approved=${b.approved_at}`);
        }
        console.log(`========================================================================\n`);
      }
      return 0;
    }

    if (options.command === "baseline-set") {
      const targetRun = await getCanonicalRun(options.targetId);
      if (!targetRun) throw new Error(`Target run "${options.targetId}" not found; cannot create baseline.`);

      const baseline = await BaselineManager.createBaseline({
        projectId: targetRun.identity.project_id ?? "default_project",
        agentId: options.agentId ?? targetRun.identity.agent_id,
        runId: targetRun.identity.run_id,
        configurationHash: targetRun.configuration_snapshot?.config_hash || "config_hash",
        evalSuiteId: options.suiteId,
        evalSuiteVersion: 1,
        datasetId: options.datasetId,
        approvedBy: "cli_user",
        label: `CLI Baseline for ${targetRun.identity.agent_id ?? "agent"}`,
      });

      if (options.json) {
        console.log(JSON.stringify(baseline, null, 2));
      } else {
        console.log(`\n========================================================================`);
        console.log(` Approved Baseline: ${baseline.baseline_id}`);
        console.log(`========================================================================`);
        console.log(`Status:              ${baseline.status}`);
        console.log(`Suite:               ${baseline.eval_suite_id}@${baseline.eval_suite_version}`);
        console.log(`Evidence Hash:       ${baseline.evidence_hash}`);
        console.log(`Approved At:         ${baseline.approved_at}`);
        console.log(`========================================================================\n`);
      }
      return 0;
    }

    if (options.command === "regression-check") {
      const baseline = await getRegressionBaseline(options.baselineId);
      if (!baseline) throw new Error(`Regression baseline "${options.baselineId}" not found.`);

      const candidateRun = await getCanonicalRun(options.candidateRunId);
      if (!candidateRun) throw new Error(`Candidate run "${options.candidateRunId}" not found.`);

      const baselineRun = baseline.run_id ? await getCanonicalRun(baseline.run_id) : undefined;
      const suite = await getEvalSuite(baseline.eval_suite_id, baseline.eval_suite_version);
      if (!suite) throw new Error(`EvalSuite "${baseline.eval_suite_id}@${baseline.eval_suite_version}" not found.`);

      // Evaluate candidate run against suite
      const candidateEvalRun = await evaluateRun(candidateRun, suite, { persist: false });
      const baselineEvalRun = baselineRun ? await evaluateRun(baselineRun, suite, { persist: false }) : undefined;

      let policy: RegressionGatePolicy | null = null;
      if (options.policyIdOrPath) {
        if (options.policyIdOrPath.endsWith(".json") || options.policyIdOrPath.includes("/")) {
          const raw = await readFile(resolve(process.cwd(), options.policyIdOrPath), "utf8");
          policy = regressionGatePolicySchema.parse(JSON.parse(raw));
        } else {
          policy = await getRegressionGatePolicy(options.policyIdOrPath);
        }
      }
      if (!policy) {
        policy = regressionGatePolicySchema.parse({
          policy_id: "default_release_policy",
          version: 1,
          name: "Standard Release Gate Policy",
        });
      }

      const comparison = baselineRun ? await compareRuns(baselineRun, candidateRun) : undefined;

      const { gateResult, report, artifact } = await RegressionGateEngine.evaluateGate({
        baseline,
        candidateRunId: candidateRun.identity.run_id,
        candidateConfigHash: candidateRun.configuration_snapshot?.config_hash || "cand_hash",
        candidateContext: {
          suite_id: suite.suite_id,
          suite_version: suite.version,
          dataset_id: baseline.dataset_id,
          dataset_version: baseline.dataset_version,
        },
        baselineEvalRun,
        candidateEvalRun,
        baselineArtifact: baselineRun ?? undefined,
        candidateArtifact: candidateRun,
        comparison: comparison ?? undefined,
        policy,
      });

      if (options.json) {
        console.log(JSON.stringify(artifact, null, 2));
      } else {
        console.log(`\n========================================================================`);
        console.log(` AgentPulse Regression Release Gate: ${gateResult.status}`);
        console.log(`========================================================================`);
        console.log(`Baseline:            ${baseline.baseline_id}`);
        console.log(`Candidate:           ${candidateRun.identity.run_id}`);
        console.log(`Policy:              ${policy.name}@v${policy.version}`);
        console.log(`Comparability:       ${gateResult.comparability.verdict}`);
        console.log(`Critical Regressions: ${artifact.critical_regressions}`);
        console.log(`Case Regressions:    ${artifact.case_regressions}`);
        console.log(`Summary:             ${gateResult.summary}`);
        if (gateResult.findings.length > 0) {
          console.log(`\nFindings (${gateResult.findings.length}):`);
          for (const f of gateResult.findings) {
            console.log(`  - [${f.severity}] ${f.category}: ${f.candidate_evidence.summary} (delta: ${f.delta})`);
          }
        }
        console.log(`========================================================================\n`);
      }
      return artifact.exit_code;
    }

    if (options.command === "capability-show") {
      const snapshots = await listCapabilitySnapshots(options.agentId);
      if (options.json) {
        console.log(JSON.stringify(snapshots, null, 2));
      } else {
        console.log(`\n========================================================================`);
        console.log(` AgentPulse Capability History: ${options.agentId} (${snapshots.length} snapshots)`);
        console.log(`========================================================================`);
        for (const snap of snapshots) {
          console.log(`\nVersion: ${snap.agent_version} (Captured: ${snap.captured_at}, Status: ${snap.overall_status})`);
          for (const d of snap.dimensions) {
            console.log(`  - ${d.dimension.padEnd(20)}: Score ${(d.score * 100).toFixed(0)}% | Pass Rate ${(d.pass_rate * 100).toFixed(0)}%`);
          }
        }
        console.log(`========================================================================\n`);
      }
      return 0;
    }

    if (options.command === "capability-diff") {
      const all = await listCapabilitySnapshots(options.agentId);
      const snapA = all.find((s) => s.agent_version === options.versionA || s.capability_snapshot_id === options.versionA);
      const snapB = all.find((s) => s.agent_version === options.versionB || s.capability_snapshot_id === options.versionB);
      if (!snapA || !snapB) throw new Error(`Could not find capability snapshots for versions ${options.versionA} and ${options.versionB}.`);

      const report = await CapabilityDriftEngine.analyzeDrift({
        baselineSnapshot: snapA,
        candidateSnapshot: snapB,
      });

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`\n========================================================================`);
        console.log(` AgentPulse Capability Drift: ${snapA.agent_version} -> ${snapB.agent_version}`);
        console.log(`========================================================================`);
        console.log(`Overall Drift:       ${report.overall_drift}`);
        console.log(`Summary:             ${report.drift_summary}`);
        console.log(`\nDimensional Drift:`);
        for (const d of report.dimensions) {
          const arrow = d.direction === "IMPROVED" ? "↑" : d.direction === "REGRESSED" ? "↓" : "=";
          console.log(`  - ${d.dimension.padEnd(20)}: ${d.direction} ${arrow} (baseline: ${d.baseline_score.toFixed(2)}, candidate: ${d.candidate_score.toFixed(2)}, delta: ${d.score_delta > 0 ? "+" : ""}${d.score_delta.toFixed(2)})`);
        }
        console.log(`========================================================================\n`);
      }
      return 0;
    }

    if (options.command === "policy-drift") {
      const runA = await getCanonicalRun(options.baselineRunId);
      const runB = await getCanonicalRun(options.candidateRunId);
      if (!runA || !runB) throw new Error(`Could not load runs "${options.baselineRunId}" and/or "${options.candidateRunId}".`);

      const snapA = await PolicySnapshotEngine.captureSnapshot({
        projectId: runA.identity.project_id ?? "project",
        runArtifact: runA,
        persist: false,
      });
      const snapB = await PolicySnapshotEngine.captureSnapshot({
        projectId: runB.identity.project_id ?? "project",
        runArtifact: runB,
        persist: false,
      });

      const report = await PolicyDriftDetector.detect({
        baselineSnapshot: snapA,
        candidateSnapshot: snapB,
      });

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`\n========================================================================`);
        console.log(` AgentPulse Policy Drift: ${options.baselineRunId} -> ${options.candidateRunId}`);
        console.log(`========================================================================`);
        console.log(`Critical Drift:      ${report.has_critical_drift ? "YES ⚠️" : "NO"}`);
        console.log(`Summary:             ${report.summary}`);
        if (report.drift_findings.length > 0) {
          console.log(`\nFindings (${report.drift_findings.length}):`);
          for (const f of report.drift_findings) {
            console.log(`  - [${f.severity}] ${f.drift_type}: ${f.description}`);
          }
        }
        console.log(`========================================================================\n`);
      }
      return report.has_critical_drift ? 1 : 0;
    }

    return 1;
  } catch (err) {
    if (options.json) {
      console.error(JSON.stringify({ error: (err as Error).message }));
    } else {
      console.error(`\n[AgentPulse Error] ${(err as Error).message}\n`);
    }
    return 1;
  }
}

// Auto-run if executed directly
if (process.argv[1]?.endsWith("pulse-cli.ts") || process.argv[1]?.endsWith("pulse.ts")) {
  runCli().then((code) => {
    if (code !== 0) process.exit(code);
  });
}
