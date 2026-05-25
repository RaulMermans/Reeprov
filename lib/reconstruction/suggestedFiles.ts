/**
 * lib/reconstruction/suggestedFiles.ts
 *
 * Generates suggested manifest/spec files from a reconstruction:
 *   1. agentpulse.workflow.suggested.json  — WorkflowSpec compatible with proof-layer
 *   2. ai-system.suggested.yaml             — Higher-level AI system manifest
 *   3. instrumentation-plan.suggested.md    — Optional instrumentation guide
 *
 * Generated files are clearly marked as suggestions. They contain no secret values.
 */

import type { ScanReport } from "@/lib/scanner/types";
import type {
  SuggestedWorkflowSpec,
  SuggestedManifestFile,
  InstrumentationPlan,
} from "./types";

// ── WorkflowSpec JSON ──────────────────────────────────────────────────────────

function generateWorkflowSpecJson(
  specs: SuggestedWorkflowSpec[],
  report: ScanReport,
): SuggestedManifestFile {
  const primarySpec = specs[0];
  if (!primarySpec) {
    return {
      path: "agentpulse.workflow.suggested.json",
      format: "json",
      purpose: "AgentPulse proof-layer WorkflowSpec — no workflow detected",
      content: JSON.stringify(
        {
          _note: "No workflow structure detected. Add a workflow.yaml or agents.yaml to improve reconstruction.",
          workflow_id: `${report.projectId}-unknown`,
          name: report.repoName,
          version: "1.0.0",
          architecture_type: "single_llm_call",
          nodes: [],
        },
        null,
        2,
      ),
    };
  }

  // Strip reconstruction-only metadata before exporting as a WorkflowSpec.
  const { source, confidence, evidencePaths, missingFields, recommendations, ...workflowSpec } =
    primarySpec;

  const output = {
    _generated_by: "AgentPulse Static Reconstruction",
    _confidence: confidence,
    _source: source,
    _evidence_paths: evidencePaths,
    _missing_fields: missingFields,
    _note:
      "This is a suggested WorkflowSpec generated from static scan evidence. " +
      "Review and adjust before using as a proof-layer contract.",
    ...workflowSpec,
    // Include all specs if there are multiple, as additional entries.
    ...(specs.length > 1
      ? { _additional_workflows: specs.slice(1).map(({ source: s, confidence: c, evidencePaths: ep, missingFields: mf, recommendations: rec, ...rest }) => ({ _source: s, _confidence: c, ...rest })) }
      : {}),
  };

  return {
    path: "agentpulse.workflow.suggested.json",
    format: "json",
    purpose: "AgentPulse proof-layer WorkflowSpec (primary workflow)",
    content: JSON.stringify(output, null, 2),
  };
}

// ── AI System YAML ─────────────────────────────────────────────────────────────

/** Very lightweight YAML serializer — no external dependency. */
function toYaml(obj: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "boolean") return String(obj);
  if (typeof obj === "number") return String(obj);
  if (typeof obj === "string") {
    // Quote strings that need it.
    if (
      obj.includes(":") ||
      obj.includes("#") ||
      obj.includes("\n") ||
      obj.startsWith("{") ||
      obj.startsWith("[") ||
      obj === "" ||
      obj === "true" ||
      obj === "false"
    ) {
      return `"${obj.replace(/"/g, '\\"')}"`;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj.map((item) => `${pad}- ${toYaml(item, indent + 1)}`).join("\n");
  }
  if (typeof obj === "object") {
    const entries = Object.entries(obj).filter(([, v]) => v !== undefined && v !== null);
    if (entries.length === 0) return "{}";
    return entries
      .map(([k, v]) => {
        if (typeof v === "object" && v !== null) {
          const inner = toYaml(v, indent + 1);
          if (Array.isArray(v)) {
            return `${pad}${k}:\n${inner}`;
          }
          return `${pad}${k}:\n${inner}`;
        }
        return `${pad}${k}: ${toYaml(v, indent)}`;
      })
      .join("\n");
  }
  return String(obj);
}

