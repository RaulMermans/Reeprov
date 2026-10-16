/**
 * Run ID generation.
 *
 * Format: run_<base36-timestamp>_<4-hex-random>
 * Example: run_lhvz4k1a_3f2c
 *
 * Follows the same pattern as reportId in lib/reports/reportId.ts.
 */

import { randomBytes } from "node:crypto";

export const RUN_STORE_VERSION = "reeprov-run-store-v1";

export function generateRunId(): string {
  const tsBase36 = Date.now().toString(36);
  const rand = randomBytes(2).toString("hex");
  return `run_${tsBase36}_${rand}`;
}
