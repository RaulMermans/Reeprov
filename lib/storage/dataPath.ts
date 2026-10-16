import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getOperatingMode } from "@/lib/auth/operatingMode";
import { getReeprovEnv } from "@/lib/config/env";

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
 * Resolves the root data storage directory for Reeprov.
 * Precedence:
 *   1. REEPROV_HOME (or legacy AGENTPULSE_HOME)
 *   2. REEPROV_STORE_DIR (or legacy AGENTPULSE_STORE_DIR)
 *   3. ~/.reeprov (with fallback to existing ~/.agentpulse during migration)
 */
export function getReeprovHome(): string {
  const customHome = getReeprovEnv("REEPROV_HOME");
  if (customHome) {
    return path.resolve(customHome);
  }

  const customStore = getReeprovEnv("REEPROV_STORE_DIR");
  if (customStore) {
    return path.resolve(customStore);
  }

  // During tests, default to local directory in cwd to avoid polluting user home dir
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    const cwdReeprov = path.resolve(process.cwd(), ".reeprov");
    const cwdAgentpulse = path.resolve(process.cwd(), ".agentpulse");
    if (!fs.existsSync(cwdReeprov) && fs.existsSync(cwdAgentpulse)) {
      return cwdAgentpulse;
    }
    return cwdReeprov;
  }

  const canonicalDir = path.resolve(os.homedir(), ".reeprov");
  const legacyDir = path.resolve(os.homedir(), ".agentpulse");

  // Fallback to existing legacy directory if canonical does not exist yet
  if (!fs.existsSync(canonicalDir) && fs.existsSync(legacyDir)) {
    return legacyDir;
  }

  return canonicalDir;
}

/** Legacy alias for getReeprovHome */
export const getAgentPulseHome = getReeprovHome;

export function getStorageSubdirectories(baseDir = getReeprovHome()) {
  const dbName =
    fs.existsSync(path.join(baseDir, "reeprov.db"))
      ? "reeprov.db"
      : fs.existsSync(path.join(baseDir, "agentpulse.db"))
        ? "agentpulse.db"
        : "reeprov.db";

  return {
    root: baseDir,
    config: path.join(baseDir, "config.json"),
    db: path.join(baseDir, dbName),
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
  const dataPath = getReeprovHome();

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
