import { describe, it, expect } from "vitest";
import { reconstructFromScanReport } from "../reconstructWorkflowSpec";
import type { ScanReport } from "@/lib/scanner/types";

// ── Minimal fixture builders ──────────────────────────────────────────────────

function makeMinimalReport(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    reportVersion: "2.0",
    reportId: "rpt_test",
    projectId: "proj_test",
    scanId: "rpt_test",
    scannerVersion: "agentpulse-static-scanner-v2",
    generatedAt: "2025-01-01T00:00:00.000Z",
    repoName: "test-repo",
    scannedAt: "2025-01-01T00:00:00.000Z",
    filesScanned: 5,
    ignoredFiles: 1,
    projectType: "unknown_ai_project",
    detectedAgents: [],
    detectedWorkflowsDetailed: [],
    detectedCIWorkflows: [],
    detectedPrompts: [],
    detectedTools: [],
    detectedEvals: [],
    detectedTests: [],
    detectedWorkflows: [],
    findings: [],
    scores: {
      architecture: 50,
      promptQuality: 50,
      toolGovernance: 50,
      evalCoverage: 50,
      security: 80,
      documentation: 50,
      maintainability: 70,
      overall: 58,
    },
    recommendations: [],
    ...overrides,
  };
}

// ── Phase 8: Campaign Sandbox reconstruction ──────────────────────────────────

