#!/usr/bin/env tsx
/**
 * AgentPulse Mode-Aware Launcher.
 *
 * Enforces operating mode constraints, loopback privacy guarantees,
 * and instance credential policies before launching the Next.js Studio server.
 *
 * Operating Modes:
 *   - personal_local (default): Bound to loopback interface (127.0.0.1 or ::1). Exposing public host fails startup.
 *   - self_hosted: Requires AGENTPULSE_ACCESS_KEY. Exits if missing.
 *   - headless_ci: Studio optional, loopback default with configurable host binding.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getOperatingMode,
  validateHostBinding,
  type OperatingMode,
} from "../lib/auth/operatingMode";

export interface LauncherConfig {
  mode: OperatingMode;
  host: string;
  port: number;
  isDev: boolean;
  extraArgs: string[];
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  logs: string[];
}

/**
 * Resolves the active operating mode from the environment.
 */
export function resolveLauncherMode(env: NodeJS.ProcessEnv = process.env): OperatingMode {
  const raw = env.AGENTPULSE_MODE?.toLowerCase().trim();
  if (raw === "self_hosted" || raw === "private_self_hosted") {
    return "self_hosted";
  }
  if (raw === "headless_ci" || raw === "ci" || raw === "headless") {
    return "headless_ci";
  }
  return getOperatingMode();
}

/**
 * Resolves requested host binding from environment.
 * Defaults to 127.0.0.1 for personal_local and headless_ci, 0.0.0.0 for self_hosted.
 */
export function resolveLauncherHost(
  mode: OperatingMode,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (env.AGENTPULSE_HOST?.trim()) {
    return env.AGENTPULSE_HOST.trim();
  }
  if (mode === "self_hosted") {
    return "0.0.0.0";
  }
  return "127.0.0.1";
}

/**
 * Resolves target port from AGENTPULSE_PORT or PORT, defaulting to 3000.
 */
export function resolveLauncherPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AGENTPULSE_PORT || env.PORT || "3000";
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed <= 0 || parsed > 65535) {
    return 3000;
  }
  return parsed;
}

/**
 * Resolves full launcher configuration.
 */
export function resolveLauncherConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2)
): LauncherConfig {
  const mode = resolveLauncherMode(env);
  const host = resolveLauncherHost(mode, env);
  const port = resolveLauncherPort(env);
  const isDev = argv.includes("--dev") || argv.includes("dev");
  const extraArgs = argv.filter((a) => a !== "--dev" && a !== "dev");

  return {
    mode,
    host,
    port,
    isDev,
    extraArgs,
  };
}

/**
 * Validates the launcher configuration against operating mode rules.
 * Fails before startup if policy is violated.
 */
export function validateLauncherConfig(
  config: LauncherConfig,
  env: NodeJS.ProcessEnv = process.env
): ValidationResult {
  const logs: string[] = [];

  // 1. Enforce host binding policy
  const bindingCheck = validateHostBinding(config.host, config.mode);
  if (!bindingCheck.valid) {
    return {
      valid: false,
      error: `Invalid host binding: ${bindingCheck.reason}`,
      logs,
    };
  }

  // 2. Enforce self_hosted access key requirement
  if (config.mode === "self_hosted") {
    const accessKey = env.AGENTPULSE_ACCESS_KEY?.trim();
    if (!accessKey) {
      return {
        valid: false,
        error:
          "PRIVATE_SELF_HOSTED mode requires AGENTPULSE_ACCESS_KEY. Set this environment variable before starting.",
        logs,
      };
    }
  }

  // 3. Mode-specific notices
  if (config.mode === "headless_ci") {
    logs.push(
      "HEADLESS_CI mode: Studio available but not required. CLI evals, comparisons, and regression gates can run via API."
    );
  }

  logs.push(`[AgentPulse] Operating Mode: ${config.mode}`);
  logs.push(`[AgentPulse] Bound address: http://${config.host}:${config.port}`);
  logs.push(`[AgentPulse] Launching Next.js in ${config.isDev ? "development" : "production"} mode`);

  return {
    valid: true,
    logs,
  };
}

/**
 * Resolves the Next.js CLI executable path.
 */
export function resolveNextExecutable(cwd: string = process.cwd()): string {
  const localNext = resolve(cwd, "node_modules/.bin/next");
  if (existsSync(localNext)) {
    return localNext;
  }
  return "next";
}

/**
 * Main launcher entry point.
 */
export async function runLauncher(options?: {
  isDev?: boolean;
  argv?: string[];
  exitOnError?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<ChildProcess | undefined> {
  const env = options?.env ?? process.env;
  const argv = options?.argv ?? process.argv.slice(2);
  const exitOnError = options?.exitOnError ?? true;

  const config = resolveLauncherConfig(env, argv);
  if (options?.isDev !== undefined) {
    config.isDev = options.isDev;
  }

  const validation = validateLauncherConfig(config, env);

  for (const log of validation.logs) {
    console.log(log);
  }

  if (!validation.valid) {
    console.error(validation.error);
    if (exitOnError) {
      process.exit(1);
    }
    throw new Error(validation.error);
  }

  const nextBin = resolveNextExecutable(process.cwd());
  const nextSubcommand = config.isDev ? "dev" : "start";
  const nextArgs = [
    nextSubcommand,
    "-H",
    config.host,
    "-p",
    String(config.port),
    ...config.extraArgs,
  ];

  console.log(`[AgentPulse] Spawning: ${nextBin} ${nextArgs.join(" ")}`);

  const child = spawn(nextBin, nextArgs, {
    stdio: "inherit",
    env: {
      ...env,
      AGENTPULSE_MODE: config.mode,
      AGENTPULSE_HOST: config.host,
      HOSTNAME: config.host,
      PORT: String(config.port),
    },
    shell: process.platform === "win32",
  });

  child.on("error", (err) => {
    console.error(`[AgentPulse] Failed to spawn Next.js process: ${err.message}`);
    if (exitOnError) {
      process.exit(1);
    }
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else if (exitOnError) {
      process.exit(code ?? 0);
    }
  });

  const forwardSignal = (sig: NodeJS.Signals) => {
    if (child && !child.killed) {
      child.kill(sig);
    }
  };

  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  return child;
}

// Auto-run if executed as script directly
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith("start-agentpulse.ts") ||
    process.argv[1].endsWith("start-agentpulse.mjs") ||
    process.argv[1].endsWith("start-agentpulse"));

if (isDirectExecution) {
  runLauncher().catch((err) => {
    console.error(`[AgentPulse Launcher Fatal] ${err.message}`);
    process.exit(1);
  });
}
