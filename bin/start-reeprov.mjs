#!/usr/bin/env node
/**
 * Reeprov Mode-Aware Launcher Entrypoint (bin).
 */
import process from "node:process";
import createJiti from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: {
    "@": process.cwd(),
  },
});

const { runLauncher } = await jiti.import("../scripts/start-reeprov.ts");
await runLauncher();
