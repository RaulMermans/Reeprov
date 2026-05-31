import { randomBytes } from "node:crypto";

export const INTEGRATION_REGISTRY_VERSION = "agentpulse-integration-registry-v1";

export function generateIntegrationId(): string {
  const tsBase36 = Date.now().toString(36);
  const rand = randomBytes(2).toString("hex");
  return `integ_${tsBase36}_${rand}`;
}
