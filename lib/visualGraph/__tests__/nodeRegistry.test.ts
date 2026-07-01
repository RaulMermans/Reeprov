/**
 * Tests for the Visual Execution Canvas node type registry.
 *
 * Verifies every VisualNodeType/VisualNodeStatus has a registry entry, and
 * that evidence-count labels are always readable words ("CLI 2", "Tools 1")
 * — never single-letter abbreviations like "m", "t", "e", "sk", "$", "a".
 */

import { describe, expect, it } from "vitest";
import {
  VISUAL_NODE_REGISTRY,
  VISUAL_STATUS_REGISTRY,
  evidenceCountLabel,
  visualNodeStatusDefinition,
  visualNodeTypeDefinition,
} from "@/lib/visualGraph/nodeRegistry";
import type { VisualNodeStatus, VisualNodeType } from "@/lib/visualGraph/types";

const ALL_NODE_TYPES: VisualNodeType[] = [
  "stage",
  "agent",
  "model",
  "tool",
  "skill",
  "cli",
  "eval",
  "artifact",
  "issue",
  "recovery",
];

const ALL_STATUSES: VisualNodeStatus[] = ["not_observed", "running", "completed", "warning", "failed", "recovered"];

describe("VISUAL_NODE_REGISTRY coverage", () => {
  it.each(ALL_NODE_TYPES)("has a registry entry for node type '%s'", (type) => {
    const def = visualNodeTypeDefinition(type);
    expect(def).toBeDefined();
    expect(def.type).toBe(type);
    expect(def.icon).toBeDefined();
    expect(def.label.length).toBeGreaterThan(0);
    expect(def.pluralLabel.length).toBeGreaterThan(0);
  });

  it("has exactly the 10 sprint-suggested node types and no extras", () => {
    expect(Object.keys(VISUAL_NODE_REGISTRY).sort()).toEqual([...ALL_NODE_TYPES].sort());
  });

  it("labels CLI as 'CLI', never '$'", () => {
    const def = visualNodeTypeDefinition("cli");
    expect(def.label).toBe("CLI");
    expect(def.pluralLabel).toBe("CLI");
    expect(def.label).not.toBe("$");
  });

  it("groups stage and agent as primary; everything else as evidence", () => {
    expect(visualNodeTypeDefinition("stage").inspectorGroup).toBe("primary");
    expect(visualNodeTypeDefinition("agent").inspectorGroup).toBe("primary");
    for (const type of ALL_NODE_TYPES) {
      if (type === "stage" || type === "agent") continue;
      expect(visualNodeTypeDefinition(type).inspectorGroup).toBe("evidence");
    }
  });
});

describe("VISUAL_STATUS_REGISTRY coverage", () => {
  it.each(ALL_STATUSES)("has a registry entry for status '%s'", (status) => {
    const def = visualNodeStatusDefinition(status);
    expect(def).toBeDefined();
    expect(def.label.length).toBeGreaterThan(0);
  });

  it("has exactly the 6 sprint-suggested statuses and no extras", () => {
    expect(Object.keys(VISUAL_STATUS_REGISTRY).sort()).toEqual([...ALL_STATUSES].sort());
  });
});

describe("evidenceCountLabel — readable attachment labels", () => {
  it("produces a readable plural label with the count, never an abbreviation", () => {
    expect(evidenceCountLabel("model", 3)).toBe("Models 3");
    expect(evidenceCountLabel("tool", 2)).toBe("Tools 2");
    expect(evidenceCountLabel("eval", 1)).toBe("Evals 1");
    expect(evidenceCountLabel("skill", 4)).toBe("Skills 4");
    expect(evidenceCountLabel("cli", 2)).toBe("CLI 2");
    expect(evidenceCountLabel("artifact", 1)).toBe("Artifacts 1");
    expect(evidenceCountLabel("issue", 5)).toBe("Issues 5");
  });

  const FORBIDDEN_ABBREVIATIONS = ["m ", "t ", "e ", "sk ", "$ ", "a "];

  it("never emits single-letter/symbol abbreviations for any evidence type", () => {
    for (const type of ALL_NODE_TYPES) {
      const label = evidenceCountLabel(type, 1);
      for (const forbidden of FORBIDDEN_ABBREVIATIONS) {
        expect(label.toLowerCase().startsWith(forbidden)).toBe(false);
      }
      expect(label).not.toMatch(/^\$/);
    }
  });
});
