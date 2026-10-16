#!/usr/bin/env node
/**
 * Reeprov CLI Executable.
 *
 * Canonical invocation:
 *   npm run reeprov -- <command>
 *   ./bin/reeprov.mjs <command>
 */
import process from "node:process";
import createJiti from "jiti";

const args = process.argv.slice(2);
const jiti = createJiti(import.meta.url, {
  alias: {
    "@": process.cwd(),
  },
});

if (args[0] === "studio" || args[0] === "start" || args[0] === "dev") {
  const isDev = args[0] === "dev" || args.includes("--dev");
  const { runLauncher } = await jiti.import("../scripts/start-reeprov.ts");
  await runLauncher({ isDev, argv: args.slice(1) });
} else {
  const { runCli } = await jiti.import("../scripts/pulse-cli.ts");
  const code = await runCli();
  if (code !== 0) {
    process.exit(code);
  }
}
