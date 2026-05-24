import type {
  DetectedAgent,
  DetectedCIWorkflow,
  DetectedModelConfig,
  DetectedModelPerformance,
  DetectedWorkflow,
  SystemGraph,
  SystemGraphEdge,
  SystemGraphNode,
  SystemGraphSummary,
  SystemGraphWarning,
} from "@/lib/scanner/types";

export interface SystemGraphInput {
  detectedAgents: DetectedAgent[];
  detectedWorkflowsDetailed: DetectedWorkflow[];
  detectedPrompts: string[];
  detectedPromptRelatedFiles?: string[];
  detectedTools: string[];
  detectedEvals: string[];
  detectedTests?: string[];
  detectedCIWorkflows?: DetectedCIWorkflow[];
  detectedModels?: DetectedModelConfig[];
  modelPerformance?: DetectedModelPerformance[];
}

interface Builder {
  nodes: Map<string, SystemGraphNode>;
  edges: SystemGraphEdge[];
  warnings: SystemGraphWarning[];
  edgeSet: Set<string>;
}

function newBuilder(): Builder {
  return { nodes: new Map(), edges: [], warnings: [], edgeSet: new Set() };
}

function addNode(b: Builder, node: SystemGraphNode) {
  if (!b.nodes.has(node.id)) {
    b.nodes.set(node.id, node);
  } else {
    const existing = b.nodes.get(node.id)!;
    // Merge metadata.
    if (node.metadata) {
      existing.metadata = { ...(existing.metadata ?? {}), ...node.metadata };
    }
  }
}

function addEdge(b: Builder, edge: SystemGraphEdge) {
  const key = `${edge.from}|${edge.to}|${edge.type}`;
  if (b.edgeSet.has(key)) return;
  b.edgeSet.add(key);
  b.edges.push(edge);
}

function addWarning(b: Builder, w: SystemGraphWarning) {
  // De-dup by id.
  if (b.warnings.some((x) => x.id === w.id)) return;
  b.warnings.push(w);
}

function nodeId(prefix: string, value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9_./@:-]+/g, "-").replace(/^-|-$/g, "");
  return `${prefix}:${slug || "unknown"}`;
}

