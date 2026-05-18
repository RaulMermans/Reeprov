/**
 * Commit 8B: Product-scope detection + Python agent modules.
 *
 * Tests cover:
 * A. Assistant tooling exclusion — .claude/**, .cursor/**, .vscode/** are not product agents
 * B. Python product agent detection — *_agent.py, *_evaluator.py, *_judge.py etc.
 * C. Prompt module detection — prompts.py with _PROMPT constants vs llm/client.py
 * D. Project type — assistant tooling alone does not create agent_system
 * E. Markdown export — assistant tooling section present, .claude agents excluded from product section
 * F. DetectedAssistantTooling field populated correctly
 */

import { describe, expect, it } from "vitest";
import { exportReportMarkdown } from "@/lib/reports/exportMarkdown";
import { classifyFile } from "@/lib/scanner/classifyFiles";
import { staticScan } from "@/lib/scanner/staticScan";

// ---------------------------------------------------------------------------
// A. Assistant tooling exclusion
// ---------------------------------------------------------------------------

describe("A: assistant tooling exclusion", () => {
  it(".claude/skills/skill-creator/agents/analyzer.md is not a product agent", () => {
    const report = staticScan("owner/repo", [
      {
        path: ".claude/skills/skill-creator/agents/analyzer.md",
        size: 200,
        content: "# Analyzer agent\nYou analyze code.",
      },
    ]);
    // Should not appear in detectedAgents
    expect(report.detectedAgents.some((a) => a.configPath?.includes(".claude/"))).toBe(false);
    // Should appear in detectedAssistantTooling
    expect(report.detectedAssistantTooling?.some((t) => t.path.includes(".claude/"))).toBe(true);
  });

  it(".cursor/rules/agent.md is not a product agent", () => {
    const report = staticScan("owner/repo", [
      {
        path: ".cursor/rules/agent.md",
        size: 100,
        content: "# Cursor agent rule",
      },
    ]);
    expect(report.detectedAgents.some((a) => a.configPath?.includes(".cursor/"))).toBe(false);
    expect(report.detectedAssistantTooling?.some((t) => t.path.includes(".cursor/"))).toBe(true);
  });

  it(".vscode/settings.json is not product agent evidence", () => {
    const report = staticScan("owner/repo", [
      {
        path: ".vscode/settings.json",
        size: 50,
        content: '{ "editor.tabSize": 2 }',
      },
    ]);
    expect(report.detectedAgents).toHaveLength(0);
    expect(report.detectedAssistantTooling?.some((t) => t.path === ".vscode/settings.json")).toBe(true);
  });

  it("multiple .claude skill files all appear in detectedAssistantTooling", () => {
    const report = staticScan("owner/repo", [
      { path: ".claude/skills/skill-creator/agents/analyzer.md", size: 100, content: "Analyzer" },
      { path: ".claude/skills/skill-creator/agents/comparator.md", size: 100, content: "Comparator" },
      { path: ".claude/skills/skill-creator/agents/grader.md", size: 100, content: "Grader" },
    ]);
    expect(report.detectedAgents).toHaveLength(0);
    expect(report.detectedAssistantTooling?.length).toBe(3);
  });

  it("assistant tooling kind for .claude/skills/ is claude_skill", () => {
    const report = staticScan("owner/repo", [
      { path: ".claude/skills/skill-creator/SKILL.md", size: 100, content: "# Skill" },
    ]);
    const tooling = report.detectedAssistantTooling?.find((t) => t.path.includes(".claude/skills/"));
    expect(tooling?.kind).toBe("claude_skill");
  });

  it("assistant tooling kind for .cursor/rules/ is cursor_rule", () => {
    const report = staticScan("owner/repo", [
      { path: ".cursor/rules/my-rule.md", size: 50, content: "# Rule" },
    ]);
    const tooling = report.detectedAssistantTooling?.find((t) => t.path.includes(".cursor/"));
    expect(tooling?.kind).toBe("cursor_rule");
  });

  it("assistant tooling kind for .vscode/ is vscode_config", () => {
    const report = staticScan("owner/repo", [
      { path: ".vscode/extensions.json", size: 30, content: "{}" },
    ]);
    const tooling = report.detectedAssistantTooling?.find((t) => t.path.includes(".vscode/"));
    expect(tooling?.kind).toBe("vscode_config");
  });
});