describe("Campaign Sandbox reconstruction", () => {
  const campaignReport = makeMinimalReport({
    reportId: "rpt_fixture_campaign_sandbox",
    projectId: "proj_campaign-sandbox",
    repoName: "campaign-sandbox",
    projectType: "workflow_system",
    detectedWorkflowsDetailed: [
      {
        id: "campaign-sandbox-v1",
        name: "Campaign Sandbox",
        type: "hybrid_workflow_agent",
        source: "explicit",
        confidence: "high",
        configPath: "workflow.yaml",
        stagesDetailed: [
          { id: "messy-brief-intake",        name: "Messy Brief Intake" },
          { id: "normalize-brief",            name: "Normalize Brief" },
          { id: "extract-strategic-tension",  name: "Extract Strategic Tension" },
          { id: "generate-routes",            name: "Generate Routes" },
          { id: "build-personas",             name: "Build Personas" },
          { id: "simulate-reactions",         name: "Simulate Reactions" },
          { id: "score-routes",               name: "Score Routes" },
          { id: "premortem-review",           name: "Premortem Review" },
          { id: "compare-routes",             name: "Compare Routes" },
          { id: "human-selection",            name: "Human Selection", approvalGate: true },
          { id: "generate-execution-plan",    name: "Generate Execution Plan" },
          { id: "export-artifact",            name: "Export Artifact", artifacts: ["campaign_plan.json"] },
        ],
        evals: ["evals/route_quality.yaml", "evals/tension_validity.yaml"],
        tools: ["web_search", "brief_parser"],
        approvalGates: ["human-selection"],
        artifacts: ["campaign_plan.json"],
      },
    ],
    detectedWorkflows: ["workflow.yaml"],
    detectedPrompts: [
      "prompts/normalize_brief.md",
      "prompts/generate_routes.md",
      "prompts/premortem.md",
    ],
    detectedTools: ["web_search", "brief_parser"],
    detectedEvals: ["evals/route_quality.yaml", "evals/tension_validity.yaml"],
    detectedCIWorkflows: [
      { name: "CI", path: ".github/workflows/ci.yml", provider: "github_actions" },
    ],
  });

  it("reconstructs Campaign Sandbox from workflow manifest with high confidence", () => {
    const result = reconstructFromScanReport(campaignReport);
    expect(result.confidence).toBe("high");
    expect(result.mode).toBe("static_inference");
    expect(result.projectId).toBe("proj_campaign-sandbox");
  });

  it("produces exactly one workflow spec for campaign-sandbox-v1", () => {
    const result = reconstructFromScanReport(campaignReport);
    expect(result.workflowSpecs).toHaveLength(1);
    const spec = result.workflowSpecs[0];
    expect(spec).toBeDefined();
    expect(spec!.workflow_id).toBe("campaign-sandbox-v1");
    expect(spec!.name).toBe("Campaign Sandbox");
    expect(spec!.source).toBe("manifest");
    expect(spec!.confidence).toBe("high");
  });

  it("includes all 12 campaign stages as workflow nodes", () => {
    const result = reconstructFromScanReport(campaignReport);
    const spec = result.workflowSpecs[0]!;
    // trigger + 12 stages + 1 approval node (for human-selection) + artifact node
    const stageNodes = spec.nodes.filter((n) => !["trigger", "artifact-output"].includes(n.id));
    expect(stageNodes.length).toBeGreaterThanOrEqual(12);
    const stageIds = stageNodes.map((n) => n.id);
    expect(stageIds).toContain("normalize-brief");
    expect(stageIds).toContain("extract-strategic-tension");
    expect(stageIds).toContain("generate-routes");
    expect(stageIds).toContain("build-personas");
    expect(stageIds).toContain("simulate-reactions");
    expect(stageIds).toContain("score-routes");
    expect(stageIds).toContain("premortem-review");
    expect(stageIds).toContain("compare-routes");
    expect(stageIds).toContain("human-selection");
    expect(stageIds).toContain("generate-execution-plan");
    expect(stageIds).toContain("export-artifact");
  });

  it("includes an approval node for human-selection", () => {
    const result = reconstructFromScanReport(campaignReport);
    const spec = result.workflowSpecs[0]!;
    const approvalNode = spec.nodes.find((n) => n.type === "approval");
    expect(approvalNode).toBeDefined();
    expect(spec.approval_gates).toContain("human-selection-approval");
  });

  it("reports model/provider as missing (no model declared in fixture)", () => {
    const result = reconstructFromScanReport(campaignReport);
    const spec = result.workflowSpecs[0]!;
    expect(spec.missingFields).toContain("model_provider");
    // Missing links should include model gaps
    const modelLinks = result.missingLinks.filter(
      (l) => l.type === "stage_missing_model" || l.type === "model_unmapped",
    );
    // Campaign Sandbox has no model declared → expect model missing links
    expect(result.missingLinks.length).toBeGreaterThan(0);
    // Not inventing a model
    expect(spec.nodes.every((n) => !n.model_provider)).toBe(true);
  });

  it("reports tools from the workflow manifest", () => {
    const result = reconstructFromScanReport(campaignReport);
    const spec = result.workflowSpecs[0]!;
    expect(spec.allowed_tools).toContain("web_search");
    expect(spec.allowed_tools).toContain("brief_parser");
  });

  it("reports evals from the workflow manifest", () => {
    const result = reconstructFromScanReport(campaignReport);
    const spec = result.workflowSpecs[0]!;
    expect(spec.evals).toContain("evals/route_quality.yaml");
    expect(spec.evals).toContain("evals/tension_validity.yaml");
  });

  it("generates three suggested files", () => {
    const result = reconstructFromScanReport(campaignReport);
    expect(result.suggestedFiles).toHaveLength(3);
    const paths = result.suggestedFiles.map((f) => f.path);
    expect(paths).toContain("agentpulse.workflow.suggested.json");
    expect(paths).toContain("ai-system.suggested.yaml");
    expect(paths).toContain("instrumentation-plan.suggested.md");
  });

  it("suggested WorkflowSpec JSON parses and contains the workflow_id", () => {
    const result = reconstructFromScanReport(campaignReport);
    const jsonFile = result.suggestedFiles.find((f) => f.path === "agentpulse.workflow.suggested.json");
    expect(jsonFile).toBeDefined();
    const parsed = JSON.parse(jsonFile!.content) as Record<string, unknown>;
    expect(parsed["workflow_id"]).toBe("campaign-sandbox-v1");
  });

  it("instrumentation plan is clearly non-required", () => {
    const result = reconstructFromScanReport(campaignReport);
    expect(result.instrumentationPlan.required).toBe(false);
    expect(result.instrumentationPlan.available).toBe(true);
    expect(result.instrumentationPlan.summary).toContain("optional");
  });

  it("suggested files contain no raw secret values", () => {
    const result = reconstructFromScanReport(campaignReport);
    for (const file of result.suggestedFiles) {
      // Should not contain any obvious secret patterns
      expect(file.content).not.toMatch(/sk-ant-api\d+/);
      expect(file.content).not.toMatch(/ghp_[A-Za-z0-9]{36}/);
      expect(file.content).not.toMatch(/AKIA[A-Z0-9]{16}/);
    }
  });

  it("generates a reconstructionId and timestamps", () => {
    const result = reconstructFromScanReport(campaignReport);
    expect(result.reconstructionId).toMatch(/^recon_/);
    expect(result.generatedAt).toBeTruthy();
    expect(new Date(result.generatedAt).getFullYear()).toBeGreaterThanOrEqual(2025);
  });

  it("system graph has workflow + stage nodes", () => {
    const result = reconstructFromScanReport(campaignReport);
    const workflowNode = result.systemGraph.nodes.find((n) => n.type === "workflow");
    expect(workflowNode).toBeDefined();
    const stageNodes = result.systemGraph.nodes.filter((n) => n.type === "stage");
    expect(stageNodes.length).toBeGreaterThan(0);
  });
});

