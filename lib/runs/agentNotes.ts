/**
 * Safe reasoning/decision notes.
 *
 * Extracts user-safe agent reasoning summaries from "agent_note_recorded"
 * trace events. This is not a chain-of-thought capture mechanism — only
 * structured, integration-authored summaries with visibility explicitly
 * marked "user_safe" are ever surfaced. Malformed or unsafe-visibility notes
 * are dropped silently; extraction never throws.
 */

import { agentNoteMetadataSchema } from "@/lib/proof-layer/schemas";
import type { AgentNoteConfidence, AgentNoteType, TraceEvent } from "@/lib/proof-layer/schemas";

export interface AgentNote {
  id: string;
  nodeId: string;
  noteType: AgentNoteType;
  agent?: string;
  summary: string;
  confidence?: AgentNoteConfidence;
}

/** Extracts all user-safe agent notes from a run's trace events. */
export function extractAgentNotes(traceEvents: TraceEvent[]): AgentNote[] {
  const notes: AgentNote[] = [];

  for (const event of traceEvents) {
    if (event.event_type !== "agent_note_recorded") continue;
    if (!event.node_id) continue;

    const parsed = agentNoteMetadataSchema.safeParse(event.metadata);
    if (!parsed.success) continue;

    notes.push({
      id: event.event_id,
      nodeId: event.node_id,
      noteType: parsed.data.note_type,
      agent: parsed.data.agent,
      summary: parsed.data.summary,
      confidence: parsed.data.confidence,
    });
  }

  return notes;
}

/** Groups notes belonging to a single node by their id for the inspector's collapsible sections. */
export function groupAgentNotesByType(notes: AgentNote[]): Map<AgentNoteType, AgentNote[]> {
  const grouped = new Map<AgentNoteType, AgentNote[]>();
  for (const note of notes) {
    const list = grouped.get(note.noteType);
    if (list) {
      list.push(note);
    } else {
      grouped.set(note.noteType, [note]);
    }
  }
  return grouped;
}
