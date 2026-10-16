#!/usr/bin/env tsx
/**
 * @deprecated Legacy launcher shim. Use scripts/start-reeprov.ts instead.
 */
export * from "./start-reeprov";
import { runLauncher } from "./start-reeprov";

if (
  process.argv[1] &&
  (process.argv[1].endsWith("start-agentpulse.ts") ||
    process.argv[1].endsWith("start-agentpulse.mjs") ||
    process.argv[1].endsWith("start-agentpulse"))
) {
  runLauncher().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
