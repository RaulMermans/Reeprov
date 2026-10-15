/**
 * @agentpulse/client
 *
 * Official TypeScript client SDK for AgentPulse — local-first debugging
 * and reproducibility for AI agents.
 */

export { AgentPulseClient, AgentPulseError } from "./client.js";
export type {
  AgentPulseClientOptions,
  ArtifactCreatedInput,
  BoundaryCaptureInput,
  CheckpointSavedInput,
  CompleteRunInput,
  EmitEventsResult,
  EvalCompletedInput,
  EventStatus,
  FailRunInput,
  ModelCallInput,
  PermissionClass,
  StartRunInput,
  StartRunResult,
  ToolCallInput,
  TraceEvent,
} from "./types.js";
