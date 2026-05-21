import type { DetectedAgent, DetectedWorkflow, GraphCompletenessMetrics } from "./types";

// Compute how well agents, workflows, prompts, tools, and evals are mapped
// to each other. Rewards explicit relationships, not raw artifact counts.
//
// A repo with 10 detected tools but zero tools mapped to any agent should
// score low here even if it scores well on tool count alone.

export function computeGraphCompleteness(
  agents: DetectedAgent[],
  workflows: DetectedWorkflow[],
  totalPrompts: number,
  totalTools: number,
  totalEvals: number,
): GraphCompletenessMetrics {
  // Only manifest agents have meaningful mapped relationships.
  // agent_file and inferred_candidate agents do not have manifest-mapped paths/tools/evals.
  const manifestAgents = agents.filter((a) => a.displayKind === "manifest");
  const totalManifestAgents = manifestAgents.length;

  // Mapped = at least one attribute linked (prompt, tool, or eval).
  const mappedAgents = manifestAgents.filter(
    (a) => a.promptPaths.length > 0 || a.toolNames.length > 0 || a.evalPaths.length > 0,
  ).length;

  const agentsWithPrompts = manifestAgents.filter((a) => a.promptPaths.length > 0).length;
  const agentsWithEvals = manifestAgents.filter((a) => a.evalPaths.length > 0).length;

  // Prompts explicitly referenced by agent manifests.
  const referencedPrompts = new Set(agents.flatMap((a) => a.promptPaths)).size;
  const mappedPrompts = Math.min(referencedPrompts, totalPrompts);

  // Tools explicitly referenced by agent manifests.
  const referencedTools = new Set(agents.flatMap((a) => a.toolNames)).size;
  const mappedTools = Math.min(referencedTools, totalTools);

  // Evals explicitly referenced by agent manifests.
  const referencedEvals = new Set(agents.flatMap((a) => a.evalPaths)).size;
  const mappedEvals = Math.min(referencedEvals, totalEvals);

  // Workflow stage counts — only for explicit workflows with defined stages.
  const explicitWorkflows = workflows.filter((w) => w.source === "explicit");
  const totalWorkflowSteps = explicitWorkflows.reduce(
    (sum, w) => sum + (w.stages?.length ?? 0),
    0,
  );
  // Stages that have at least tool or eval coverage at the workflow level.
  const stepsWithAgent = totalManifestAgents > 0 ? totalWorkflowSteps : 0;
  const stepsWithModel = 0; // model tracking not yet in manifest schema
  const stepsWithEval = explicitWorkflows.reduce(
    (sum, w) => sum + (w.evals && w.evals.length > 0 ? (w.stages?.length ?? 1) : 0),
    0,
  );

  const completenessScore = weightedCompletenessScore({
    mappedAgents,
    totalManifestAgents,
    mappedPrompts,
    totalPrompts,
    mappedTools,
    totalTools,
    mappedEvals,
    totalEvals,
  });

  return {
    mappedAgents,
    totalAgents: totalManifestAgents,
    mappedPrompts,
    totalPrompts,
    mappedTools,
    totalTools,
    mappedEvals,
    totalEvals,
    workflowStepsWithAgent: stepsWithAgent,
    totalWorkflowSteps,
    workflowStepsWithPrompt: agentsWithPrompts,
    workflowStepsWithModel: stepsWithModel,
    workflowStepsWithEval: agentsWithEvals,
    completenessScore,
  };
}

// ── Scoring ────────────────────────────────────────────────────────────────────

// Ratio helper: if no items exist, return 1.0 (no penalty for no items).
// The penalty comes from having zero mappings despite having items.
function ratio(mapped: number, total: number): number {
  if (total === 0) return 1.0;
  return Math.min(1.0, mapped / total);
}

function weightedCompletenessScore(m: {
  mappedAgents: number;
  totalManifestAgents: number;
  mappedPrompts: number;
  totalPrompts: number;
  mappedTools: number;
  totalTools: number;
  mappedEvals: number;
  totalEvals: number;
}): number {
  // Weights: agents matter most (they are the integration point),
  // then prompts (quality signal), tools, evals.
  const weights = {
    agents: 0.35,
    prompts: 0.25,
    tools: 0.20,
    evals: 0.20,
  };

  const agentRatio = ratio(m.mappedAgents, m.totalManifestAgents);
  const promptRatio = ratio(m.mappedPrompts, m.totalPrompts);
  const toolRatio = ratio(m.mappedTools, m.totalTools);
  const evalRatio = ratio(m.mappedEvals, m.totalEvals);

  const score =
    agentRatio * weights.agents +
    promptRatio * weights.prompts +
    toolRatio * weights.tools +
    evalRatio * weights.evals;

  return Math.round(score * 100);
}
