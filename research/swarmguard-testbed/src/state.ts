/**
 * Shared execution state is visible across agents only through handoffs and
 * recorded artifacts. Each agent's private working context is in-memory and
 * discarded after the turn — it is never copied into another agent's prompt.
 */

export interface ArtifactVersion {
  artifact_id: string;
  version: string;
  name: string;
  body: unknown;
}

export interface ToolEvidence {
  tool_call_id: string;
  tool_name: string;
  agent_id: string;
  status: string;
  output?: unknown;
}

export interface HandoffRecord {
  from_agent_id: string;
  to_agent_id?: string;
  summary: string;
  body: Record<string, unknown>;
  artifact_refs: string[];
  evidence_refs: string[];
}

export interface SharedExecutionState {
  artifactVersions: ArtifactVersion[];
  currentArtifactId?: string;
  previousArtifactId?: string;
  toolEvidence: ToolEvidence[];
  handoffs: HandoffRecord[];
  symbolic: Record<string, string>;
  notes: Record<string, unknown>;
}

export interface AgentPrivateContext {
  agent_id: string;
  role: string;
  working: Record<string, unknown>;
}

export function createSharedState(): SharedExecutionState {
  return {
    artifactVersions: [],
    toolEvidence: [],
    handoffs: [],
    symbolic: {},
    notes: {},
  };
}

export function createPrivateContext(agentId: string, role: string): AgentPrivateContext {
  return { agent_id: agentId, role, working: {} };
}

export function resolveSymbolicRef(ref: string, shared: SharedExecutionState): string {
  if (shared.symbolic[ref]) return shared.symbolic[ref]!;
  if (ref === "artifact:current" && shared.currentArtifactId) return shared.currentArtifactId;
  if (ref === "artifact:previous" && shared.previousArtifactId) return shared.previousArtifactId;
  const version = /^artifact:v(.+)$/.exec(ref);
  if (version) {
    const match = shared.artifactVersions.find((item) => item.version === version[1]);
    if (match) return match.artifact_id;
  }
  const tool = /^tool:(.+)$/.exec(ref);
  if (tool) {
    const match = [...shared.toolEvidence].reverse().find((item) => item.tool_name === tool[1]);
    if (match) return match.tool_call_id;
  }
  // Unresolved symbolic refs must remain unscoped so evidence integrity reports
  // MISSING rather than CROSS_RUN (P1 treats `prefix:id` as another run).
  if (/^(artifact|tool|record):/.test(ref)) {
    return ref.replace(/:/g, "_");
  }
  return ref;
}

export function resolveRefs(refs: string[], shared: SharedExecutionState): string[] {
  return refs.map((ref) => resolveSymbolicRef(ref, shared));
}

export function sharedViewForAgent(shared: SharedExecutionState): Record<string, unknown> {
  return {
    current_artifact_id: shared.currentArtifactId,
    artifact_versions: shared.artifactVersions.map((item) => ({
      artifact_id: item.artifact_id,
      version: item.version,
      name: item.name,
    })),
    tools: shared.toolEvidence.map((item) => ({
      tool_call_id: item.tool_call_id,
      tool_name: item.tool_name,
      agent_id: item.agent_id,
      status: item.status,
    })),
    last_handoff: shared.handoffs.at(-1)
      ? {
          from_agent_id: shared.handoffs.at(-1)!.from_agent_id,
          summary: shared.handoffs.at(-1)!.summary,
          body: shared.handoffs.at(-1)!.body,
          artifact_refs: shared.handoffs.at(-1)!.artifact_refs,
          evidence_refs: shared.handoffs.at(-1)!.evidence_refs,
        }
      : undefined,
  };
}
