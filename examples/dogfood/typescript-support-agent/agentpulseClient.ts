/** Legacy compatibility wrapper for AgentPulse -> Reeprov migration. */
export * from "./reeprovClient.js";
export { ReeprovClient as AgentPulseClient } from "./reeprovClient.js";
export type { ReeprovClientOptions as AgentPulseClientOptions } from "./reeprovClient.js";
