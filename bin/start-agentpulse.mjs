#!/usr/bin/env node
/**
 * @deprecated Legacy AgentPulse launcher wrapper. Delegates to start-reeprov.ts.
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
