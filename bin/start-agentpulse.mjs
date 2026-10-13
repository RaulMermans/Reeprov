#!/usr/bin/env node
/**
 * AgentPulse Mode-Aware Launcher Entrypoint (bin).
 */
import process from "node:process";
import createJiti from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: {
    "@": process.cwd(),
  },
});

const { runLauncher } = await jiti.import("../scripts/start-agentpulse.ts");
await runLauncher();
