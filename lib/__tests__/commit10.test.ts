import { describe, expect, it } from "vitest";
import { exportReportMarkdown } from "@/lib/reports/exportMarkdown";
import { buildSystemGraph } from "@/lib/reports/systemGraph";
import { detectModelPerformance, detectModels } from "@/lib/scanner/modelDetection";
import { staticScan } from "@/lib/scanner/staticScan";
import type { DetectedAgent, RepoFile } from "@/lib/scanner/types";

// ---------------------------------------------------------------------------
// A. Graph nodes
// ---------------------------------------------------------------------------

describe("systemGraph node creation", () => {
  it("manifest agent creates an agent node", () => {
    const report = staticScan("owner/repo", [
      {
        path: "agents.yaml",
        size: 200,
        content:
          "agents:\n  - id: editor\n    name: Editor Agent\n    prompts:\n      - prompts/editor.md\n    tools:\n      - web_search\n    evals:\n      - evals/editor.yaml\n    model:\n      provider: google\n      name: gemini-2.5-flash\n",
      },
    ]);
    expect(report.systemGraph).toBeDefined();
    const agentNodes = report.systemGraph!.nodes.filter((n) => n.type === "agent");
    expect(agentNodes.length).toBeGreaterThan(0);
    expect(agentNodes[0].label).toContain("Editor");
  });

  it("agents.yaml prompts create uses_prompt edges", () => {
    const report = staticScan("owner/repo", [
      {
        path: "agents.yaml",
        size: 200,
        content:
          "agents:\n  - id: editor\n    name: Editor\n    prompts:\n      - prompts/editor.md\n",
      },
    ]);
    const g = report.systemGraph!;
    const usesPrompt = g.edges.filter((e) => e.type === "uses_prompt");
    expect(usesPrompt.length).toBeGreaterThan(0);
  });

  it("agents.yaml tools create calls_tool edges", () => {
    const report = staticScan("owner/repo", [
      {
        path: "agents.yaml",
        size: 200,
        content: "agents:\n  - id: editor\n    name: Editor\n    tools:\n      - web_search\n",
      },
    ]);
    const g = report.systemGraph!;
    expect(g.edges.some((e) => e.type === "calls_tool")).toBe(true);
  });

  it("agents.yaml evals create evaluated_by edges", () => {
    const report = staticScan("owner/repo", [
      {
        path: "agents.yaml",
        size: 200,
        content:
          "agents:\n  - id: editor\n    name: Editor\n    evals:\n      - evals/editor.yaml\n",
      },
    ]);
    const g = report.systemGraph!;
    expect(g.edges.some((e) => e.type === "evaluated_by")).toBe(true);
  });

  it("agents.yaml model creates uses_model and provided_by edges", () => {
    const report = staticScan("owner/repo", [
      {
        path: "agents.yaml",
        size: 200,
        content:
          "agents:\n  - id: editor\n    name: Editor\n    model:\n      provider: google\n      name: gemini-2.5-flash\n",
      },
    ]);
    const g = report.systemGraph!;
    expect(g.edges.some((e) => e.type === "uses_model")).toBe(true);
    expect(g.edges.some((e) => e.type === "provided_by")).toBe(true);
    expect(g.nodes.some((n) => n.type === "model")).toBe(true);
    expect(g.nodes.some((n) => n.type === "provider")).toBe(true);
  });

  it("workflow.yaml stages create workflow_step nodes and contains_step edges", () => {
    const report = staticScan("owner/repo", [
      {
        path: "workflow.yaml",
        size: 300,
        content:
          "workflow:\n  id: blog\n  name: Blog Workflow\n  stages:\n    - id: research\n      name: Research\n      agent: research_agent\n    - id: draft\n      name: Draft\n      agent: editor\n",
      },
    ]);
    const g = report.systemGraph!;
    expect(g.nodes.some((n) => n.type === "workflow_step")).toBe(true);
    expect(g.edges.some((e) => e.type === "contains_step")).toBe(true);
  });

  it("nested workflow stage with model+prompt+eval creates expected edges", () => {
    const report = staticScan("owner/repo", [
      {
        path: "workflow.yaml",
        size: 400,
        content:
          "workflow:\n  id: blog\n  name: Blog\n  stages:\n    - id: draft\n      name: Draft\n      agent: editor\n      prompt: prompts/draft.md\n      model:\n        provider: google\n        name: gemini-2.5-flash\n      evals:\n        - evals/editor.yaml\n      approval_gate: true\n",
      },
    ]);
    const g = report.systemGraph!;
    expect(g.edges.some((e) => e.type === "uses_prompt")).toBe(true);
    expect(g.edges.some((e) => e.type === "uses_model")).toBe(true);
    expect(g.edges.some((e) => e.type === "evaluated_by")).toBe(true);
    expect(g.edges.some((e) => e.type === "requires_approval")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B. Mapping gap warnings
// ---------------------------------------------------------------------------

describe("systemGraph warnings", () => {
  it("agent without prompt creates agent_missing_prompt warning", () => {
    const g = buildSystemGraph({
      detectedAgents: [agentFixture({ promptPaths: [], displayKind: "manifest" })],
      detectedWorkflowsDetailed: [],
      detectedPrompts: [],
      detectedTools: [],
      detectedEvals: [],
    });
    expect(g.warnings.some((w) => w.type === "agent_missing_prompt")).toBe(true);
  });

  it("agent without eval creates agent_missing_evals warning", () => {
    const g = buildSystemGraph({
      detectedAgents: [agentFixture({ evalPaths: [], displayKind: "manifest" })],
      detectedWorkflowsDetailed: [],
      detectedPrompts: [],
      detectedTools: [],
      detectedEvals: [],
    });
    expect(g.warnings.some((w) => w.type === "agent_missing_evals")).toBe(true);
  });

  it("agent without model creates agent_missing_model warning", () => {
    const g = buildSystemGraph({
      detectedAgents: [agentFixture({ displayKind: "manifest" })],
      detectedWorkflowsDetailed: [],
      detectedPrompts: [],
      detectedTools: [],
      detectedEvals: [],
    });
    expect(g.warnings.some((w) => w.type === "agent_missing_model")).toBe(true);
  });

  it("orphan eval creates eval_not_mapped warning", () => {
    const g = buildSystemGraph({
      detectedAgents: [],
      detectedWorkflowsDetailed: [],
      detectedPrompts: [],
      detectedTools: [],
      detectedEvals: ["evals/orphan.yaml"],
    });
    expect(g.warnings.some((w) => w.type === "eval_not_mapped")).toBe(true);
  });

  it("orphan prompt creates prompt_not_mapped warning", () => {
    const g = buildSystemGraph({
      detectedAgents: [],
      detectedWorkflowsDetailed: [],
      detectedPrompts: ["prompts/orphan.md"],
      detectedTools: [],
      detectedEvals: [],
    });
    expect(g.warnings.some((w) => w.type === "prompt_not_mapped")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C. Model/provider detection
// ---------------------------------------------------------------------------

describe("detectModels", () => {
  it("manifest model.provider/name is high confidence", () => {
    const agents: DetectedAgent[] = [
      {
        id: "editor",
        name: "Editor",
        promptPaths: [],
        toolNames: [],
        evalPaths: [],
        risks: [],
        source: "explicit",
        confidence: "high",
        configPath: "agents.yaml",
        model: { provider: "google", name: "gemini-2.5-flash" },
      },
    ];
    const models = detectModels([], agents, []);
    const manifestModel = models.find((m) => m.source === "manifest");
    expect(manifestModel).toBeDefined();
    expect(manifestModel?.confidence).toBe("high");
    expect(manifestModel?.provider).toBe("google");
    expect(manifestModel?.model).toBe("gemini-2.5-flash");
  });

  it("gemini-2.5-flash in code is medium confidence", () => {
    const files: RepoFile[] = [makeRepoFile("src/agent.ts", "const model = 'gemini-2.5-flash';")];
    const models = detectModels(files, [], []);
    const codeModel = models.find((m) => m.source === "code");
    expect(codeModel).toBeDefined();
    expect(codeModel?.confidence).toBe("medium");
    expect(codeModel?.provider).toBe("google");
  });

  it("OPENAI_API_KEY in .env.example creates provider-only detection", () => {
    const files: RepoFile[] = [
      makeRepoFile(".env.example", "OPENAI_API_KEY=sk-example\n", "environment"),
    ];
    const models = detectModels(files, [], []);
    const env = models.find((m) => m.source === "env");
    expect(env).toBeDefined();
    expect(env?.provider).toBe("openai");
    expect(env?.model).toBeUndefined();
  });

  it("does not expose secret values in detected configs", () => {
    const files: RepoFile[] = [
      makeRepoFile(".env.example", "ANTHROPIC_API_KEY=sk-ant-real-secret\n", "environment"),
    ];
    const models = detectModels(files, [], []);
    for (const m of models) {
      expect(JSON.stringify(m)).not.toContain("sk-ant-real-secret");
    }
  });
});

// ---------------------------------------------------------------------------
// D. Performance data
// ---------------------------------------------------------------------------

describe("detectModelPerformance", () => {
  it("parses eval-results.json runs", () => {
    const content = JSON.stringify({
      runs: [
        {
          agent_id: "editor_agent",
          provider: "google",
          model: "gemini-2.5-flash",
          eval_id: "blog_quality",
          score: 0.87,
          latency_ms: 2100,
          input_tokens: 1800,
          output_tokens: 700,
          cost_usd: 0.0032,
        },
      ],
    });
    const files: RepoFile[] = [makeRepoFile("eval-results.json", content)];
    const perf = detectModelPerformance(files);
    expect(perf).toHaveLength(1);
    expect(perf[0].agentId).toBe("editor_agent");
    expect(perf[0].score).toBeCloseTo(0.87);
    expect(perf[0].costUsd).toBeCloseTo(0.0032);
  });

  it("ignores invalid JSON in performance files", () => {
    const files: RepoFile[] = [makeRepoFile("eval-results.json", "not-json")];
    const perf = detectModelPerformance(files);
    expect(perf).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// E. Performance unavailable - no "best model" claim
// ---------------------------------------------------------------------------

describe("performance unavailable behavior", () => {
  it("graph emits performance_data_missing when models exist but no perf data", () => {
    const report = staticScan("owner/repo", [
      {
        path: "agents.yaml",
        size: 200,
        content:
          "agents:\n  - id: editor\n    name: Editor\n    model:\n      provider: google\n      name: gemini-2.5-flash\n",
      },
    ]);
    expect(
      report.systemGraph!.warnings.some((w) => w.type === "performance_data_missing"),
    ).toBe(true);
  });

  it("markdown export labels performance as unavailable when no perf data", () => {
    const report = staticScan("owner/repo", [
      {
        path: "agents.yaml",
        size: 200,
        content:
          "agents:\n  - id: editor\n    name: Editor\n    model:\n      provider: google\n      name: gemini-2.5-flash\n",
      },
    ]);
    const md = exportReportMarkdown(report);
    expect(md).toContain("Performance unavailable");
    expect(md).not.toMatch(/best model is/i);
  });
});

// ---------------------------------------------------------------------------
// F. Export sections
// ---------------------------------------------------------------------------

describe("markdown export sections", () => {
  it("includes AI System Graph Summary", () => {
    const report = staticScan("owner/repo", [
      {
        path: "agents.yaml",
        size: 200,
        content: "agents:\n  - id: editor\n    name: Editor\n",
      },
    ]);
    const md = exportReportMarkdown(report);
    expect(md).toContain("## AI System Graph Summary");
  });

  it("includes Model / Provider Matrix", () => {
    const report = staticScan("owner/repo", [
      {
        path: "agents.yaml",
        size: 200,
        content:
          "agents:\n  - id: editor\n    name: Editor\n    model:\n      provider: google\n      name: gemini-2.5-flash\n",
      },
    ]);
    const md = exportReportMarkdown(report);
    expect(md).toContain("## Model / Provider Matrix");
    expect(md).toContain("google");
  });

  it("does not include raw secrets in JSON of detectedModels", () => {
    const report = staticScan("owner/repo", [
      {
        path: ".env.example",
        size: 60,
        content: "OPENAI_API_KEY=sk-real-leak-12345\n",
      },
    ]);
    const json = JSON.stringify(report.detectedModels ?? []);
    expect(json).not.toContain("sk-real-leak-12345");
  });
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function agentFixture(overrides: Partial<DetectedAgent>): DetectedAgent {
  return {
    id: "test-agent",
    name: "Test Agent",
    promptPaths: ["prompts/test.md"],
    toolNames: ["test_tool"],
    evalPaths: ["evals/test.yaml"],
    risks: [],
    source: "explicit",
    confidence: "high",
    ...overrides,
  };
}

function makeRepoFile(
  path: string,
  content: string,
  classification: RepoFile["classification"] = "source_code",
): RepoFile {
  const parts = path.split("/");
  const name = parts[parts.length - 1];
  return {
    path,
    name,
    extension: name.includes(".") ? name.split(".").pop() ?? "" : "",
    size: content.length,
    content,
    classification,
    fileContext: "production",
    redacted: false,
    ignored: false,
  };
}