export function buildSystemGraph(input: SystemGraphInput): SystemGraph {
  const b = newBuilder();

  const promptToAgents = new Map<string, Set<string>>();
  const toolToAgents = new Map<string, Set<string>>();
  const evalToAgents = new Map<string, Set<string>>();
  const modelToAgents = new Map<string, Set<string>>();

  // ---- Agents ----
  for (const agent of input.detectedAgents) {
    const aId = nodeId("agent", agent.id);
    addNode(b, {
      id: aId,
      label: agent.name,
      type: "agent",
      sourcePath: agent.configPath,
      confidence: agent.confidence,
      scope: "product",
      metadata: {
        displayKind: agent.displayKind ?? "unknown",
        source: agent.source,
        ...(agent.owner ? { owner: agent.owner } : {}),
      },
    });

    const isManifest = agent.displayKind === "manifest";

    // Prompt mappings
    for (const p of agent.promptPaths) {
      const pId = nodeId("prompt", p);
      addNode(b, { id: pId, label: p, type: "prompt", sourcePath: p, confidence: "high", scope: "product" });
      addEdge(b, {
        id: `${aId}->${pId}`,
        from: aId,
        to: pId,
        type: "uses_prompt",
        confidence: isManifest ? "high" : "medium",
        source: "manifest",
      });
      addToSet(promptToAgents, p, agent.id);
    }

    // Tool mappings
    for (const t of agent.toolNames) {
      const tId = nodeId("tool", t);
      addNode(b, { id: tId, label: t, type: "tool", confidence: "high", scope: "product" });
      addEdge(b, {
        id: `${aId}->${tId}`,
        from: aId,
        to: tId,
        type: "calls_tool",
        confidence: isManifest ? "high" : "medium",
        source: "manifest",
      });
      addToSet(toolToAgents, t, agent.id);
    }

    // Eval mappings
    for (const e of agent.evalPaths) {
      const eId = nodeId("eval", e);
      addNode(b, { id: eId, label: e, type: "eval", sourcePath: e, confidence: "high", scope: "product" });
      addEdge(b, {
        id: `${aId}->${eId}`,
        from: aId,
        to: eId,
        type: "evaluated_by",
        confidence: isManifest ? "high" : "medium",
        source: "manifest",
      });
      addToSet(evalToAgents, e, agent.id);
    }

    // Model mapping from manifest
    if (agent.model) {
      const modelLabel = agent.model.name ?? `${agent.model.provider} (unspecified)`;
      const mId = nodeId("model", `${agent.model.provider}/${agent.model.name ?? "unspecified"}`);
      const pId = nodeId("provider", agent.model.provider);
      addNode(b, {
        id: mId,
        label: modelLabel,
        type: "model",
        confidence: "high",
        scope: "product",
        metadata: {
          provider: agent.model.provider,
          ...(agent.model.name ? { name: agent.model.name } : {}),
          ...(agent.model.temperature !== undefined ? { temperature: agent.model.temperature } : {}),
          ...(agent.model.maxTokens !== undefined ? { maxTokens: agent.model.maxTokens } : {}),
        },
      });
      addNode(b, {
        id: pId,
        label: agent.model.provider,
        type: "provider",
        confidence: "high",
        scope: "product",
      });
      addEdge(b, {
        id: `${aId}->${mId}`,
        from: aId,
        to: mId,
        type: "uses_model",
        confidence: "high",
        source: "manifest",
      });
      addEdge(b, {
        id: `${mId}->${pId}`,
        from: mId,
        to: pId,
        type: "provided_by",
        confidence: "high",
        source: "manifest",
      });
      addToSet(modelToAgents, `${agent.model.provider}|${agent.model.name ?? ""}`, agent.id);
    }

    // Files: runner/schema as artifact metadata nodes.
    if (agent.files) {
      for (const [kind, path] of Object.entries(agent.files)) {
        if (kind === "prompt") continue;
        const artId = nodeId("artifact", `${kind}:${path}`);
        addNode(b, {
          id: artId,
          label: `${kind}: ${path}`,
          type: "artifact",
          sourcePath: path,
          confidence: "high",
          scope: "product",
          metadata: { kind },
        });
        addEdge(b, {
          id: `${aId}->${artId}`,
          from: aId,
          to: artId,
          type: "related_to",
          confidence: "high",
          source: "manifest",
        });
      }
    }

    // Permissions as metadata on the agent (no permission node by default).
    if (agent.permissions) {
      const meta: Record<string, boolean | string> = {};
      if (agent.permissions.externalNetwork !== undefined) meta.externalNetwork = agent.permissions.externalNetwork;
      if (agent.permissions.writeFiles !== undefined) meta.writeFiles = agent.permissions.writeFiles;
      if (agent.permissions.publish !== undefined) meta.publish = agent.permissions.publish;
      const node = b.nodes.get(aId);
      if (node) node.metadata = { ...(node.metadata ?? {}), ...meta };
    }
  }

  // ---- Workflows ----
  for (const wf of input.detectedWorkflowsDetailed) {
    const wId = nodeId("workflow", wf.id);
    addNode(b, {
      id: wId,
      label: wf.name,
      type: "workflow",
      sourcePath: wf.configPath,
      confidence: wf.confidence,
      scope: "product",
      metadata: {
        ...(wf.type ? { type: wf.type } : {}),
        ...(wf.owner ? { owner: wf.owner } : {}),
        ...(wf.status ? { status: wf.status } : {}),
      },
    });

    // Detailed stages
    if (wf.stagesDetailed && wf.stagesDetailed.length > 0) {
      for (const stage of wf.stagesDetailed) {
        const sId = nodeId("workflow_step", `${wf.id}/${stage.id}`);
        addNode(b, {
          id: sId,
          label: stage.name ?? stage.id,
          type: "workflow_step",
          confidence: "high",
          scope: "product",
          metadata: { workflow: wf.id },
        });
        addEdge(b, {
          id: `${wId}->${sId}`,
          from: wId,
          to: sId,
          type: "contains_step",
          confidence: "high",
          source: "manifest",
        });

        if (stage.agent) {
          const agentId = nodeId("agent", stage.agent);
          if (!b.nodes.has(agentId)) {
            addNode(b, {
              id: agentId,
              label: stage.agent,
              type: "agent",
              confidence: "medium",
              scope: "product",
              metadata: { inferredFromWorkflow: wf.id },
            });
          }
          addEdge(b, {
            id: `${sId}->${agentId}`,
            from: sId,
            to: agentId,
            type: "depends_on",
            confidence: "high",
            source: "manifest",
          });
        }

        if (stage.prompt) {
          const pId = nodeId("prompt", stage.prompt);
          addNode(b, { id: pId, label: stage.prompt, type: "prompt", sourcePath: stage.prompt, confidence: "high", scope: "product" });
          addEdge(b, {
            id: `${sId}->${pId}`,
            from: sId,
            to: pId,
            type: "uses_prompt",
            confidence: "high",
            source: "manifest",
          });
        }

        for (const t of stage.tools ?? []) {
          const tId = nodeId("tool", t);
          addNode(b, { id: tId, label: t, type: "tool", confidence: "high", scope: "product" });
          addEdge(b, {
            id: `${sId}->${tId}`,
            from: sId,
            to: tId,
            type: "calls_tool",
            confidence: "high",
            source: "manifest",
          });
        }

        for (const e of stage.evals ?? []) {
          const eId = nodeId("eval", e);
          addNode(b, { id: eId, label: e, type: "eval", sourcePath: e, confidence: "high", scope: "product" });
          addEdge(b, {
            id: `${sId}->${eId}`,
            from: sId,
            to: eId,
            type: "evaluated_by",
            confidence: "high",
            source: "manifest",
          });
        }

        if (stage.model) {
          const mId = nodeId("model", `${stage.model.provider}/${stage.model.name ?? "unspecified"}`);
          const pId = nodeId("provider", stage.model.provider);
          addNode(b, {
            id: mId,
            label: stage.model.name ?? `${stage.model.provider} (unspecified)`,
            type: "model",
            confidence: "high",
            scope: "product",
            metadata: { provider: stage.model.provider, ...(stage.model.name ? { name: stage.model.name } : {}) },
          });
          addNode(b, { id: pId, label: stage.model.provider, type: "provider", confidence: "high", scope: "product" });
          addEdge(b, {
            id: `${sId}->${mId}`,
            from: sId,
            to: mId,
            type: "uses_model",
            confidence: "high",
            source: "manifest",
          });
          addEdge(b, {
            id: `${mId}->${pId}`,
            from: mId,
            to: pId,
            type: "provided_by",
            confidence: "high",
            source: "manifest",
          });
        }

        if (stage.approvalGate) {
          const gId = nodeId("approval_gate", `${wf.id}/${stage.id}`);
          addNode(b, {
            id: gId,
            label: `${stage.name ?? stage.id} approval`,
            type: "approval_gate",
            confidence: "high",
            scope: "product",
          });
          addEdge(b, {
            id: `${sId}->${gId}`,
            from: sId,
            to: gId,
            type: "requires_approval",
            confidence: "high",
            source: "manifest",
          });
        }

        for (const art of stage.artifacts ?? []) {
          const artId = nodeId("artifact", art);
          addNode(b, { id: artId, label: art, type: "artifact", confidence: "high", scope: "product" });
          addEdge(b, {
            id: `${sId}->${artId}`,
            from: sId,
            to: artId,
            type: "produces",
            confidence: "high",
            source: "manifest",
          });
        }
      }
    } else if (wf.stages && wf.stages.length > 0) {
      // Simple string stages.
      for (const stage of wf.stages) {
        const sId = nodeId("workflow_step", `${wf.id}/${stage}`);
        addNode(b, {
          id: sId,
          label: stage,
          type: "workflow_step",
          confidence: "medium",
          scope: "product",
        });
        addEdge(b, {
          id: `${wId}->${sId}`,
          from: wId,
          to: sId,
          type: "contains_step",
          confidence: "medium",
          source: "manifest",
        });
      }
    } else {
      addWarning(b, {
        id: `wf-missing-steps-${wf.id}`,
        severity: "medium",
        targetNodeId: wId,
        type: "workflow_missing_steps",
        message: `Workflow "${wf.name}" has no stages defined.`,
        recommendation: "Add stages with id, name, and agent fields to the workflow manifest.",
      });
    }
  }

  // ---- Detected models (deterministic detection) ----
  for (const mc of input.detectedModels ?? []) {
    const modelKey = mc.model ? `${mc.provider}/${mc.model}` : `${mc.provider}/unspecified`;
    const mId = nodeId("model", modelKey);
    const pId = nodeId("provider", mc.provider);
    addNode(b, {
      id: pId,
      label: mc.provider,
      type: "provider",
      confidence: mc.confidence,
      scope: "product",
    });
    if (mc.model || mc.source === "manifest" || mc.source === "code") {
      addNode(b, {
        id: mId,
        label: mc.model ?? `${mc.provider} (unspecified)`,
        type: "model",
        sourcePath: mc.sourcePath,
        confidence: mc.confidence,
        scope: "product",
        metadata: {
          provider: mc.provider,
          ...(mc.model ? { name: mc.model } : {}),
          source: mc.source,
        },
      });
      addEdge(b, {
        id: `${mId}->${pId}`,
        from: mId,
        to: pId,
        type: "provided_by",
        confidence: mc.confidence,
        source: mc.source === "manifest" ? "manifest" : mc.source === "code" ? "code_pattern" : "inferred",
      });
    }

    if (mc.mappedAgentIds) {
      for (const aId of mc.mappedAgentIds) {
        const agentNodeId = nodeId("agent", aId);
        if (b.nodes.has(agentNodeId)) {
          addEdge(b, {
            id: `${agentNodeId}->${mId}-detected`,
            from: agentNodeId,
            to: mId,
            type: "uses_model",
            confidence: mc.confidence,
            source: mc.source === "manifest" ? "manifest" : "code_pattern",
          });
        }
      }
    }
  }

  // ---- Performance data ----
  for (const perf of input.modelPerformance ?? []) {
    const mId = nodeId("model", `${perf.provider}/${perf.model}`);
    if (b.nodes.has(mId)) {
      const node = b.nodes.get(mId)!;
      const existing = (node.metadata?.performance as string[] | undefined) ?? [];
      const summary = `score=${perf.score ?? "?"} latencyMs=${perf.latencyMs ?? "?"} cost=${perf.costUsd ?? "?"} source=${perf.sourcePath}`;
      node.metadata = { ...(node.metadata ?? {}), performance: [...existing, summary] };
    }
  }

  // ---- Free prompts / tools / evals (not mapped to any agent or workflow step) ----
  const usedPromptPaths = new Set(promptToAgents.keys());
  for (const wf of input.detectedWorkflowsDetailed) {
    for (const stage of wf.stagesDetailed ?? []) {
      if (stage.prompt) usedPromptPaths.add(stage.prompt);
    }
  }
  for (const p of input.detectedPrompts) {
    const pId = nodeId("prompt", p);
    if (!b.nodes.has(pId)) {
      addNode(b, {
        id: pId,
        label: p,
        type: "prompt",
        sourcePath: p,
        confidence: "medium",
        scope: "product",
      });
    }
    if (!usedPromptPaths.has(p)) {
      addWarning(b, {
        id: `prompt-not-mapped-${pId}`,
        severity: "low",
        targetNodeId: pId,
        type: "prompt_not_mapped",
        message: `Prompt "${p}" is not attached to any agent or workflow step.`,
        recommendation: "Map this prompt to an agent or workflow step in agents.yaml or workflow.yaml.",
      });
    }
  }

  const usedEvalPaths = new Set(evalToAgents.keys());
  for (const wf of input.detectedWorkflowsDetailed) {
    for (const stage of wf.stagesDetailed ?? []) {
      for (const e of stage.evals ?? []) usedEvalPaths.add(e);
    }
    for (const e of wf.evals ?? []) usedEvalPaths.add(e);
  }
  for (const e of input.detectedEvals) {
    const eId = nodeId("eval", e);
    if (!b.nodes.has(eId)) {
      addNode(b, { id: eId, label: e, type: "eval", sourcePath: e, confidence: "medium", scope: "product" });
    }
    if (!usedEvalPaths.has(e)) {
      addWarning(b, {
        id: `eval-not-mapped-${eId}`,
        severity: "low",
        targetNodeId: eId,
        type: "eval_not_mapped",
        message: `Eval "${e}" is not attached to any agent or workflow.`,
        recommendation: "Add this eval under the agent or workflow it validates in agents.yaml or workflow.yaml.",
      });
    }
  }

  const usedToolNames = new Set(toolToAgents.keys());
  for (const wf of input.detectedWorkflowsDetailed) {
    for (const stage of wf.stagesDetailed ?? []) {
      for (const t of stage.tools ?? []) usedToolNames.add(t);
    }
    for (const t of wf.tools ?? []) usedToolNames.add(t);
  }
  for (const t of input.detectedTools) {
    const tId = nodeId("tool", t);
    if (!b.nodes.has(tId)) {
      addNode(b, { id: tId, label: t, type: "tool", confidence: "medium", scope: "product" });
    }
  }

  // ---- Mapping gap warnings ----
  let missingPromptLinks = 0;
  let missingToolLinks = 0;
  let missingEvalLinks = 0;
  let missingModelLinks = 0;
  let mappedAgentCount = 0;

  for (const agent of input.detectedAgents) {
    const aId = nodeId("agent", agent.id);
    const hasPrompt = agent.promptPaths.length > 0;
    const hasTool = agent.toolNames.length > 0;
    const hasEval = agent.evalPaths.length > 0;
    const hasModel = Boolean(agent.model);

    if (hasPrompt || hasTool || hasEval || hasModel) mappedAgentCount += 1;

    if (!hasPrompt) {
      missingPromptLinks += 1;
      addWarning(b, {
        id: `agent-missing-prompt-${agent.id}`,
        severity: agent.displayKind === "manifest" ? "medium" : "low",
        targetNodeId: aId,
        type: "agent_missing_prompt",
        message: `Agent "${agent.name}" has no mapped prompt.`,
        recommendation: "Add a prompts: list or prompt_path to this agent in agents.yaml.",
      });
    }
    if (!hasTool) {
      missingToolLinks += 1;
      addWarning(b, {
        id: `agent-missing-tools-${agent.id}`,
        severity: "low",
        targetNodeId: aId,
        type: "agent_missing_tools",
        message: `Agent "${agent.name}" has no mapped tools.`,
        recommendation: "Add a tools: list to this agent in agents.yaml.",
      });
    }
    if (!hasEval) {
      missingEvalLinks += 1;
      addWarning(b, {
        id: `agent-missing-evals-${agent.id}`,
        severity: agent.displayKind === "manifest" ? "medium" : "low",
        targetNodeId: aId,
        type: "agent_missing_evals",
        message: `Agent "${agent.name}" has no mapped evals.`,
        recommendation: "Add an evals: list to this agent in agents.yaml.",
      });
    }
    if (!hasModel) {
      missingModelLinks += 1;
      addWarning(b, {
        id: `agent-missing-model-${agent.id}`,
        severity: agent.displayKind === "manifest" ? "medium" : "low",
        targetNodeId: aId,
        type: "agent_missing_model",
        message: `Agent "${agent.name}" has no mapped model/provider.`,
        recommendation: "Add a model: { provider, name } entry to this agent in agents.yaml.",
      });
    }
  }

  // Performance data missing warning (only when models exist but no metrics).
  const modelNodes = [...b.nodes.values()].filter((n) => n.type === "model");
  if (modelNodes.length > 0 && (!input.modelPerformance || input.modelPerformance.length === 0)) {
    addWarning(b, {
      id: "performance-data-missing",
      severity: "info",
      type: "performance_data_missing",
      message: "No eval/run performance metrics detected.",
      recommendation:
        "Add eval result files (e.g. eval-results.json) with provider, model, score, tokens, latency, and cost to compare model performance.",
    });
  }

  // CI workflow notice (not part of product graph).
  if ((input.detectedCIWorkflows?.length ?? 0) > 0) {
    addWarning(b, {
      id: "assistant-tooling-ci",
      severity: "info",
      type: "assistant_tooling_not_product",
      message: "CI workflows are tracked separately from the product graph.",
      recommendation: "CI infrastructure is intentionally excluded from the AI system graph.",
    });
  }

  // ---- Summary ----
  const summary: SystemGraphSummary = {
    agentCount: [...b.nodes.values()].filter((n) => n.type === "agent").length,
    workflowCount: [...b.nodes.values()].filter((n) => n.type === "workflow").length,
    promptCount: [...b.nodes.values()].filter((n) => n.type === "prompt").length,
    toolCount: [...b.nodes.values()].filter((n) => n.type === "tool").length,
    modelCount: [...b.nodes.values()].filter((n) => n.type === "model").length,
    evalCount: [...b.nodes.values()].filter((n) => n.type === "eval").length,
    mappedAgentCount,
    unmappedAgentCount: input.detectedAgents.length - mappedAgentCount,
    missingPromptLinks,
    missingToolLinks,
    missingEvalLinks,
    missingModelLinks,
  };

  return {
    nodes: [...b.nodes.values()],
    edges: b.edges,
    warnings: b.warnings,
    summary,
  };
}

function addToSet(map: Map<string, Set<string>>, key: string, value: string) {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}
