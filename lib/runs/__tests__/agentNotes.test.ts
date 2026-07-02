/**
 * Tests for safe reasoning/decision note extraction.
 *
 * Critical invariants:
 * - Only "agent_note_recorded" events are considered.
 * - Only metadata.visibility === "user_safe" notes are ever extracted.
 * - Malformed metadata is dropped silently — extraction never throws.
 */

import { describe, expect, it } from "vitest";
import { extractAgentNotes, groupAgentNotesByType } from "@/lib/runs/agentNotes";
import { traceEventSchema } from "@/lib/proof-layer/schemas";
import type { TraceEvent } from "@/lib/proof-layer/schemas";

function makeEvent(partial: Partial<TraceEvent> & Pick<TraceEvent, "event_id" | "event_type" | "timestamp">): TraceEvent {
  return traceEventSchema.parse({ run_id: "run-1", workflow_id: "wf-1", ...partial });
}

describe("extractAgentNotes", () => {
  it("extracts a well-formed user-safe note", () => {
    const notes = extractAgentNotes([
      makeEvent({
        event_id: "n1",
        event_type: "agent_note_recorded",
        node_id: "stage_a",
        timestamp: "2026-06-01T10:00:00.000Z",
        metadata: { note_type: "plan", agent: "Writer Agent", summary: "Outline first.", confidence: "high", visibility: "user_safe" },
      }),
    ]);
    expect(notes).toEqual([
      { id: "n1", nodeId: "stage_a", noteType: "plan", agent: "Writer Agent", summary: "Outline first.", confidence: "high" },
    ]);
  });

  it("ignores every other event type", () => {
    const notes = extractAgentNotes([
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "model_call_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:01.000Z" }),
    ]);
    expect(notes).toEqual([]);
  });

  it("drops notes without node_id", () => {
    const notes = extractAgentNotes([
      makeEvent({
        event_id: "n1",
        event_type: "agent_note_recorded",
        timestamp: "2026-06-01T10:00:00.000Z",
        metadata: { note_type: "plan", summary: "Orphan note.", visibility: "user_safe" },
      }),
    ]);
    expect(notes).toEqual([]);
  });

  it("drops notes whose visibility is not exactly 'user_safe'", () => {
    const notes = extractAgentNotes([
      makeEvent({
        event_id: "n1",
        event_type: "agent_note_recorded",
        node_id: "stage_a",
        timestamp: "2026-06-01T10:00:00.000Z",
        metadata: { note_type: "plan", summary: "Should not render.", visibility: "internal_only" },
      }),
      makeEvent({
        event_id: "n2",
        event_type: "agent_note_recorded",
        node_id: "stage_a",
        timestamp: "2026-06-01T10:00:01.000Z",
        metadata: { note_type: "plan", summary: "Missing visibility entirely." },
      }),
    ]);
    expect(notes).toEqual([]);
  });

  it("drops malformed metadata without throwing (unknown note_type, empty summary, missing summary)", () => {
    expect(() =>
      extractAgentNotes([
        makeEvent({
          event_id: "n1",
          event_type: "agent_note_recorded",
          node_id: "stage_a",
          timestamp: "2026-06-01T10:00:00.000Z",
          metadata: { note_type: "hidden_chain_of_thought", summary: "x", visibility: "user_safe" },
        }),
        makeEvent({
          event_id: "n2",
          event_type: "agent_note_recorded",
          node_id: "stage_a",
          timestamp: "2026-06-01T10:00:01.000Z",
          metadata: { note_type: "plan", summary: "", visibility: "user_safe" },
        }),
        makeEvent({
          event_id: "n3",
          event_type: "agent_note_recorded",
          node_id: "stage_a",
          timestamp: "2026-06-01T10:00:02.000Z",
        }),
      ]),
    ).not.toThrow();

    const notes = extractAgentNotes([
      makeEvent({
        event_id: "n1",
        event_type: "agent_note_recorded",
        node_id: "stage_a",
        timestamp: "2026-06-01T10:00:00.000Z",
        metadata: { note_type: "hidden_chain_of_thought", summary: "x", visibility: "user_safe" },
      }),
    ]);
    expect(notes).toEqual([]);
  });

  it("returns an empty array for an empty run", () => {
    expect(extractAgentNotes([])).toEqual([]);
  });
});

describe("groupAgentNotesByType", () => {
  it("groups notes by note_type, preserving order within each group", () => {
    const grouped = groupAgentNotesByType([
      { id: "n1", nodeId: "s1", noteType: "plan", summary: "First plan." },
      { id: "n2", nodeId: "s1", noteType: "risk", summary: "A risk." },
      { id: "n3", nodeId: "s1", noteType: "plan", summary: "Second plan." },
    ]);
    expect(grouped.get("plan")?.map((n) => n.id)).toEqual(["n1", "n3"]);
    expect(grouped.get("risk")?.map((n) => n.id)).toEqual(["n2"]);
    expect(grouped.get("decision")).toBeUndefined();
  });
});
