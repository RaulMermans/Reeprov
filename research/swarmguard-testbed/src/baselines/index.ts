export {
  MONITOR_RESULT_FORMAT,
  monitorResultSchema,
  claimPredictionSchema,
  extractObservableClaims,
  type MonitorResult,
  type ClaimPrediction,
  type ObservableClaim,
  type MonitorClass,
} from "./schema";
export { runPerAgentMonitor, PER_AGENT_MONITOR_ID, PER_AGENT_MONITOR_VERSION } from "./perAgent";
export { runPooledEventMonitor, POOLED_EVENT_MONITOR_ID, POOLED_EVENT_MONITOR_VERSION } from "./pooledEvent";

import type { RunArtifact } from "../../../../lib/core/contracts/runArtifact";
import { runPerAgentMonitor } from "./perAgent";
import { runPooledEventMonitor } from "./pooledEvent";
import type { MonitorResult } from "./schema";

export type BaselineId = "baseline.per_agent.v1" | "baseline.pooled_event.v1";

export function runBaseline(
  id: BaselineId,
  artifact: RunArtifact,
  options?: { caseId?: string; domainId?: string }
): MonitorResult {
  if (id === "baseline.per_agent.v1") return runPerAgentMonitor(artifact, options);
  return runPooledEventMonitor(artifact, options);
}

export const FROZEN_BASELINES: BaselineId[] = ["baseline.per_agent.v1", "baseline.pooled_event.v1"];
