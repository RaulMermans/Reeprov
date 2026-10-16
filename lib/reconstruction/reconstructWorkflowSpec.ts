/**
 * lib/reconstruction/reconstructWorkflowSpec.ts
 *
 * Reconstructs a best-effort proof-layer WorkflowSpec + StaticProofReconstruction
 * from a static ScanReport.
 *
 * Rules (highest to lowest precedence):
 *   1. Explicit manifests (workflow.yaml, agents.yaml, etc.)    → high confidence
 *   2. Workflow files/directories or framework patterns          → medium confidence
 *   3. Scattered agents/prompts/tools, no workflow structure     → low confidence
 *
 * Does not execute code, call external APIs, or modify the scanned repo.
 */

import { randomBytes } from "node:crypto";
import type { ScanReport, DetectedAgent, DetectedWorkflow, WorkflowStage } from "@/lib/scanner/types";
import type {
  StaticProofReconstruction,
  SuggestedWorkflowSpec,
  MappingSummary,
  MissingLink,
  MissingLinkType,
  SuggestedManifestFile,
  InstrumentationPlan,
  ReconstructedSystemGraph,
  ReconstructedNode,
  ReconstructedEdge,
  ReconstructionConfidence,
} from "./types";
import { generateSuggestedFiles } from "./suggestedFiles";
import { staticProofReconstructionSchema } from "./schema";

// ── ID helpers ─────────────────────────────────────────────────────────────────

