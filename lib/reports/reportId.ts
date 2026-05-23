import { randomBytes } from "node:crypto";

/**
 * Generates a unique, stable report ID per scan.
 * Format: rpt_<base36-timestamp>_<hex-random>
 */
export function generateReportId(): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(4).toString("hex");
  return `rpt_${timestamp}_${random}`;
}

/**
 * Derives a stable project ID from a repository name.
 * Same repo always gets the same project ID, enabling history grouping.
 */
export function deriveProjectId(repoName: string): string {
  const safe = repoName
    .toLowerCase()
    .replace(/[^a-z0-9._/-]/g, "_")
    .replace(/\//g, "__")
    .slice(0, 64);
  return `proj_${safe}`;
}

/**
 * Current scanner version string, bumped when the scanner logic changes
 * in a backward-incompatible way.
 */
export const SCANNER_VERSION = "agentpulse-static-scanner-v2";