// ── Phase 9: General reconstruction logic ────────────────────────────────────

describe("reconstructFromScanReport — minimal / no AI evidence", () => {
  it("handles a report with no agents, prompts, tools, or workflows gracefully", () => {
    const report = makeMinimalReport();
    const result = reconstructFromScanReport(report);
    expect(result.confidence).toBe("low");
    expect(result.workflowSpecs).toHaveLength(1);
    expect(result.workflowSpecs[0]!.source).toBe("path_inference");
    expect(result.missingLinks.length).toBeGreaterThanOrEqual(0);
  });

  it("returns a valid reconstructionId", () => {
    const result = reconstructFromScanReport(makeMinimalReport());
    expect(result.reconstructionId).toMatch(/^recon_/);
  });

  it("sets mode to static_inference always", () => {
    const result = reconstructFromScanReport(makeMinimalReport());
    expect(result.mode).toBe("static_inference");
  });
});

describe("reconstructFromScanReport — confidence levels", () => {
  it("returns high confidence for explicit manifest with high-confidence workflow", () => {
    const report = makeMinimalReport({
      projectType: "workflow_system",
      detectedWorkflowsDetailed: [
        {
          id: "wf1",
          name: "My Workflow",
          source: "explicit",
          confidence: "high",
          configPath: "workflow.yaml",
        },
      ],
      detectedWorkflows: ["workflow.yaml"],
    });
    const result = reconstructFromScanReport(report);
    expect(result.confidence).toBe("high");
  });

  it("returns medium confidence for medium-confidence workflow", () => {
    const report = makeMinimalReport({
      projectType: "workflow_system",
      detectedWorkflowsDetailed: [
        {
          id: "wf1",
          name: "My Workflow",
          source: "explicit",
          confidence: "medium",
          configPath: "src/workflow.py",
        },
      ],
      detectedWorkflows: ["src/workflow.py"],
    });
    const result = reconstructFromScanReport(report);
    expect(result.confidence).toBe("medium");
  });

  it("returns low confidence for scattered artifacts only", () => {
    const report = makeMinimalReport({
      projectType: "ai_application",
      detectedAgents: [
        {
          id: "agent-1",
          name: "Some Agent",
          source: "inferred",
          confidence: "low",
          promptPaths: [],
          toolNames: [],
          evalPaths: [],
          risks: [],
          displayKind: "inferred_candidate",
        },
      ],
    });
    const result = reconstructFromScanReport(report);
    expect(result.confidence).toBe("low");
  });
});