function generateAISystemYaml(
  specs: SuggestedWorkflowSpec[],
  report: ScanReport,
): SuggestedManifestFile {
  const agents = report.detectedAgents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    source: agent.configPath ?? "# not detected",
    ...(agent.promptPaths.length > 0 ? { prompts: agent.promptPaths } : {}),
    ...(agent.toolNames.length > 0 ? { tools: agent.toolNames } : {}),
    ...(agent.evalPaths.length > 0 ? { evals: agent.evalPaths } : {}),
    ...(agent.model
      ? {
          model: {
            provider: agent.model.provider,
            ...(agent.model.name ? { name: agent.model.name } : {}),
          },
        }
      : {}),
    ...(agent.owner ? { owner: agent.owner } : {}),
  }));

  const workflows = specs.map((spec) => ({
    id: spec.workflow_id,
    name: spec.name,
    confidence: spec.confidence,
    architecture_type: spec.architecture_type,
    stages: spec.nodes
      .filter((n) => n.type !== "trigger" && n.type !== "artifact")
      .map((n) => ({
        id: n.id,
        label: n.label,
        ...(n.model_provider ? { model: { provider: n.model_provider, ...(n.model_name ? { name: n.model_name } : {}) } } : {}),
        ...(n.allowed_tools?.length ? { tools: n.allowed_tools } : {}),
        ...(n.eval_refs?.length ? { evals: n.eval_refs } : {}),
        ...(n.permission_class ? { permission_class: n.permission_class } : {}),
      })),
  }));

  const models = (report.detectedModels ?? []).map((m) => ({
    id: m.id,
    provider: m.provider,
    ...(m.model ? { model: m.model } : {}),
    confidence: m.confidence,
    source: m.source,
  }));

  const tools = report.detectedTools.map((t) => ({ name: t }));
  const evals = report.detectedEvals.map((e) => ({ path: e }));

  const doc = [
    "# AgentPulse AI System Manifest — Generated Suggestion",
    "# Generated by: AgentPulse Static Reconstruction",
    `# Repository: ${report.repoName}`,
    `# Report ID: ${report.reportId}`,
    "# This file is a best-effort reconstruction. Review and adjust before use.",
    "",
    "ai_system:",
    `  name: ${report.repoName}`,
    `  project_id: ${report.projectId}`,
    "",
  ];

  if (agents.length > 0) {
    doc.push("  agents:");
    for (const agent of agents) {
      doc.push(`    - id: ${agent.id}`);
      doc.push(`      name: ${agent.name}`);
      if (agent.source && !agent.source.startsWith("#")) doc.push(`      source: ${agent.source}`);
      if ("prompts" in agent && agent.prompts) {
        doc.push("      prompts:");
        for (const p of agent.prompts as string[]) doc.push(`        - ${p}`);
      }
      if ("tools" in agent && agent.tools) {
        doc.push("      tools:");
        for (const t of agent.tools as string[]) doc.push(`        - ${t}`);
      }
      if ("evals" in agent && agent.evals) {
        doc.push("      evals:");
        for (const e of agent.evals as string[]) doc.push(`        - ${e}`);
      }
      if ("model" in agent && agent.model) {
        const m = agent.model as { provider: string; name?: string };
        doc.push(`      model:`);
        doc.push(`        provider: ${m.provider}`);
        if (m.name) doc.push(`        name: ${m.name}`);
      }
    }
    doc.push("");
  }

  if (workflows.length > 0) {
    doc.push("  workflows:");
    for (const wf of workflows) {
      doc.push(`    - id: ${wf.id}`);
      doc.push(`      name: ${wf.name}`);
      doc.push(`      confidence: ${wf.confidence}`);
      doc.push(`      architecture_type: ${wf.architecture_type}`);
      if (wf.stages.length > 0) {
        doc.push("      stages:");
        for (const stage of wf.stages) {
          doc.push(`        - id: ${stage.id}`);
          doc.push(`          label: ${stage.label}`);
          if (stage.model) {
            const m = stage.model as { provider: string; name?: string };
            doc.push("          model:");
            doc.push(`            provider: ${m.provider}`);
            if (m.name) doc.push(`            name: ${m.name}`);
          }
          if (stage.tools && Array.isArray(stage.tools) && stage.tools.length > 0) {
            doc.push("          tools:");
            for (const t of stage.tools) doc.push(`            - ${t}`);
          }
        }
      }
    }
    doc.push("");
  }

  if (models.length > 0) {
    doc.push("  models:");
    for (const m of models) {
      doc.push(`    - id: ${m.id}`);
      doc.push(`      provider: ${m.provider}`);
      if (m.model) doc.push(`      model: ${m.model}`);
      doc.push(`      confidence: ${m.confidence}`);
    }
    doc.push("");
  }

  if (tools.length > 0) {
    doc.push("  tools:");
    for (const t of tools) doc.push(`    - name: ${t.name}`);
    doc.push("");
  }

  if (evals.length > 0) {
    doc.push("  evals:");
    for (const e of evals) doc.push(`    - path: ${e.path}`);
    doc.push("");
  }

  return {
    path: "ai-system.suggested.yaml",
    format: "yaml",
    purpose: "AI system manifest — agents, workflows, tools, evals, models",
    content: doc.join("\n"),
  };
}