function reconstructionId(): string {
  return `recon_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
}

function missingLinkId(type: MissingLinkType, targetId: string): string {
  return `ml::${type}::${targetId}`;
}

// ── Evidence detection ─────────────────────────────────────────────────────────

/**
 * Returns true when the scan report contains enough AI/workflow evidence to
 * justify producing a static proof reconstruction.
 *
 * A reconstruction must NOT be generated when the only signals come from:
 *   - CI workflows alone
 *   - Generic tests
 *   - Package files
 *   - README mentions of AI without artifacts
 *   - SVG/assets named "agent"
 *   - assistant tooling (.claude/**, .cursor/**) by itself
 *
 * Evidence (any one is sufficient):
 *   - manifest agents (displayKind=manifest) or agent files
 *   - product workflow manifests in detectedWorkflowsDetailed
 *   - product prompts / tools / evals / models
 *   - system graph nodes that include agent/workflow/prompt/tool/model entities
 *   - projectType of agent_system / workflow_system / hybrid_workflow_agent
 *   - ai_application projectType combined with at least one AI artifact
 */
export function hasStaticProofEvidence(report: ScanReport): boolean {
  if (report.detectedWorkflowsDetailed.length > 0) return true;

  if (report.detectedAgents.length > 0) return true;

  if (report.detectedPrompts.length > 0) return true;

  if (report.detectedTools.length > 0) return true;

  if (report.detectedEvals.length > 0) return true;

  if ((report.detectedModels?.length ?? 0) > 0) return true;

  // System graph from the scanner — only treat as evidence if it contains
  // meaningful product nodes (not just assistant tooling or CI).
  const graphNodes = report.systemGraph?.nodes ?? [];
  const meaningfulGraphNode = graphNodes.find((n) => {
    if (n.scope === "assistant_tooling" || n.scope === "ci") return false;
    return (
      n.type === "agent" ||
      n.type === "workflow" ||
      n.type === "workflow_step" ||
      n.type === "prompt" ||
      n.type === "tool" ||
      n.type === "model" ||
      n.type === "eval"
    );
  });
  if (meaningfulGraphNode) return true;

  // Strict project types that imply AI structure regardless of artifact lists.
  if (
    report.projectType === "agent_system" ||
    report.projectType === "workflow_system" ||
    report.projectType === "hybrid_workflow_agent"
  ) {
    return true;
  }

  // ai_application only counts as evidence when paired with at least one
  // concrete AI artifact — but we already returned true above for any of
  // those. So lone ai_application classification with no artifacts is not
  // evidence on its own.

  return false;
}

// ── Confidence determination ────────────────────────────────────────────────────

function determineConfidence(report: ScanReport): ReconstructionConfidence {
  const hasExplicitWorkflowManifest = report.detectedWorkflowsDetailed.some(
    (w) => w.source === "explicit" && w.confidence === "high",
  );
  if (hasExplicitWorkflowManifest) return "high";

  const hasWorkflowFiles =
    report.detectedWorkflows.length > 0 ||
    report.detectedWorkflowsDetailed.some((w) => w.confidence === "medium");
  const hasManifestAgents = report.detectedAgents.some(
    (a) => a.displayKind === "manifest" && a.confidence === "high",
  );
  if (hasWorkflowFiles || hasManifestAgents) return "medium";

  return "low";
}

// ── WorkflowSpec construction ──────────────────────────────────────────────────

function inferArchitectureType(
  report: ScanReport,
): SuggestedWorkflowSpec["architecture_type"] {
  if (report.projectType === "hybrid_workflow_agent") return "hybrid_workflow_agent";
  if (report.projectType === "workflow_system") {
    const hasMultipleAgents = report.detectedAgents.length > 1;
    return hasMultipleAgents ? "multi_agent" : "deterministic_workflow";
  }
  if (report.projectType === "agent_system") {
    const hasMultiple = report.detectedAgents.length > 1;
    return hasMultiple ? "multi_agent" : "single_agent";
  }
  // ai_application or unknown
  return "single_llm_call";
}

function buildNodesFromWorkflow(workflow: DetectedWorkflow): SuggestedWorkflowSpec["nodes"] {
  const nodes: SuggestedWorkflowSpec["nodes"] = [];

  // Add a trigger node.
  nodes.push({
    id: "trigger",
    type: "trigger",
    label: "Trigger",
    description: `Entry point for ${workflow.name}`,
  });

  // Add nodes from stages.
  if (workflow.stagesDetailed && workflow.stagesDetailed.length > 0) {
    for (const stage of workflow.stagesDetailed) {
      const hasModel = Boolean(stage.model || stage.agent);
      nodes.push({
        id: stage.id,
        type: hasModel ? "llm" : "deterministic",
        label: stage.name ?? stage.id,
        description: stage.agent ? `Agent: ${stage.agent}` : undefined,
        model_provider: stage.model?.provider,
        model_name: stage.model?.name,
        allowed_tools: stage.tools?.length ? stage.tools : undefined,
        eval_refs: stage.evals?.length ? stage.evals : undefined,
        permission_class: stage.approvalGate ? "external_side_effect" : undefined,
      });

      // Add approval gate if flagged.
      if (stage.approvalGate) {
        nodes.push({
          id: `${stage.id}-approval`,
          type: "approval",
          label: `Approve: ${stage.name ?? stage.id}`,
        });
      }
    }
  } else if (workflow.stages && workflow.stages.length > 0) {
    // stages is just string IDs
    for (const stageId of workflow.stages) {
      nodes.push({
        id: stageId,
        type: "llm",
        label: stageId
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase()),
      });
    }
  }

  // Add artifact node if declared.
  if (workflow.artifacts && workflow.artifacts.length > 0) {
    nodes.push({
      id: "artifact-output",
      type: "artifact",
      label: "Output Artifact",
    });
  }

  return nodes;
}

function buildEdgesFromNodes(
  nodes: SuggestedWorkflowSpec["nodes"],
): Array<{ from: string; to: string; condition?: string }> {
  const edges: Array<{ from: string; to: string; condition?: string }> = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const curr = nodes[i];
    const next = nodes[i + 1];
    if (curr && next) {
      edges.push({ from: curr.id, to: next.id });
    }
  }
  return edges;
}

function buildWorkflowSpecFromDetected(
  workflow: DetectedWorkflow,
  report: ScanReport,
): SuggestedWorkflowSpec {
  const evidencePaths: string[] = [];
  if (workflow.configPath) evidencePaths.push(workflow.configPath);

  const missingFields: string[] = [];
  const recommendations: string[] = [];

  const nodes = buildNodesFromWorkflow(workflow);
  const edges = buildEdgesFromNodes(nodes);

  if (nodes.length <= 1) {
    missingFields.push("nodes");
    recommendations.push("Add stage/node declarations to your workflow manifest.");
  }

  if (!workflow.evals?.length) {
    missingFields.push("evals");
    recommendations.push("Map evals to workflow stages for quality assurance.");
  }

  const hasModels = nodes.some((n) => n.model_provider);
  if (!hasModels) {
    missingFields.push("model_provider");
    recommendations.push(
      "Declare model provider and name for each LLM stage (e.g. model: { provider: openai, name: gpt-4o }).",
    );
  }

  const allTools = workflow.tools ?? nodes.flatMap((n) => n.allowed_tools ?? []);
  const evals = workflow.evals ?? nodes.flatMap((n) => n.eval_refs ?? []);

  // Determine source based on workflow confidence.
  const source: SuggestedWorkflowSpec["source"] =
    workflow.source === "explicit" && workflow.confidence === "high"
      ? "manifest"
      : workflow.source === "explicit"
        ? "path_inference"
        : "path_inference";

  const confidence: ReconstructionConfidence =
    workflow.confidence === "high"
      ? "high"
      : workflow.confidence === "medium"
        ? "medium"
        : "low";

  // Collect approval gates.
  const approvalGateNodes = nodes
    .filter((n) => n.type === "approval")
    .map((n) => n.id);

  // Collect artifacts.
  const artifactNodes = nodes.filter((n) => n.type === "artifact").map((n) => n.id);
  const workflowArtifacts = workflow.artifacts ?? [];
  const allArtifacts = [...new Set([...artifactNodes, ...workflowArtifacts])];

  const spec: SuggestedWorkflowSpec = {
    workflow_id: workflow.id,
    name: workflow.name,
    version: "1.0.0",
    description: `Reconstructed from static scan of ${report.repoName}. Source: ${workflow.configPath ?? "inferred"}.`,
    architecture_type: inferArchitectureType(report),
    nodes,
    edges: edges.length > 0 ? edges : undefined,
    allowed_tools: allTools.length > 0 ? allTools : undefined,
    evals: evals.length > 0 ? evals : undefined,
    approval_gates: approvalGateNodes.length > 0 ? approvalGateNodes : undefined,
    artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
    source,
    confidence,
    evidencePaths,
    missingFields,
    recommendations,
  };

  return spec;
}

function buildWorkflowSpecFromAgents(
  agents: DetectedAgent[],
  report: ScanReport,
): SuggestedWorkflowSpec {
  const evidencePaths: string[] = agents
    .map((a) => a.configPath)
    .filter((p): p is string => Boolean(p));

  const missingFields: string[] = [];
  const recommendations: string[] = [];

  // Build nodes from agents.
  const triggerNode: SuggestedWorkflowSpec["nodes"][number] = {
    id: "trigger",
    type: "trigger",
    label: "Trigger",
  };

  const agentNodes: SuggestedWorkflowSpec["nodes"] = agents.map((agent) => ({
    id: agent.id,
    type: "agent" as const,
    label: agent.name,
    description: agent.configPath ? `Source: ${agent.configPath}` : undefined,
    model_provider: agent.model?.provider,
    model_name: agent.model?.name,
    allowed_tools: agent.toolNames.length > 0 ? agent.toolNames : undefined,
    eval_refs: agent.evalPaths.length > 0 ? agent.evalPaths : undefined,
  }));

  if (agentNodes.length === 0) {
    missingFields.push("nodes");
    recommendations.push("No agent definitions found. Add an agents.yaml manifest.");
  }

  const hasModels = agentNodes.some((n) => n.model_provider);
  if (!hasModels) {
    missingFields.push("model_provider");
    recommendations.push(
      "Declare model provider for each agent (e.g. model: { provider: openai, name: gpt-4o }).",
    );
  }

  const allNodes = [triggerNode, ...agentNodes];
  const edges = buildEdgesFromNodes(allNodes);

  const confidence: ReconstructionConfidence =
    agents.some((a) => a.confidence === "high")
      ? "medium"
      : "low";

  return {
    workflow_id: `${report.projectId}-inferred`,
    name: `${report.repoName} — Inferred AI System`,
    version: "1.0.0",
    description: `Best-effort reconstruction from static scan. No explicit workflow manifest found.`,
    architecture_type: inferArchitectureType(report),
    nodes: allNodes,
    edges: edges.length > 0 ? edges : undefined,
    source: "path_inference",
    confidence,
    evidencePaths,
    missingFields,
    recommendations: [
      ...recommendations,
      "Add a workflow manifest (workflow.yaml) to improve reconstruction confidence.",
    ],
  };
}

// ── MappingSummary ─────────────────────────────────────────────────────────────

function buildMappingSummary(report: ScanReport): MappingSummary {
  const agents = report.detectedAgents;
  const workflows = report.detectedWorkflowsDetailed;
  const prompts = report.detectedPrompts;
  const tools = report.detectedTools;
  const evals = report.detectedEvals;
  const models = report.detectedModels ?? [];

  // Agent mapping counts.
  const agentMappedToPrompts = agents.filter((a) => a.promptPaths.length > 0).length;
  const agentMappedToTools = agents.filter((a) => a.toolNames.length > 0).length;
  const agentMappedToEvals = agents.filter((a) => a.evalPaths.length > 0).length;
  const agentMappedToModels = agents.filter((a) => Boolean(a.model?.provider)).length;

  // Workflow mapping counts.
  const workflowsWithStages = workflows.filter(
    (w) => (w.stagesDetailed?.length ?? 0) > 0 || (w.stages?.length ?? 0) > 0,
  ).length;

  const allStages: WorkflowStage[] = workflows.flatMap(
    (w) => w.stagesDetailed ?? [],
  );
  const totalStages = allStages.length;

  const stagesMappedToAgents = allStages.filter((s) => Boolean(s.agent)).length;
  const stagesMappedToPrompts = allStages.filter((s) => Boolean(s.prompt)).length;
  const stagesMappedToTools = allStages.filter((s) => (s.tools?.length ?? 0) > 0).length;
  const stagesMappedToEvals = allStages.filter((s) => (s.evals?.length ?? 0) > 0).length;
  const stagesMappedToModels = allStages.filter((s) => Boolean(s.model)).length;

  // Prompt mapping: check which prompt paths appear in agent promptPaths or workflow stages.
  const mappedPromptPaths = new Set<string>();
  for (const agent of agents) {
    for (const p of agent.promptPaths) mappedPromptPaths.add(p);
  }
  for (const stage of allStages) {
    if (stage.prompt) mappedPromptPaths.add(stage.prompt);
  }
  const promptsMapped = prompts.filter((p) => mappedPromptPaths.has(p)).length;

  // Tool mapping: tools that appear in agent toolNames or workflow stages.
  const mappedToolNames = new Set<string>();
  for (const agent of agents) {
    for (const t of agent.toolNames) mappedToolNames.add(t);
  }
  for (const stage of allStages) {
    for (const t of stage.tools ?? []) mappedToolNames.add(t);
  }
  const toolsMapped = tools.filter((t) => mappedToolNames.has(t)).length;

  // Evals mapping.
  const mappedEvalPaths = new Set<string>();
  for (const agent of agents) {
    for (const e of agent.evalPaths) mappedEvalPaths.add(e);
  }
  for (const stage of allStages) {
    for (const e of stage.evals ?? []) mappedEvalPaths.add(e);
  }
  const evalsMapped = evals.filter((e) => mappedEvalPaths.has(e)).length;

  // Model mapping.
  const mappedModelIds = new Set<string>();
  for (const agent of agents) {
    if (agent.model?.provider) {
      mappedModelIds.add(`${agent.model.provider}:${agent.model.name ?? "unknown"}`);
    }
  }
  const modelsMapped = models.filter(
    (m) => m.mappedAgentIds && m.mappedAgentIds.length > 0,
  ).length;

  // Tool permissions.
  // We don't have permission class data directly on tool names, so check system graph.
  const graphNodes = report.systemGraph?.nodes ?? [];
  const toolNodes = graphNodes.filter((n) => n.type === "tool");
  const toolsWithPermission = toolNodes.filter(
    (n) => n.metadata?.["permission_class"],
  ).length;

  return {
    agents: {
      total: agents.length,
      mappedToPrompts: agentMappedToPrompts,
      mappedToTools: agentMappedToTools,
      mappedToEvals: agentMappedToEvals,
      mappedToModels: agentMappedToModels,
    },
    workflows: {
      total: workflows.length,
      withStages: workflowsWithStages,
      stagesMappedToAgents: totalStages > 0 ? stagesMappedToAgents : 0,
      stagesMappedToPrompts: totalStages > 0 ? stagesMappedToPrompts : 0,
      stagesMappedToTools: totalStages > 0 ? stagesMappedToTools : 0,
      stagesMappedToEvals: totalStages > 0 ? stagesMappedToEvals : 0,
      stagesMappedToModels: totalStages > 0 ? stagesMappedToModels : 0,
    },
    prompts: {
      total: prompts.length,
      mapped: promptsMapped,
      unmapped: prompts.length - promptsMapped,
    },
    tools: {
      total: tools.length,
      mapped: toolsMapped,
      withPermissionClass: toolsWithPermission,
      requiringApproval: 0, // would need richer tool registry data
    },
    evals: {
      total: evals.length,
      mapped: evalsMapped,
      unmapped: evals.length - evalsMapped,
    },
    models: {
      total: models.length,
      mapped: modelsMapped,
      unmapped: models.length - modelsMapped,
    },
  };
}

// ── MissingLinks ───────────────────────────────────────────────────────────────

function buildMissingLinks(report: ScanReport): MissingLink[] {
  const links: MissingLink[] = [];

  for (const agent of report.detectedAgents) {
    if (agent.promptPaths.length === 0) {
      links.push({
        id: missingLinkId("agent_missing_prompt", agent.id),
        severity: "medium",
        type: "agent_missing_prompt",
        targetId: agent.id,
        targetLabel: agent.name,
        evidencePaths: agent.configPath ? [agent.configPath] : [],
        recommendation: `Map prompt file(s) to agent "${agent.name}" in your agents.yaml.`,
      });
    }
    if (agent.toolNames.length === 0 && report.detectedTools.length > 0) {
      links.push({
        id: missingLinkId("agent_missing_tools", agent.id),
        severity: "low",
        type: "agent_missing_tools",
        targetId: agent.id,
        targetLabel: agent.name,
        evidencePaths: agent.configPath ? [agent.configPath] : [],
        recommendation: `List the tools used by agent "${agent.name}" in your agents.yaml.`,
      });
    }
    if (agent.evalPaths.length === 0 && report.detectedEvals.length > 0) {
      links.push({
        id: missingLinkId("agent_missing_evals", agent.id),
        severity: "medium",
        type: "agent_missing_evals",
        targetId: agent.id,
        targetLabel: agent.name,
        evidencePaths: agent.configPath ? [agent.configPath] : [],
        recommendation: `Map eval files to agent "${agent.name}" in your agents.yaml.`,
      });
    }
    if (!agent.model?.provider) {
      links.push({
        id: missingLinkId("agent_missing_model", agent.id),
        severity: "medium",
        type: "agent_missing_model",
        targetId: agent.id,
        targetLabel: agent.name,
        evidencePaths: agent.configPath ? [agent.configPath] : [],
        recommendation: `Declare model.provider and model.name for agent "${agent.name}".`,
      });
    }
  }

  for (const workflow of report.detectedWorkflowsDetailed) {
    const hasStages =
      (workflow.stagesDetailed?.length ?? 0) > 0 || (workflow.stages?.length ?? 0) > 0;
    if (!hasStages) {
      links.push({
        id: missingLinkId("workflow_missing_stages", workflow.id),
        severity: "medium",
        type: "workflow_missing_stages",
        targetId: workflow.id,
        targetLabel: workflow.name,
        evidencePaths: workflow.configPath ? [workflow.configPath] : [],
        recommendation: `Add stage/step declarations to your workflow manifest for "${workflow.name}".`,
      });
    }

    for (const stage of workflow.stagesDetailed ?? []) {
      if (!stage.model?.provider && report.detectedModels?.length === 0) {
        links.push({
          id: missingLinkId("stage_missing_model", `${workflow.id}::${stage.id}`),
          severity: "low",
          type: "stage_missing_model",
          targetId: `${workflow.id}::${stage.id}`,
          targetLabel: `${workflow.name} → ${stage.name ?? stage.id}`,
          evidencePaths: workflow.configPath ? [workflow.configPath] : [],
          recommendation: `Declare model provider for stage "${stage.name ?? stage.id}" in "${workflow.name}".`,
        });
      }
    }
  }

  // Unmapped prompts.
  const mappedPrompts = new Set<string>();
  for (const agent of report.detectedAgents) {
    for (const p of agent.promptPaths) mappedPrompts.add(p);
  }
  for (const promptPath of report.detectedPrompts) {
    if (!mappedPrompts.has(promptPath)) {
      links.push({
        id: missingLinkId("prompt_unmapped", promptPath),
        severity: "info",
        type: "prompt_unmapped",
        targetId: promptPath,
        targetLabel: promptPath,
        evidencePaths: [promptPath],
        recommendation: `Map prompt "${promptPath}" to an agent or workflow stage.`,
      });
    }
  }

  // Unmapped evals.
  const mappedEvals = new Set<string>();
  for (const agent of report.detectedAgents) {
    for (const e of agent.evalPaths) mappedEvals.add(e);
  }
  for (const evalPath of report.detectedEvals) {
    if (!mappedEvals.has(evalPath)) {
      links.push({
        id: missingLinkId("eval_unmapped", evalPath),
        severity: "info",
        type: "eval_unmapped",
        targetId: evalPath,
        targetLabel: evalPath,
        evidencePaths: [evalPath],
        recommendation: `Map eval "${evalPath}" to an agent or workflow stage.`,
      });
    }
  }

  // Unmapped models.
  const models = report.detectedModels ?? [];
  for (const model of models) {
    if (!model.mappedAgentIds || model.mappedAgentIds.length === 0) {
      links.push({
        id: missingLinkId("model_unmapped", model.id),
        severity: "info",
        type: "model_unmapped",
        targetId: model.id,
        targetLabel: `${model.provider}${model.model ? ` / ${model.model}` : ""}`,
        evidencePaths: [model.sourcePath],
        recommendation: `Assign model "${model.id}" to a specific agent or stage.`,
      });
    }
  }

  // Deduplicate by id.
  const seen = new Set<string>();
  return links.filter((l) => {
    if (seen.has(l.id)) return false;
    seen.add(l.id);
    return true;
  });
}

// ── ReconstructedSystemGraph ───────────────────────────────────────────────────

function buildReconstructedGraph(
  workflowSpecs: SuggestedWorkflowSpec[],
  report: ScanReport,
): ReconstructedSystemGraph {
  const nodes: ReconstructedNode[] = [];
  const edges: ReconstructedEdge[] = [];
  const seenNodeIds = new Set<string>();

  function addNode(node: ReconstructedNode) {
    if (!seenNodeIds.has(node.id)) {
      seenNodeIds.add(node.id);
      nodes.push(node);
    }
  }

  // Add workflow + stage nodes from specs.
  for (const spec of workflowSpecs) {
    addNode({
      id: spec.workflow_id,
      label: spec.name,
      type: "workflow",
      confidence: spec.confidence,
      sourcePath: spec.evidencePaths[0],
    });

    for (const node of spec.nodes) {
      const nodeType: ReconstructedNode["type"] =
        node.type === "trigger" || node.type === "llm" || node.type === "agent" || node.type === "deterministic"
          ? "stage"
          : node.type === "approval"
            ? "approval_gate"
            : node.type === "artifact"
              ? "artifact"
              : "stage";

      addNode({
        id: `${spec.workflow_id}::${node.id}`,
        label: node.label,
        type: nodeType,
        confidence: spec.confidence,
        sourcePath: spec.evidencePaths[0],
      });
      edges.push({
        from: spec.workflow_id,
        to: `${spec.workflow_id}::${node.id}`,
        type: "contains_step",
        confidence: spec.confidence,
      });
    }
  }

  // Add agent nodes.
  for (const agent of report.detectedAgents) {
    const confidence: ReconstructionConfidence =
      agent.confidence === "high" ? "high" : agent.confidence === "medium" ? "medium" : "low";
    addNode({
      id: agent.id,
      label: agent.name,
      type: "agent",
      confidence,
      sourcePath: agent.configPath,
    });

    for (const promptPath of agent.promptPaths) {
      const promptId = `prompt::${promptPath}`;
      addNode({ id: promptId, label: promptPath, type: "prompt", confidence: "medium", sourcePath: promptPath });
      edges.push({ from: agent.id, to: promptId, type: "uses_prompt", confidence: "medium" });
    }

    for (const toolName of agent.toolNames) {
      const toolId = `tool::${toolName}`;
      addNode({ id: toolId, label: toolName, type: "tool", confidence: "medium" });
      edges.push({ from: agent.id, to: toolId, type: "calls_tool", confidence: "medium" });
    }

    if (agent.model?.provider) {
      const modelId = `model::${agent.model.provider}::${agent.model.name ?? "unknown"}`;
      addNode({
        id: modelId,
        label: `${agent.model.provider}${agent.model.name ? ` / ${agent.model.name}` : ""}`,
        type: "model",
        confidence: "high",
      });
      edges.push({ from: agent.id, to: modelId, type: "uses_model", confidence: "high" });
    }
  }

  // Add standalone detected prompts not already in agent nodes.
  const agentPromptSet = new Set(report.detectedAgents.flatMap((a) => a.promptPaths));
  for (const promptPath of report.detectedPrompts) {
    if (!agentPromptSet.has(promptPath)) {
      const promptId = `prompt::${promptPath}`;
      addNode({ id: promptId, label: promptPath, type: "prompt", confidence: "low", sourcePath: promptPath });
    }
  }

  // Add standalone evals.
  const agentEvalSet = new Set(report.detectedAgents.flatMap((a) => a.evalPaths));
  for (const evalPath of report.detectedEvals) {
    if (!agentEvalSet.has(evalPath)) {
      const evalId = `eval::${evalPath}`;
      addNode({ id: evalId, label: evalPath, type: "eval", confidence: "low", sourcePath: evalPath });
    }
  }

  return { nodes, edges };
}

// ── InstrumentationPlan ────────────────────────────────────────────────────────

function buildInstrumentationPlan(
  workflowSpecs: SuggestedWorkflowSpec[],
  report: ScanReport,
): InstrumentationPlan {
  const suggestedEvents: InstrumentationPlan["suggestedEvents"] = [];

  for (const spec of workflowSpecs) {
    for (const node of spec.nodes) {
      if (node.type === "trigger") {
        suggestedEvents.push({ stageId: node.id, events: ["run_started"] });
      } else if (node.type === "llm" || node.type === "agent") {
        suggestedEvents.push({
          stageId: node.id,
          events: [
            "node_started",
            "model_call_started",
            "model_call_completed",
            "node_completed",
          ],
        });
      } else if (node.type === "evaluator") {
        suggestedEvents.push({
          stageId: node.id,
          events: ["eval_started", "eval_completed"],
        });
      } else if (node.type === "approval") {
        suggestedEvents.push({
          stageId: node.id,
          events: ["approval_requested", "approval_granted"],
        });
      } else if (node.type === "artifact") {
        suggestedEvents.push({ stageId: node.id, events: ["artifact_created"] });
      } else {
        suggestedEvents.push({
          stageId: node.id,
          events: ["node_started", "node_completed"],
        });
      }
    }
  }

  const codeHints: string[] = [
    "Install/copy Reeprov client: @reeprov/client (or lib/proof-layer/client.ts)",
    "Set REEPROV_URL, REEPROV_INGEST_KEY, REEPROV_PROJECT_ID, REEPROV_WORKFLOW_ID",
    "Call client.startRun() at the start of a workflow execution",
    "Call client.emitEvent() with node_started / node_completed around each major stage",
    "Call client.completeRun() or client.failRun() when the workflow finishes",
    "Instrumentation is opt-in — Reeprov static reconstruction works without it",
  ];

  const hasModels = report.detectedModels && report.detectedModels.length > 0;
  const hasPrompts = report.detectedPrompts.length > 0;

  if (hasModels) {
    codeHints.push("Emit model_call_started/completed events with cost_usd and duration_ms metadata.");
  }
  if (hasPrompts) {
    codeHints.push("Emit node metadata with prompt_ref to track which prompt version was used.");
  }

  return {
    required: false,
    available: true,
    summary:
      "Runtime trace instrumentation is optional. Reeprov's static reconstruction already captures architecture, risks, and gaps from your repo files. " +
      "Add the Reeprov client to your project if you want real execution traces, cost tracking, and eval assertions.",
    recommendedEnvVars: [
      "REEPROV_URL",
      "REEPROV_INGEST_KEY",
      "REEPROV_PROJECT_ID",
      "REEPROV_PROJECT_NAME",
      "REEPROV_WORKFLOW_ID",
      "REEPROV_ENABLED",
    ],
    suggestedEvents: suggestedEvents.slice(0, 20), // cap for large workflows
    codeHints,
  };
}

// ── Main entry point ───────────────────────────────────────────────────────────

/**
 * Reconstruct a best-effort proof-layer structure from a static ScanReport.
 *
 * This is the main function called by the API route and tests.
 * It does not execute code, call external APIs, or modify the scanned repo.
 */
export function reconstructFromScanReport(report: ScanReport): StaticProofReconstruction {
  const evidence = hasStaticProofEvidence(report);

  // No evidence → do NOT invent a fake WorkflowSpec. Return a clearly empty
  // reconstruction with a single explanation-only suggested file.
  if (!evidence) {
    const emptyMappingSummary: MappingSummary = {
      agents: { total: 0, mappedToPrompts: 0, mappedToTools: 0, mappedToEvals: 0, mappedToModels: 0 },
      workflows: {
        total: 0,
        withStages: 0,
        stagesMappedToAgents: 0,
        stagesMappedToPrompts: 0,
        stagesMappedToTools: 0,
        stagesMappedToEvals: 0,
        stagesMappedToModels: 0,
      },
      prompts: { total: 0, mapped: 0, unmapped: 0 },
      tools: { total: 0, mapped: 0, withPermissionClass: 0, requiringApproval: 0 },
      evals: { total: 0, mapped: 0, unmapped: 0 },
      models: { total: 0, mapped: 0, unmapped: 0 },
    };

    const explanationFile: SuggestedManifestFile = {
      path: "no-reconstruction.md",
      format: "markdown",
      purpose: "Explanation — no static proof reconstruction generated",
      content: [
        `# No static proof reconstruction generated`,
        ``,
        `**Repository:** ${report.repoName}`,
        `**Report ID:** ${report.reportId}`,
        `**Project type:** ${report.projectType}`,
        ``,
        `Reeprov did not find enough agent, workflow, prompt, tool, eval, or model evidence`,
        `to generate a proof-layer WorkflowSpec for this repository.`,
        ``,
        `Static proof reconstruction is intentionally **not generated** for repositories with`,
        `no detected AI artifacts. The following signals do NOT count as AI evidence:`,
        ``,
        `- CI workflows (\`.github/workflows/\`)`,
        `- Generic software tests`,
        `- Package configuration files`,
        `- README mentions of AI without concrete artifacts`,
        `- Assistant tooling (\`.claude/\`, \`.cursor/\`, etc.)`,
        ``,
        `To enable reconstruction, add at least one of:`,
        `- An \`agents.yaml\` / \`agents.json\` manifest`,
        `- A \`workflow.yaml\` / \`workflow.json\` manifest`,
        `- A \`/prompts/\` directory with prompt files`,
        `- A \`/tools/\` declaration or agent tool registry`,
        `- A \`/evals/\` suite`,
        ``,
        `This is not a failure — it's the correct outcome when the repository is not an AI system.`,
      ].join("\n"),
    };

    const instrumentationPlan: InstrumentationPlan = {
      required: false,
      available: true,
      summary:
        "No AI workflow evidence detected. Static reconstruction was not generated. " +
        "Runtime trace instrumentation would also have no workflow to bind to.",
      recommendedEnvVars: [],
      suggestedEvents: [],
      codeHints: [
        "Add an agents.yaml or workflow.yaml manifest to enable reconstruction.",
      ],
    };

    const emptyResult: StaticProofReconstruction = {
      reconstructionId: reconstructionId(),
      reportId: report.reportId,
      projectId: report.projectId,
      sourceReportVersion: report.reportVersion,
      generatedAt: new Date().toISOString(),
      mode: "static_inference",
      confidence: "low",
      workflowSpecs: [],
      systemGraph: { nodes: [], edges: [] },
      mappingSummary: emptyMappingSummary,
      missingLinks: [],
      suggestedFiles: [explanationFile],
      instrumentationPlan,
    };
    return staticProofReconstructionSchema.parse(emptyResult);
  }

  const confidence = determineConfidence(report);

  // Build workflow specs.
  const workflowSpecs: SuggestedWorkflowSpec[] = [];

  if (report.detectedWorkflowsDetailed.length > 0) {
    for (const workflow of report.detectedWorkflowsDetailed) {
      workflowSpecs.push(buildWorkflowSpecFromDetected(workflow, report));
    }
  }

  // If no workflows but agents exist, synthesize one.
  if (workflowSpecs.length === 0 && report.detectedAgents.length > 0) {
    workflowSpecs.push(buildWorkflowSpecFromAgents(report.detectedAgents, report));
  }

  // If we have AI evidence (prompts/tools/evals/models) but no agents or
  // workflows, we still don't invent a workflow — the artifacts are reported
  // via mappingSummary and missingLinks instead.
  const mappingSummary = buildMappingSummary(report);
  const missingLinks = buildMissingLinks(report);
  const systemGraph = buildReconstructedGraph(workflowSpecs, report);
  const instrumentationPlan = buildInstrumentationPlan(workflowSpecs, report);
  const suggestedFiles =
    workflowSpecs.length > 0
      ? generateSuggestedFiles(workflowSpecs, report, instrumentationPlan)
      : [];

  const result: StaticProofReconstruction = {
    reconstructionId: reconstructionId(),
    reportId: report.reportId,
    projectId: report.projectId,
    sourceReportVersion: report.reportVersion,
    generatedAt: new Date().toISOString(),
    mode: "static_inference",
    confidence,
    workflowSpecs,
    systemGraph,
    mappingSummary,
    missingLinks,
    suggestedFiles,
    instrumentationPlan,
  };
  return staticProofReconstructionSchema.parse(result);
}