describe("WorkflowSpec generation", () => {
  it("generates nodes including a trigger when workflow has stages", () => {
    const report = makeMinimalReport({
      projectType: "workflow_system",
      detectedWorkflowsDetailed: [
        {
          id: "pipeline",
          name: "Pipeline",
          source: "explicit",
          confidence: "high",
          configPath: "workflow.yaml",
          stagesDetailed: [
            { id: "stage-a", name: "Stage A" },
            { id: "stage-b", name: "Stage B" },
          ],
        },
      ],
      detectedWorkflows: ["workflow.yaml"],
    });
    const result = reconstructFromScanReport(report);
    const spec = result.workflowSpecs[0]!;
    const trigger = spec.nodes.find((n) => n.type === "trigger");
    expect(trigger).toBeDefined();
    const stageIds = spec.nodes.map((n) => n.id);
    expect(stageIds).toContain("stage-a");
    expect(stageIds).toContain("stage-b");
  });

  it("generates edges between consecutive nodes", () => {
    const report = makeMinimalReport({
      projectType: "workflow_system",
      detectedWorkflowsDetailed: [
        {
          id: "pipeline",
          name: "Pipeline",
          source: "explicit",
          confidence: "high",
          configPath: "workflow.yaml",
          stagesDetailed: [
            { id: "step-1", name: "Step 1" },
            { id: "step-2", name: "Step 2" },
          ],
        },
      ],
      detectedWorkflows: ["workflow.yaml"],
    });
    const result = reconstructFromScanReport(report);
    const spec = result.workflowSpecs[0]!;
    expect(spec.edges).toBeDefined();
    expect(spec.edges!.length).toBeGreaterThan(0);
  });

  it("builds spec from agents when no workflow manifest exists", () => {
    const report = makeMinimalReport({
      projectType: "agent_system",
      detectedAgents: [
        {
          id: "editor",
          name: "Editor Agent",
          source: "explicit",
          confidence: "high",
          displayKind: "manifest",
          promptPaths: ["prompts/edit.md"],
          toolNames: ["web_search"],
          evalPaths: [],
          risks: [],
          model: { provider: "anthropic", name: "claude-haiku-4-5" },
        },
      ],
      detectedPrompts: ["prompts/edit.md"],
    });
    const result = reconstructFromScanReport(report);
    const spec = result.workflowSpecs[0]!;
    expect(spec.source).toBe("path_inference");
    const agentNode = spec.nodes.find((n) => n.id === "editor");
    expect(agentNode).toBeDefined();
    expect(agentNode!.model_provider).toBe("anthropic");
    expect(agentNode!.model_name).toBe("claude-haiku-4-5");
  });

  it("marks model_provider as missing when no model is declared", () => {
    const report = makeMinimalReport({
      projectType: "workflow_system",
      detectedWorkflowsDetailed: [
        {
          id: "wf",
          name: "Workflow",
          source: "explicit",
          confidence: "high",
          configPath: "workflow.yaml",
          stagesDetailed: [{ id: "step-1", name: "Step 1" }],
        },
      ],
      detectedWorkflows: ["workflow.yaml"],
    });
    const result = reconstructFromScanReport(report);
    const spec = result.workflowSpecs[0]!;
    expect(spec.missingFields).toContain("model_provider");
  });
});

describe("MappingSummary", () => {
  it("counts agents mapped to prompts correctly", () => {
    const report = makeMinimalReport({
      projectType: "agent_system",
      detectedAgents: [
        {
          id: "a1",
          name: "Agent 1",
          source: "explicit",
          confidence: "high",
          displayKind: "manifest",
          promptPaths: ["prompts/sys.md"],
          toolNames: ["tool_x"],
          evalPaths: ["evals/quality.yaml"],
          risks: [],
          model: { provider: "openai", name: "gpt-4o" },
        },
        {
          id: "a2",
          name: "Agent 2",
          source: "inferred",
          confidence: "low",
          displayKind: "inferred_candidate",
          promptPaths: [],
          toolNames: [],
          evalPaths: [],
          risks: [],
        },
      ],
      detectedPrompts: ["prompts/sys.md"],
      detectedTools: ["tool_x"],
      detectedEvals: ["evals/quality.yaml"],
    });
    const result = reconstructFromScanReport(report);
    const ms = result.mappingSummary;
    expect(ms.agents.total).toBe(2);
    expect(ms.agents.mappedToPrompts).toBe(1);
    expect(ms.agents.mappedToTools).toBe(1);
    expect(ms.agents.mappedToEvals).toBe(1);
    expect(ms.agents.mappedToModels).toBe(1);
    expect(ms.prompts.total).toBe(1);
    expect(ms.prompts.mapped).toBe(1);
    expect(ms.prompts.unmapped).toBe(0);
    expect(ms.evals.total).toBe(1);
    expect(ms.evals.mapped).toBe(1);
  });

  it("counts unmapped prompts when no agent references them", () => {
    const report = makeMinimalReport({
      projectType: "ai_application",
      detectedPrompts: ["prompts/orphan.md"],
    });
    const result = reconstructFromScanReport(report);
    expect(result.mappingSummary.prompts.unmapped).toBe(1);
    expect(result.mappingSummary.prompts.mapped).toBe(0);
  });
});

