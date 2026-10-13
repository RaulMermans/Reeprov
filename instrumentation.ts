/**
 * Next.js Instrumentation Hook.
 *
 * Runs once on server boot. Provides defense-in-depth logging and operating mode
 * validation without blocking server startup.
 */

import { getOperatingMode, validateHostBinding } from "./lib/auth/operatingMode";

export async function register(): Promise<void> {
  // Execute only during server runtime (nodejs)
  if (process.env.NEXT_RUNTIME === "nodejs" || !process.env.NEXT_RUNTIME) {
    const mode = getOperatingMode();
    const host =
      process.env.AGENTPULSE_HOST?.trim() ||
      (mode === "self_hosted" ? "0.0.0.0" : "127.0.0.1");
    const port = process.env.AGENTPULSE_PORT || process.env.PORT || "3000";

    const bindingCheck = validateHostBinding(host, mode);
    if (!bindingCheck.valid) {
      console.warn(
        `[AgentPulse Instrumentation] WARNING: Host binding violation: ${bindingCheck.reason}`
      );
    }

    if (mode === "self_hosted") {
      const accessKey = process.env.AGENTPULSE_ACCESS_KEY?.trim();
      if (!accessKey) {
        console.warn(
          "[AgentPulse Instrumentation] WARNING: PRIVATE_SELF_HOSTED mode requires AGENTPULSE_ACCESS_KEY, but none was detected."
        );
      }
    } else if (mode === "headless_ci") {
      console.log(
        "[AgentPulse Instrumentation] HEADLESS_CI mode: Studio available but not required. CLI evals, comparisons, and regression gates can run via API."
      );
    }

    console.log(
      `[AgentPulse Instrumentation] Operating mode: ${mode}, bound interface: ${host}:${port}`
    );
  }
}