// ---------------------------------------------------------------------------
// B. Python product agent detection
// ---------------------------------------------------------------------------

describe("B: Python product agent detection", () => {
  it("blogagent/agents/editor_agent.py → detected as Editor Agent", () => {
    const report = staticScan("blogagent/blogagent", [
      {
        path: "blogagent/agents/editor_agent.py",
        size: 200,
        content: "class EditorAgent:\n    def run(self): pass",
      },
    ]);
    const agent = report.detectedAgents.find((a) => a.configPath?.includes("editor_agent.py"));
    expect(agent).toBeDefined();
    expect(agent?.name).toBe("Editor Agent");
    expect(agent?.displayKind).toBe("agent_file");
    expect(agent?.confidence).toBe("medium");
  });

  it("blogagent/agents/fact_check_evaluator.py → detected as Fact Check Evaluator", () => {
    const report = staticScan("blogagent/blogagent", [
      {
        path: "blogagent/agents/fact_check_evaluator.py",
        size: 200,
        content: "class FactCheckEvaluator:\n    def evaluate(self): pass",
      },
    ]);
    const agent = report.detectedAgents.find((a) => a.configPath?.includes("fact_check_evaluator.py"));
    expect(agent?.name).toBe("Fact Check Evaluator");
    expect(agent?.displayKind).toBe("agent_file");
  });

  it("blogagent/agents/citation_judge.py → detected as Citation Judge", () => {
    const report = staticScan("blogagent/blogagent", [
      {
        path: "blogagent/agents/citation_judge.py",
        size: 200,
        content: "class CitationJudge:\n    def judge(self): pass",
      },
    ]);
    const agent = report.detectedAgents.find((a) => a.configPath?.includes("citation_judge.py"));
    expect(agent?.name).toBe("Citation Judge");
    expect(agent?.displayKind).toBe("agent_file");
  });

  it("Python product agents make project type agent_system", () => {
    const report = staticScan("blogagent/blogagent", [
      { path: "blogagent/agents/editor_agent.py", size: 200, content: "class EditorAgent: pass" },
      { path: "blogagent/agents/fact_check_evaluator.py", size: 200, content: "class FactCheck: pass" },
    ]);
    expect(report.projectType).toBe("agent_system");
  });

  it("Python product agent prompt/tool/eval links are Not mapped (no manifest)", () => {
    const report = staticScan("blogagent/blogagent", [
      { path: "blogagent/agents/editor_agent.py", size: 200, content: "class EditorAgent: pass" },
    ]);
    const agent = report.detectedAgents[0];
    expect(agent).toBeDefined();
    expect(agent.promptPaths).toHaveLength(0);
    expect(agent.toolNames).toHaveLength(0);
    expect(agent.evalPaths).toHaveLength(0);
  });

  it("detects additional Python agent suffixes: _judge, _critic, _planner, _router", () => {
    const files = [
      { path: "agents/output_critic.py", size: 100, content: "class Critic: pass" },
      { path: "agents/task_planner.py", size: 100, content: "class Planner: pass" },
      { path: "agents/request_router.py", size: 100, content: "class Router: pass" },
    ];
    const report = staticScan("owner/repo", files);
    const names = report.detectedAgents.map((a) => a.name);
    expect(names).toContain("Output Critic");
    expect(names).toContain("Task Planner");
    expect(names).toContain("Request Router");
  });

  it(".claude/skills agent files are NOT detected as product agents", () => {
    const report = staticScan("owner/repo", [
      { path: ".claude/skills/skill-creator/agents/analyzer.md", size: 100, content: "Analyzer" },
      { path: "blogagent/agents/editor_agent.py", size: 200, content: "class EditorAgent: pass" },
    ]);
    // Only the product agent should appear
    expect(report.detectedAgents).toHaveLength(1);
    expect(report.detectedAgents[0].name).toBe("Editor Agent");
    expect(report.detectedAssistantTooling?.some((t) => t.path.includes(".claude/"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C. Prompt module detection
// ---------------------------------------------------------------------------

describe("C: prompt module detection", () => {
  it("blogagent/agents/prompts.py with _PROMPT constants → detectedPrompts", () => {
    const report = staticScan("blogagent/blogagent", [
      {
        path: "blogagent/agents/prompts.py",
        size: 300,
        content: 'RESEARCH_PLAN_PROMPT = """\nYou are a research agent.\n"""\nEDITOR_PROMPT = "Edit the draft."',
      },
    ]);
    expect(report.detectedPrompts).toContain("blogagent/agents/prompts.py");
  });

  it("classifyFile: prompts.py with _PROMPT constants → prompt", () => {
    expect(
      classifyFile("blogagent/agents/prompts.py", 'RESEARCH_PLAN_PROMPT = "You are a research agent."'),
    ).toBe("prompt");
  });

  it("classifyFile: prompts.py without _PROMPT constants → source_code", () => {
    expect(
      classifyFile("blogagent/agents/prompts.py", "def build_prompt(user): return user"),
    ).toBe("source_code");
  });

  it("blogagent/llm/client.py is NOT in detectedPrompts", () => {
    const report = staticScan("blogagent/blogagent", [
      {
        path: "blogagent/llm/client.py",
        size: 300,
        content: "import openai\ndef call_model(prompt): return openai.chat(prompt)",
      },
    ]);
    expect(report.detectedPrompts).not.toContain("blogagent/llm/client.py");
  });

  it(".claude/skills/.../SKILL.md is not a product prompt", () => {
    const report = staticScan("owner/repo", [
      {
        path: ".claude/skills/skill-creator/SKILL.md",
        size: 200,
        content: "You are an AI assistant. system prompt: analyze code.",
      },
    ]);
    expect(report.detectedPrompts).not.toContain(".claude/skills/skill-creator/SKILL.md");
  });

  it("tests/prompt-input.test.ts is not a product prompt", () => {
    const report = staticScan("owner/repo", [
      {
        path: "tests/prompt-input.test.ts",
        size: 100,
        content: "describe('prompt input', () => { it('works', () => {}); });",
      },
    ]);
    expect(report.detectedPrompts).not.toContain("tests/prompt-input.test.ts");
  });

  it("classifyFile: .claude/skills/.../SKILL.md is not prompt", () => {
    expect(
      classifyFile(
        ".claude/skills/skill-creator/SKILL.md",
        "You are an AI assistant. system prompt: analyze code.",
      ),
    ).not.toBe("prompt");
  });
});

// ---------------------------------------------------------------------------
// D. Project type
// ---------------------------------------------------------------------------

describe("D: project type with assistant tooling", () => {
  it("assistant tooling only (.claude files) does not create agent_system", () => {
    const report = staticScan("owner/repo", [
      { path: ".claude/skills/skill-creator/agents/analyzer.md", size: 100, content: "Analyzer" },
      { path: ".claude/skills/skill-creator/agents/grader.md", size: 100, content: "Grader" },
    ]);
    expect(report.projectType).not.toBe("agent_system");
  });

  it("assistant tooling + prompt files but no product agents → ai_application or unknown", () => {
    const report = staticScan("owner/repo", [
      { path: ".claude/skills/skill-creator/agents/analyzer.md", size: 100, content: "Analyzer" },
      { path: "prompts/system.md", size: 100, content: "You are an AI assistant." },
      { path: "src/client.ts", size: 60, content: 'import Anthropic from "@anthropic-ai/sdk";' },
    ]);
    expect(report.projectType).toBe("ai_application");
    expect(report.projectType).not.toBe("agent_system");
  });

  it("product Python agents make project type agent_system", () => {
    const report = staticScan("owner/repo", [
      { path: "agents/editor_agent.py", size: 200, content: "class EditorAgent: pass" },
    ]);
    expect(report.projectType).toBe("agent_system");
  });

  it("agents.yaml + workflow.yaml → hybrid_workflow_agent regardless of assistant tooling", () => {
    const report = staticScan("owner/repo", [
      { path: "agents.yaml", size: 100, content: "agents:\n  - id: my_agent\n    name: My Agent" },
      { path: "workflow.yaml", size: 80, content: "workflow:\n  id: pipeline\n  name: Pipeline" },
      { path: ".claude/skills/skill.md", size: 50, content: "Skill" },
    ]);
    expect(report.projectType).toBe("hybrid_workflow_agent");
  });

  it("assistant tooling alone (no product signals) → unknown_ai_project", () => {
    const report = staticScan("owner/repo", [
      { path: ".cursor/rules/style.md", size: 50, content: "# Style rules" },
      { path: ".vscode/settings.json", size: 30, content: "{}" },
    ]);
    expect(report.projectType).toBe("unknown_ai_project");
  });
});

// ---------------------------------------------------------------------------
// E. Markdown export
// ---------------------------------------------------------------------------

describe("E: markdown export", () => {
  it("assistant tooling section appears in export when tooling detected", () => {
    const report = staticScan("owner/repo", [
      { path: ".claude/skills/skill-creator/agents/analyzer.md", size: 100, content: "Analyzer" },
    ]);
    const md = exportReportMarkdown(report);
    expect(md).toContain("## Assistant Tooling");
    expect(md).toContain(".claude/skills/skill-creator/agents/analyzer.md");
  });

  it(".claude agent files do not appear under Detected Agents in export", () => {
    const report = staticScan("owner/repo", [
      { path: ".claude/skills/skill-creator/agents/analyzer.md", size: 100, content: "Analyzer" },
    ]);
    const md = exportReportMarkdown(report);
    const agentsSection = md.split("## Detected Agents")[1]?.split("##")[0] ?? "";
    expect(agentsSection).not.toContain(".claude/");
  });

  it("Python product agents appear under Detected Agents in export", () => {
    const report = staticScan("owner/repo", [
      { path: "blogagent/agents/editor_agent.py", size: 200, content: "class EditorAgent: pass" },
    ]);
    const md = exportReportMarkdown(report);
    const agentsSection = md.split("## Detected Agents")[1]?.split("##")[0] ?? "";
    expect(agentsSection).toContain("Editor Agent");
  });

  it("assistant tooling section absent when no tooling detected", () => {
    const report = staticScan("owner/repo", [
      { path: "agents.yaml", size: 100, content: "agents:\n  - id: my_agent\n    name: My Agent" },
    ]);
    const md = exportReportMarkdown(report);
    expect(md).not.toContain("## Assistant Tooling");
  });

  it("info finding for assistant tooling appears in export", () => {
    const report = staticScan("owner/repo", [
      { path: ".claude/skills/skill-creator/agents/analyzer.md", size: 100, content: "Analyzer" },
    ]);
    const md = exportReportMarkdown(report);
    expect(md).toContain("Assistant tooling detected");
  });
});

// ---------------------------------------------------------------------------
// F. detectedAssistantTooling field populated correctly
// ---------------------------------------------------------------------------

describe("F: detectedAssistantTooling field", () => {
  it("is empty array when no assistant tooling present", () => {
    const report = staticScan("owner/repo", [
      { path: "agents.yaml", size: 100, content: "agents:\n  - id: a\n    name: A" },
    ]);
    expect(report.detectedAssistantTooling).toHaveLength(0);
  });

  it("contains all .claude skill files", () => {
    const report = staticScan("owner/repo", [
      { path: ".claude/skills/skill-creator/agents/analyzer.md", size: 100, content: "Analyzer" },
      { path: ".claude/skills/skill-creator/agents/comparator.md", size: 100, content: "Comparator" },
      { path: ".claude/skills/skill-creator/agents/grader.md", size: 100, content: "Grader" },
    ]);
    expect(report.detectedAssistantTooling).toHaveLength(3);
  });

  it("assistant_agent kind for .claude/skills/.../agents/*.md", () => {
    const report = staticScan("owner/repo", [
      { path: ".claude/skills/skill-creator/agents/analyzer.md", size: 100, content: "Analyzer" },
    ]);
    const item = report.detectedAssistantTooling?.[0];
    expect(item?.kind).toBe("assistant_agent");
  });
});