describe("MissingLinks", () => {
  it("creates agent_missing_prompt for agent with no promptPaths", () => {
    const report = makeMinimalReport({
      projectType: "agent_system",
      detectedAgents: [
        {
          id: "a1",
          name: "Agent 1",
          source: "explicit",
          confidence: "high",
          displayKind: "manifest",
          promptPaths: [],
          toolNames: [],
          evalPaths: [],
          risks: [],
        },
      ],
    });
    const result = reconstructFromScanReport(report);
    const link = result.missingLinks.find((l) => l.type === "agent_missing_prompt");
    expect(link).toBeDefined();
    expect(link!.targetId).toBe("a1");
    expect(link!.severity).toBe("medium");
  });

  it("creates agent_missing_model for agent without model", () => {
    const report = makeMinimalReport({
      projectType: "agent_system",
      detectedAgents: [
        {
          id: "a1",
          name: "Agent 1",
          source: "explicit",
          confidence: "high",
          displayKind: "manifest",
          promptPaths: ["prompts/p.md"],
          toolNames: [],
          evalPaths: [],
          risks: [],
        },
      ],
    });
    const result = reconstructFromScanReport(report);
    const link = result.missingLinks.find((l) => l.type === "agent_missing_model");
    expect(link).toBeDefined();
  });

  it("creates prompt_unmapped for prompts not referenced by any agent", () => {
    const report = makeMinimalReport({
      projectType: "ai_application",
      detectedPrompts: ["prompts/orphan.md"],
    });
    const result = reconstructFromScanReport(report);
    const link = result.missingLinks.find(
      (l) => l.type === "prompt_unmapped" && l.targetId === "prompts/orphan.md",
    );
    expect(link).toBeDefined();
    expect(link!.severity).toBe("info");
  });

  it("creates eval_unmapped for evals not referenced by any agent", () => {
    const report = makeMinimalReport({
      projectType: "ai_application",
      detectedEvals: ["evals/orphan.yaml"],
    });
    const result = reconstructFromScanReport(report);
    const link = result.missingLinks.find(
      (l) => l.type === "eval_unmapped" && l.targetId === "evals/orphan.yaml",
    );
    expect(link).toBeDefined();
  });

  it("creates workflow_missing_stages for workflow with no stages", () => {
    const report = makeMinimalReport({
      projectType: "workflow_system",
      detectedWorkflowsDetailed: [
        {
          id: "wf1",
          name: "Workflow",
          source: "explicit",
          confidence: "high",
          configPath: "workflow.yaml",
          // no stagesDetailed, no stages
        },
      ],
      detectedWorkflows: ["workflow.yaml"],
    });
    const result = reconstructFromScanReport(report);
    const link = result.missingLinks.find((l) => l.type === "workflow_missing_stages");
    expect(link).toBeDefined();
  });

  it("deduplicates missing links by id", () => {
    const report = makeMinimalReport({
      projectType: "agent_system",
      detectedAgents: [
        {
          id: "a1",
          name: "Agent 1",
          source: "explicit",
          confidence: "high",
          displayKind: "manifest",
          promptPaths: [],
          toolNames: [],
          evalPaths: [],
          risks: [],
        },
      ],
    });
    const result = reconstructFromScanReport(report);
    const ids = result.missingLinks.map((l) => l.id);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });
});

describe("Suggested files", () => {
  it("generates exactly 3 suggested files", () => {
    const result = reconstructFromScanReport(makeMinimalReport());
    expect(result.suggestedFiles).toHaveLength(3);
  });

  it("WorkflowSpec JSON file parses without error", () => {
    const result = reconstructFromScanReport(makeMinimalReport());
    const jsonFile = result.suggestedFiles.find((f) => f.format === "json");
    expect(jsonFile).toBeDefined();
    expect(() => JSON.parse(jsonFile!.content)).not.toThrow();
  });

  it("AI system YAML file is non-empty text", () => {
    const result = reconstructFromScanReport(makeMinimalReport());
    const yamlFile = result.suggestedFiles.find((f) => f.format === "yaml");
    expect(yamlFile).toBeDefined();
    expect(yamlFile!.content.length).toBeGreaterThan(50);
  });

  it("instrumentation plan MD is clearly marked optional", () => {
    const result = reconstructFromScanReport(makeMinimalReport());
    const mdFile = result.suggestedFiles.find((f) => f.format === "markdown");
    expect(mdFile).toBeDefined();
    expect(mdFile!.content.toLowerCase()).toContain("optional");
  });

  it("suggested files contain no obvious secret values", () => {
    const report = makeMinimalReport({
      detectedModels: [
        {
          id: "m1",
          provider: "openai",
          model: "gpt-4o",
          sourcePath: ".env.example",
          confidence: "low",
          source: "env",
        },
      ],
    });
    const result = reconstructFromScanReport(report);
    for (const file of result.suggestedFiles) {
      expect(file.content).not.toMatch(/sk-[A-Za-z0-9]{32}/);
      expect(file.content).not.toMatch(/AKIA[A-Z0-9]{16}/);
    }
  });
});