// ── Instrumentation Plan Markdown ──────────────────────────────────────────────

function generateInstrumentationPlanMd(
  plan: InstrumentationPlan,
  report: ScanReport,
): SuggestedManifestFile {
  const lines = [
    `# AgentPulse Instrumentation Plan — ${report.repoName}`,
    "",
    "> **Instrumentation is optional.** AgentPulse already provides static reconstruction,",
    "> architecture analysis, risk findings, and a suggested WorkflowSpec without any code changes.",
    "> This plan shows how to add optional runtime trace events for live execution proof.",
    "",
    "## Summary",
    "",
    plan.summary,
    "",
    "## Required Environment Variables",
    "",
    "Add these to your project's `.env.local` (or equivalent):",
    "",
    "```",
    ...plan.recommendedEnvVars.map((v) => `${v}=<your-value>`),
    "```",
    "",
    "## Suggested Trace Events by Stage",
    "",
  ];

  for (const stage of plan.suggestedEvents) {
    lines.push(`### \`${stage.stageId}\``);
    lines.push("");
    lines.push("```");
    lines.push(`// Emit these events around the "${stage.stageId}" stage:`);
    for (const evt of stage.events) {
      lines.push(`pulse.emitEvent(runId, { event_type: "${evt}", node_id: "${stage.stageId}", ... });`);
    }
    lines.push("```");
    lines.push("");
  }

  lines.push("## Implementation Hints");
  lines.push("");
  for (const hint of plan.codeHints) {
    lines.push(`- ${hint}`);
  }
  lines.push("");
  lines.push("## Quick Start");
  lines.push("");
  lines.push("```typescript");
  lines.push('import { AgentPulseClient } from "@agentpulse/client"; // or copy lib/proof-layer/client.ts');
  lines.push("");
  lines.push("const pulse = new AgentPulseClient({");
  lines.push(`  endpoint: process.env.AGENTPULSE_URL,`);
  lines.push(`  apiKey: process.env.AGENTPULSE_INGEST_KEY,`);
  lines.push(`  projectId: process.env.AGENTPULSE_PROJECT_ID,`);
  lines.push(`  projectName: "My Project",`);
  lines.push(`  workflowId: process.env.AGENTPULSE_WORKFLOW_ID,`);
  lines.push("});");
  lines.push("");
  lines.push("// At run start:");
  lines.push('const { run_id } = await pulse.startRun({ summary: "Brief description" });');
  lines.push("");
  lines.push("// Around each stage:");
  lines.push('await pulse.emitEvent(run_id, { event_type: "node_started", node_id: "my-stage", status: "running" });');
  lines.push("// ... run your stage logic ...");
  lines.push('await pulse.emitEvent(run_id, { event_type: "node_completed", node_id: "my-stage", status: "completed" });');
  lines.push("");
  lines.push("// At run end:");
  lines.push('await pulse.completeRun({ run_id, summary: "Done." });');
  lines.push("```");
  lines.push("");
  lines.push("---");
  lines.push("*Generated by AgentPulse Static Reconstruction. Instrumentation is optional.*");

  return {
    path: "instrumentation-plan.suggested.md",
    format: "markdown",
    purpose: "Optional instrumentation guide for adding runtime trace events",
    content: lines.join("\n"),
  };
}

// ── Main export ────────────────────────────────────────────────────────────────

export function generateSuggestedFiles(
  specs: SuggestedWorkflowSpec[],
  report: ScanReport,
  plan: InstrumentationPlan,
): SuggestedManifestFile[] {
  return [
    generateWorkflowSpecJson(specs, report),
    generateAISystemYaml(specs, report),
    generateInstrumentationPlanMd(plan, report),
  ];
}
