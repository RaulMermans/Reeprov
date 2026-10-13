/**
 * Personal Data Root & Local Storage Layout for AgentPulse.
 *
 * Implements AGENTPULSE_HOME (~/.agentpulse) resolution and privacy posture.
 */

import os from "node:os";
import path from "node:path";
import { getOperatingMode } from "@/lib/auth/operatingMode";

export interface PrivacyPosture {
  mode: string;
  dataPath: string;
  loopbackBound: boolean;
  telemetryStatus: "DISABLED" | "NONE";
  cloudSync: "DISABLED" | "NONE";
  accountsConfigured: "NONE" | "INSTANCE_OWNER";
  networkBoundHost: string;
}

/**
 * Resolves the root data storage directory for AgentPulse.
 * Precedence:
 *   1. AGENTPULSE_HOME
 *   2. AGENTPULSE_STORE_DIR
 *   3. ~/.agentpulse
 */
export function getAgentPulseHome(): string {
  if (process.env.AGENTPULSE_HOME) {
    return path.resolve(process.env.AGENTPULSE_HOME);
  }

  if (process.env.AGENTPULSE_STORE_DIR) {
    return path.resolve(process.env.AGENTPULSE_STORE_DIR);
  }

  // During tests, default to local .agentpulse in cwd to avoid polluting user home dir
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return path.resolve(process.cwd(), ".agentpulse");
  }

  return path.resolve(os.homedir(), ".agentpulse");
}

export function getStorageSubdirectories(baseDir = getAgentPulseHome()) {
  return {
    root: baseDir,
    config: path.join(baseDir, "config.json"),
    db: path.join(baseDir, "agentpulse.db"),
    runs: path.join(baseDir, "runs"),
    comparisons: path.join(baseDir, "comparisons"),
    evals: path.join(baseDir, "evals"),
    experiments: path.join(baseDir, "experiments"),
    baselines: path.join(baseDir, "baselines"),
    reports: path.join(baseDir, "reports"),
    blobs: path.join(baseDir, "blobs"),
    backups: path.join(baseDir, "backups"),
    integrations: path.join(baseDir, "integrations"),
  };
}

/**
 * Returns current instance privacy posture.
 */
export function getPrivacyPosture(): PrivacyPosture {
  const mode = getOperatingMode();
  const dataPath = getAgentPulseHome();

  return {
    mode,
    dataPath,
    loopbackBound: mode === "personal_local",
    telemetryStatus: "DISABLED",
    cloudSync: "DISABLED",
    accountsConfigured: mode === "self_hosted" ? "INSTANCE_OWNER" : "NONE",
    networkBoundHost: mode === "personal_local" ? "127.0.0.1 (Loopback only)" : "Configured server host",
  };
}
