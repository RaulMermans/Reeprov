#!/usr/bin/env node
/**
 * AgentPulse CLI Executable.
 */
import process from "node:process";
import createJiti from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: {
    "@": process.cwd(),
  },
});

const { runCli } = await jiti.import("../scripts/pulse-cli.ts");
const code = await runCli();
if (code !== 0) {
  process.exit(code);
}
