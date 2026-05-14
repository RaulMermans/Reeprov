import type { Finding, ProjectType } from "@/lib/scanner/types";

export interface RecommendationContext {
  projectType: ProjectType;
}

// Inventory recommendation wording by project type.
function inventoryRecommendation(projectType: ProjectType): string {
  switch (projectType) {
    case "agent_system":
      return "Add agents.yaml to map each agent to prompts, tools, evals, permissions, and review requirements.";
    case "workflow_system":
      return "Add workflow.yaml to document stages, tools, state, evals, retries, and safety gates.";
    case "hybrid_workflow_agent":
      return "Add agents.yaml and workflow.yaml, or a unified manifest, to map agent/workflow boundaries, tools, evals, and safety policies.";
    case "ai_application":
      return "If this project contains agent-like or workflow-like behavior, add agents.yaml or workflow.yaml. Otherwise, document AI model calls, prompts, tools, and evals in an ai-system.yaml inventory.";
    case "unknown_ai_project":
      return "Add an AI system manifest only if this repository contains AI agents, workflows, or model-powered features.";
  }
}

// Phrases that indicate an inventory-type recommendation.
const inventoryPhrases = [
  "agents.yaml",
  "workflow.yaml",
  "agent inventory",
  "workflow inventory",
  "agent or workflow boundaries",
  "agent/workflow boundaries",
  "inventory",
  "ai-system.yaml",
];

// Phrases that indicate a prompt storage recommendation.
const promptPhrases = [
  "prompts/",
  "prompt_path",
  "prompt file",
  "versioned prompt",
  "prompt asset",
];

// Phrases that indicate an eval recommendation.
const evalPhrases = [
  "eval case",
  "eval suite",
  "dedicated ai eval",
  "evals for",
  "add eval",
  "add tests",
  "grounding, refusal",
  "refusal behavior",
];

function matchesPhrases(rec: string, phrases: string[]): boolean {
  const lower = rec.toLowerCase();
  return phrases.some((p) => lower.includes(p));
}

export function buildRecommendations(
  findings: Finding[],
  context: RecommendationContext,
): string[] {
  const actionable = findings.filter((f) => f.severity !== "info");

  // Secret-rotation findings collapse into one recommendation.
  const secretRotation = actionable.filter((f) =>
    f.recommendation.toLowerCase().includes("rotate"),
  );
  const other = actionable.filter(
    (f) => !f.recommendation.toLowerCase().includes("rotate"),
  );

  const deduped: string[] = [];

  // 1. Collapsed secret recommendation.
  if (secretRotation.length === 1) {
    deduped.push(secretRotation[0].recommendation);
  } else if (secretRotation.length > 1) {
    deduped.push(
      `Review and rotate any confirmed secret-like values flagged in ${secretRotation.length} files.`,
    );
  }

  // 2. De-duplicate other recommendations, collapsing inventory and structural overlaps.
  let inventoryAdded = false;
  let promptAdded = false;
  let evalAdded = false;
  const seen = new Set<string>(deduped);

  for (const f of other) {
    const rec = f.recommendation;

    // Collapse all inventory recommendations into one project-type-aware version.
    if (matchesPhrases(rec, inventoryPhrases)) {
      if (!inventoryAdded) {
        const projectRec = inventoryRecommendation(context.projectType);
        if (!seen.has(projectRec)) {
          seen.add(projectRec);
          deduped.push(projectRec);
        }
        inventoryAdded = true;
      }
      continue;
    }

    // Collapse prompt storage recommendations.
    if (matchesPhrases(rec, promptPhrases)) {
      if (!promptAdded) {
        if (!seen.has(rec)) {
          seen.add(rec);
          deduped.push(rec);
          promptAdded = true;
        }
      }
      continue;
    }

    // Collapse eval recommendations.
    if (matchesPhrases(rec, evalPhrases)) {
      if (!evalAdded) {
        if (!seen.has(rec)) {
          seen.add(rec);
          deduped.push(rec);
          evalAdded = true;
        }
      }
      continue;
    }

    if (!seen.has(rec)) {
      seen.add(rec);
      deduped.push(rec);
    }
  }

  return deduped.slice(0, 6);
}