describe("Instrumentation plan", () => {
  it("sets required=false and available=true", () => {
    const result = reconstructFromScanReport(makeMinimalReport());
    expect(result.instrumentationPlan.required).toBe(false);
    expect(result.instrumentationPlan.available).toBe(true);
  });

  it("recommends standard env vars", () => {
    const result = reconstructFromScanReport(makeMinimalReport());
    expect(result.instrumentationPlan.recommendedEnvVars).toContain("AGENTPULSE_URL");
    expect(result.instrumentationPlan.recommendedEnvVars).toContain("AGENTPULSE_INGEST_KEY");
  });

  it("includes code hints", () => {
    const result = reconstructFromScanReport(makeMinimalReport());
    expect(result.instrumentationPlan.codeHints.length).toBeGreaterThan(0);
  });
});

describe("ReconstructedSystemGraph", () => {
  it("includes workflow and stage nodes", () => {
    const report = makeMinimalReport({
      projectType: "workflow_system",
      detectedWorkflowsDetailed: [
        {
          id: "wf",
          name: "Workflow",
          source: "explicit",
          confidence: "high",
          configPath: "workflow.yaml",
          stagesDetailed: [{ id: "s1", name: "Stage 1" }],
        },
      ],
      detectedWorkflows: ["workflow.yaml"],
    });
    const result = reconstructFromScanReport(report);
    const wfNode = result.systemGraph.nodes.find((n) => n.type === "workflow");
    expect(wfNode).toBeDefined();
    const stageNodes = result.systemGraph.nodes.filter((n) => n.type === "stage");
    expect(stageNodes.length).toBeGreaterThan(0);
  });

  it("includes agent, prompt, and tool nodes when agents have mappings", () => {
    const report = makeMinimalReport({
      projectType: "agent_system",
      detectedAgents: [
        {
          id: "editor",
          name: "Editor",
          source: "explicit",
          confidence: "high",
          displayKind: "manifest",
          promptPaths: ["prompts/edit.md"],
          toolNames: ["tool_a"],
          evalPaths: [],
          risks: [],
          model: { provider: "anthropic", name: "claude-haiku-4-5" },
        },
      ],
      detectedPrompts: ["prompts/edit.md"],
      detectedTools: ["tool_a"],
    });
    const result = reconstructFromScanReport(report);
    const agentNode = result.systemGraph.nodes.find((n) => n.type === "agent");
    const promptNode = result.systemGraph.nodes.find((n) => n.type === "prompt");
    const toolNode = result.systemGraph.nodes.find((n) => n.type === "tool");
    const modelNode = result.systemGraph.nodes.find((n) => n.type === "model");
    expect(agentNode).toBeDefined();
    expect(promptNode).toBeDefined();
    expect(toolNode).toBeDefined();
    expect(modelNode).toBeDefined();
  });

  it("has no duplicate node IDs", () => {
    const report = makeMinimalReport({
      projectType: "agent_system",
      detectedAgents: [
        {
          id: "a1",
          name: "Agent 1",
          source: "explicit",
          confidence: "high",
          displayKind: "manifest",
          promptPaths: ["prompts/p.md"],
          toolNames: [],
          evalPaths: [],
          risks: [],
        },
      ],
      detectedPrompts: ["prompts/p.md"],
    });
    const result = reconstructFromScanReport(report);
    const ids = result.systemGraph.nodes.map((n) => n.id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe("Non-AI report regression", () => {
  it("does not produce a fake workflow for a non-AI report", () => {
    const report = makeMinimalReport({
      projectType: "unknown_ai_project",
      detectedAgents: [],
      detectedWorkflowsDetailed: [],
      detectedPrompts: [],
      detectedTools: [],
      detectedEvals: [],
    });
    const result = reconstructFromScanReport(report);
    // Should still produce a minimal stub, but marked as low confidence
    expect(result.confidence).toBe("low");
    expect(result.workflowSpecs[0]!.confidence).toBe("low");
    expect(result.workflowSpecs[0]!.source).toBe("path_inference");
  });
});
