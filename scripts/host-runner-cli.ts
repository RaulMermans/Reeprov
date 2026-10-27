/**
 * Developer-side host runner commands.
 *
 *   reeprov host-replay --run <id|file.json> --adapter <module> [--checkpoint <id>]
 *                       [--allow-partial] [--mutations <file.json>] [--server <url>]
 *                       [--upload] [--out <file.json>] [--json]
 *   reeprov host-fork   --run <id|file.json> --adapter <module> --checkpoint <id>
 *                       --mutations <file.json> [--server <url>] [--upload] [--out <file.json>] [--json]
 *
 * The adapter module is the developer's own agent code. It is loaded and
 * executed in this CLI process on the developer's machine — never in the
 * Reeprov server. It must export `createHostAdapter()` (or a default factory).
 *
 * --server reads evidence from (and with --upload, writes results to) a
 * running Reeprov instance using REEPROV_ACCESS_KEY; without it, the local
 * store is used.
 */

import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runArtifactSchema, type RunArtifact } from "../lib/core/contracts/runArtifact";
import type { ExperimentMutation } from "../lib/core/contracts/lineage";
import { getCanonicalRun, saveCanonicalRun } from "../lib/core/capture/persistence";
import { saveReplayResult } from "../lib/core/replay/persistence";
import { getReeprovEnv } from "../lib/config/env";
import { runHostFork, runHostReplay, replayClaimErrors, validateUploadedFork } from "../lib/core/external/hostRunner";

export const HOST_RUNNER_COMMANDS = ["host-replay", "host-fork"] as const;

interface Flags {
  [key: string]: string | boolean | undefined;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function accessKey(): string {
  const key = getReeprovEnv("REEPROV_ACCESS_KEY");
  if (!key) throw new Error("REEPROV_ACCESS_KEY is required with --server.");
  return key;
}

async function serverRequest(server: string, path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${server.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-reeprov-key": accessKey(), ...(init?.headers ?? {}) },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function loadSource(run: string, server?: string): Promise<RunArtifact> {
  if (run.endsWith(".json")) return runArtifactSchema.parse(JSON.parse(await readFile(resolve(run), "utf8")));
  if (server) {
    const res = await serverRequest(server, `/api/runs/${encodeURIComponent(run)}/canonical`);
    if (res.status !== 200) throw new Error(`Could not load run ${run} from ${server}: HTTP ${res.status}`);
    return runArtifactSchema.parse(res.body);
  }
  const local = await getCanonicalRun(run);
  if (!local) throw new Error(`Run "${run}" not found in the local store.`);
  return local;
}

async function loadAdapter(modulePath: string) {
  const ext = extname(modulePath);
  if (ext === ".py") {
    throw new Error(
      "UNSUPPORTED_HOST_LANGUAGE: the Reeprov host runner executes JavaScript/TypeScript host adapters only. Python agents can record boundaries and register checkpoints, but host replay/fork of Python code is not supported yet.",
    );
  }
  const mod = (await import(pathToFileURL(resolve(modulePath)).href)) as Record<string, unknown>;
  const factory = (mod["createHostAdapter"] ?? mod["default"]) as ((opts?: unknown) => unknown) | undefined;
  if (typeof factory !== "function") throw new Error(`Adapter module ${modulePath} must export createHostAdapter().`);
  const options = process.env["REEPROV_HOST_ADAPTER_OPTIONS"] ? JSON.parse(process.env["REEPROV_HOST_ADAPTER_OPTIONS"]) : undefined;
  return factory(options) as Parameters<typeof runHostReplay>[0]["adapter"];
}

async function loadMutations(path: string | boolean | undefined): Promise<ExperimentMutation[]> {
  if (typeof path !== "string") return [];
  return JSON.parse(await readFile(resolve(path), "utf8")) as ExperimentMutation[];
}

export async function runHostRunnerCli(argv: string[]): Promise<number> {
  const command = argv[0];
  const flags = parseFlags(argv.slice(1));
  const server = typeof flags["server"] === "string" ? flags["server"] : undefined;
  const run = flags["run"];
  const adapterPath = flags["adapter"];
  if (typeof run !== "string" || typeof adapterPath !== "string") {
    console.error(`Usage: reeprov ${command} --run <id|file.json> --adapter <module> ...`);
    return 2;
  }
  const source = await loadSource(run, server);
  const adapter = await loadAdapter(adapterPath);
  const checkpointId = typeof flags["checkpoint"] === "string" ? flags["checkpoint"] : undefined;
  let output: unknown;
  let exitCode: number;

  if (command === "host-replay") {
    const replay = await runHostReplay({
      source,
      adapter,
      checkpointId,
      verification: flags["allow-partial"] ? "ALLOW_PARTIAL" : "EXACT",
      inputMutations: await loadMutations(flags["mutations"]),
    });
    output = replay;
    exitCode = replay.status === "MATCHED" ? 0 : 1;
    if (flags["upload"]) {
      if (server) {
        const res = await serverRequest(server, `/api/runs/${encodeURIComponent(source.identity.run_id)}/replays`, {
          method: "POST", body: JSON.stringify({ replay }),
        });
        if (res.status !== 201) throw new Error(`Replay upload rejected: HTTP ${res.status} ${JSON.stringify(res.body)}`);
      } else {
        const errors = replayClaimErrors(replay, source.identity.run_id);
        if (errors.length) throw new Error(errors.join("; "));
        await saveReplayResult(replay);
      }
    }
    if (!flags["json"]) {
      console.log(`Replay ${replay.replay_id}: ${replay.status} · ${replay.verification} · ${replay.boundaries_substituted}/${replay.boundaries_expected} boundaries substituted · ${replay.steps_executed} host steps executed`);
      for (const d of replay.divergences) console.log(`  [${d.divergence_type}] ${d.message}`);
    }
  } else if (command === "host-fork") {
    if (!checkpointId) {
      console.error("host-fork requires --checkpoint <id>");
      return 2;
    }
    const fork = await runHostFork({ source, adapter, checkpointId, mutations: await loadMutations(flags["mutations"]) });
    output = fork;
    exitCode = fork.status === "COMPLETED" ? 0 : 1;
    if (flags["upload"] && fork.child_artifact && fork.status === "COMPLETED") {
      if (server) {
        const res = await serverRequest(server, `/api/runs/${encodeURIComponent(source.identity.run_id)}/forks`, {
          method: "POST", body: JSON.stringify({ child_artifact: fork.child_artifact }),
        });
        if (res.status !== 201 && res.status !== 200) throw new Error(`Fork upload rejected: HTTP ${res.status} ${JSON.stringify(res.body)}`);
      } else {
        const validation = validateUploadedFork(source, fork.child_artifact);
        if (!validation.ok) throw new Error(validation.errors.join("; "));
        await saveCanonicalRun(fork.child_artifact);
      }
    }
    if (!flags["json"]) {
      console.log(`Fork ${fork.fork_id}: ${fork.status} · resumed at step ${fork.resume_proof?.first_executed_step_index ?? "-"} · prefix steps re-executed ${fork.resume_proof?.prefix_steps_executed ?? "-"} · side effects blocked ${fork.blocked_side_effects}`);
      for (const e of fork.errors) console.log(`  ${e}`);
    }
  } else {
    return 2;
  }

  if (typeof flags["out"] === "string") await writeFile(resolve(flags["out"]), JSON.stringify(output, null, 2));
  if (flags["json"]) console.log(JSON.stringify(output, null, 2));
  return exitCode;
}
