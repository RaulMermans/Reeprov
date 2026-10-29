/**
 * @reeprov/client
 *
 * Official TypeScript client SDK for Reeprov — local-first debugging
 * and reproducibility for AI agents.
 */

export {
  ReeprovClient,
  ReeprovError,
  ReeprovIngestError,
  AgentPulseClient, AgentPulseError,
  SDK_NAME,
  SDK_VERSION,
} from "./client.js";
export { canonicalJson, canonicalSha256 } from "./hash.js";
export {
  createCapturingDependencies,
  modelBoundaryIdentity,
  toolBoundaryIdentity,
} from "./host.js";
export type {
  HostDependencies,
  HostHooks,
  HostModelRequest,
  HostToolRequest,
  LiveDependencies,
  ReeprovHostAdapter,
  ResumePosition,
} from "./host.js";
export type {
  ReeprovClientOptions,
  AgentPulseClientOptions,
  ArtifactCreatedInput,
  BoundaryCaptureInput,
  CheckpointAck,
  CheckpointObservedInput,
  CheckpointSavedInput,
  CompleteRunInput,
  ContentMode,
  EmitEventsResult,
  EvalCompletedInput,
  EventStatus,
  FailRunInput,
  HandoffInput,
  IngestAck,
  ModelCallInput,
  PermissionClass,
  RecordResult,
  RecordStatus,
  RegisterCheckpointInput,
  ResumeAdapterIdentity,
  StartRunInput,
  StartRunResult,
  ToolCallInput,
  TraceEvent,
} from "./types.js";
