import { describe, expect, it } from "vitest";
import { classifyFile } from "../classifyFiles";
import { shouldIgnorePath } from "../ignoreRules";
import { redactSecrets } from "../redactSecrets";
import { staticScan } from "../staticScan";

describe("scanner hardening", () => {
  it("classifies AGENTS.md as documentation", () => {
    expect(classifyFile("AGENTS.md")).toBe("documentation");
  });

  it("classifies CLAUDE.md as documentation", () => {
    expect(classifyFile("CLAUDE.md")).toBe("documentation");
  });

  it("classifies agents.yaml as agent_config", () => {
    expect(classifyFile("agents.yaml")).toBe("agent_config");
  });

  it("ignores .env files except .env.example", () => {
    expect(shouldIgnorePath(".env.staging").ignored).toBe(true);
    expect(shouldIgnorePath(".env.production.local").ignored).toBe(true);
    expect(shouldIgnorePath(".env.example").ignored).toBe(false);
  });

  it("does not flag docs mentioning write verbs as write-tool risk", () => {
    const report = staticScan("owner/repo", [
      {
        path: "docs/setup.md",
        size: 80,
        content: "Use this doc to create, update, and post setup notes.",
      },
    ]);

    expect(report.findings.some((finding) => finding.id === "write-tools-without-approval")).toBe(false);
  });

  it("does not extract package.json name as a detected tool", () => {
    const report = staticScan("owner/repo", [
      {
        path: "package.json",
        size: 30,
        content: '{ "name": "agentpulse" }',
      },
    ]);

    expect(report.detectedTools).not.toContain("agentpulse");
  });

  it("flags write tools without approval policy", () => {
    const report = staticScan("owner/repo", [
      {
        path: "tools/email.ts",
        size: 120,
        content: 'export const sendEmailTool = { name: "send_email", description: "Send email." };',
      },
    ]);

    const finding = report.findings.find((item) => item.id === "write-tools-without-approval");
    expect(finding?.severity).toBe("high");
  });

  it("does not flag write tools with approval policy", () => {
    const report = staticScan("owner/repo", [
      {
        path: "tools/email.ts",
        size: 150,
        content: 'export const sendEmailTool = { name: "send_email", requiresApproval: true };',
      },
    ]);

    expect(report.findings.some((finding) => finding.id === "write-tools-without-approval")).toBe(false);
  });

  it("detects multiple agents from agents.yaml", () => {
    const report = staticScan("owner/repo", [
      {
        path: "agents.yaml",
        size: 380,
        content: `agents:
  - id: brand_strategy_agent
    name: Brand Strategy Agent
    prompt_path: prompts/brand.md
    tools:
      - competitor_search
    evals:
      - evals/specificity.yaml

  - id: research_agent
    name: Research Agent
    prompt_path: prompts/research.md
    tools:
      - web_search
    evals:
      - evals/source_quality.yaml
`,
      },
    ]);

    expect(report.detectedAgents).toHaveLength(2);
    expect(report.detectedAgents.map((agent) => agent.id)).toEqual([
      "brand_strategy_agent",
      "research_agent",
    ]);
  });

  it("matches Anthropic keys before generic OpenAI keys", () => {
    const result = redactSecrets("ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstuvwxyz123456");

    expect(result.matches).toContain("Anthropic API key");
    expect(result.matches).not.toContain("OpenAI API key");
  });
});
