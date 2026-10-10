#!/usr/bin/env -S node --experimental-strip-types
/**
 * AgentPulse CLI Binary Wrapper.
 */
import { runCli } from "../scripts/pulse-cli";

runCli().then((code) => {
  if (code !== 0) process.exit(code);
});
