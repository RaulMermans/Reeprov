import { randomBytes } from "node:crypto";

export const WORKFLOW_REGISTRY_VERSION = "reeprov-workflow-registry-v1";

export function generateRegistryId(): string {
  const tsBase36 = Date.now().toString(36);
  const rand = randomBytes(2).toString("hex");
  return `wfr_${tsBase36}_${rand}`;
}
