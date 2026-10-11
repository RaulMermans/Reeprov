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

export type CliCommandOptions = ReplayCliOptions | CheckpointsCliOptions | ForkCliOptions;

export function parseArgs(args: string[]): CliCommandOptions | null {
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

  return null;
}

export async function loadArtifact(idOrPath: string): Promise<RunArtifact> {
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

Commands:
  pulse checkpoints <run-id|file-path> [--json]
  pulse fork <run-id|file-path> --checkpoint <checkpoint-id> [--mutations <file>] [--json]
  pulse replay <run-id|file-path> [options]

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
    const artifact = await loadArtifact(options.runIdOrPath);

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
