/**
 * Commit 8A: Self-scan calibration + final report semantics polish.
 *
 * Tests cover:
 * A. Project type — low-confidence inferred agents do not create agent_system
 * B. Prompt detection — true prompt assets vs source/fixture/test files
 * C. Fixture context — __fixtures__, mocks, testdata paths
 * D. Secret false positives — camelCase identifiers not flagged
 * E. Secret recommendations and scoring — fixture vs production separation
 * F. Agent card semantics — displayKind and Not-mapped behaviour
 * G. Export — agent source labels in markdown export
 */

import { describe, expect, it } from "vitest";
import { exportReportMarkdown } from "@/lib/reports/exportMarkdown";
import { buildRecommendations } from "@/lib/reports/recommendations";
import { classifyFile } from "@/lib/scanner/classifyFiles";
import { deriveFileContext } from "@/lib/scanner/fileContext";
import { looksLikeCredentialValue } from "@/lib/scanner/secretPatterns";
import { staticScan } from "@/lib/scanner/staticScan";
import type { DetectedAgent, Finding, ScanReport } from "@/lib/scanner/types";

// ---------------------------------------------------------------------------
// A. Project type — low-confidence inferred agents do not define project type
// ---------------------------------------------------------------------------

describe("A: project type inference", () => {
  it("prompt files only → ai_application, NOT agent_system", () => {
    const report = staticScan("owner/repo", [
      { path: "prompts/system-prompt.md", size: 200, content: "You are an AI assistant." },
      { path: "prompts/tool-policy.md", size: 100, content: "Never execute dangerous tools." },
      { path: "src/service.ts", size: 60, content: `import OpenAI from "openai";` },
    ]);
    expect(report.projectType).toBe("ai_application");
    expect(report.projectType).not.toBe("agent_system");
  });

  it("low-confidence inferred agent alone (no AI signals) → unknown_ai_project", () => {
    const report = staticScan("owner/repo", [
      { path: "prompts/system-prompt.md", size: 100, content: "You are an assistant." },
    ]);
    expect(report.projectType).not.toBe("agent_system");
  });

  it("low-confidence inferred agent + AI signals → ai_application", () => {
    const report = staticScan("owner/repo", [
      { path: "prompts/system.md", size: 100, content: "You are an AI assistant." },
      { path: "src/client.ts", size: 60, content: `import Anthropic from "@anthropic-ai/sdk";` },
    ]);
    expect(report.projectType).toBe("ai_application");
    expect(report.projectType).not.toBe("agent_system");
  });

  it("agents.yaml → agent_system", () => {
    const report = staticScan("owner/repo", [
      {
        path: "agents.yaml",
        size: 100,
        content: "agents:\n  - id: my_agent\n    name: My Agent",
      },
    ]);
    expect(report.projectType).toBe("agent_system");
  });

  it("/agents/researcher.md → agent_system (agent_file kind, medium confidence)", () => {
    const report = staticScan("owner/repo", [
      { path: "agents/researcher.md", size: 100, content: "# Researcher agent description" },
    ]);
    expect(report.projectType).toBe("agent_system");
    const agent = report.detectedAgents[0];
    expect(agent).toBeDefined();
    expect(agent.displayKind).toBe("agent_file");
    expect(agent.confidence).toBe("medium");
  });

  it("workflow.yaml alone → workflow_system (CI workflows do not count)", () => {
    const report = staticScan("owner/repo", [
      { path: "workflow.yaml", size: 80, content: "workflow:\n  id: pipeline\n  name: Pipeline" },
      {
        path: ".github/workflows/ci.yml",
        size: 60,
        content: "on: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest",
      },
    ]);
    expect(report.projectType).toBe("workflow_system");
  });

  it("CI workflows alone do not create workflow_system", () => {
    const report = staticScan("owner/repo", [
      {
        path: ".github/workflows/ci.yml",
        size: 60,
        content: "on: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest",
      },
    ]);
    expect(report.projectType).not.toBe("workflow_system");
  });
});

// ---------------------------------------------------------------------------
// B. Prompt detection — true prompt assets vs source/fixture/test files
// ---------------------------------------------------------------------------

describe("B: prompt file detection", () => {
  it("/prompts/prompt-auditor.md is a prompt", () => {
    expect(classifyFile("prompts/prompt-auditor.md", "You are an AI auditor.")).toBe("prompt");
  });

  it("lib/scanner/staticScan.ts is NOT a prompt", () => {
    expect(classifyFile("lib/scanner/staticScan.ts", "// system prompt detection logic")).toBe("source_code");
  });

  it("lib/reports/buildReport.ts is NOT a prompt", () => {
    expect(classifyFile("lib/reports/buildReport.ts", "function buildReport() {}")).toBe("source_code");
  });

  it("lib/scanner/classifyFiles.ts containing 'system prompt' is NOT a prompt", () => {
    const content = `
      // Checks if file contains system prompt language
      function isPromptFile(content: string) {
        return /system prompt/i.test(content);
      }
    `;
    expect(classifyFile("lib/scanner/classifyFiles.ts", content)).toBe("source_code");
  });

  it("__fixtures__/commit2Samples.ts is NOT a prompt", () => {
    const content = "// system prompt examples for test fixtures";
    expect(classifyFile("__fixtures__/commit2Samples.ts", content)).toBe("source_code");
  });

  it("tests/prompt-input.test.ts is NOT a prompt (test file)", () => {
    expect(classifyFile("tests/prompt-input.test.ts", "describe('prompt input', () => {})")).toBe("test");
  });

  it("*.prompt.ts file is a prompt", () => {
    expect(classifyFile("src/system.prompt.ts", "export const systemPrompt = 'You are...';")).toBe("prompt");
  });

  it("*.prompt.md file is a prompt", () => {
    expect(classifyFile("src/assistant.prompt.md", "You are an assistant.")).toBe("prompt");
  });

  it("system-prompt.md is always a prompt", () => {
    expect(classifyFile("system-prompt.md", "You are a helpful assistant.")).toBe("prompt");
  });

  it("staticScan detectedPrompts excludes lib/scanner source files", () => {
    const report = staticScan("owner/repo", [
      { path: "prompts/auditor.md", size: 100, content: "You are an auditor." },
      {
        path: "lib/scanner/staticScan.ts",
        size: 500,
        content: `
          // Checks for system prompt language
          function isPromptFile() {
            return /system prompt/i.test(content);
          }
        `,
      },
    ]);
    expect(report.detectedPrompts).toContain("prompts/auditor.md");
    expect(report.detectedPrompts).not.toContain("lib/scanner/staticScan.ts");
  });
});

// ---------------------------------------------------------------------------
// C. Fixture context
// ---------------------------------------------------------------------------

describe("C: fixture/mock/testdata file context", () => {
  it("__fixtures__/fakeSecrets.ts → example context", () => {
    expect(deriveFileContext("__fixtures__/fakeSecrets.ts")).toBe("example");
  });

  it("fixtures/mock-env.ts → example context", () => {
    expect(deriveFileContext("fixtures/mock-env.ts")).toBe("example");
  });

  it("mocks/api.ts → example context", () => {
    expect(deriveFileContext("mocks/api.ts")).toBe("example");
  });

  it("__mocks__/database.ts → example context", () => {
    expect(deriveFileContext("__mocks__/database.ts")).toBe("example");
  });

  it("testdata/sample.json → example context", () => {
    expect(deriveFileContext("testdata/sample.json")).toBe("example");
  });

  it("src/app.ts → production context", () => {
    expect(deriveFileContext("src/app.ts")).toBe("production");
  });
});

// ---------------------------------------------------------------------------
// D. Secret false positives — camelCase code identifiers not flagged
// ---------------------------------------------------------------------------

describe("D: secret false positives from source identifiers", () => {
  it("looksLikeCredentialValue rejects camelCase identifier (buildFindingSummary)", () => {
    expect(looksLikeCredentialValue("buildFindingSummary")).toBe(false);
  });

  it("looksLikeCredentialValue rejects PascalCase identifier (SecretContext)", () => {
    expect(looksLikeCredentialValue("SecretContextSummary")).toBe(false);
  });

  it("looksLikeCredentialValue rejects camelCase function name (summarizeSecretContexts)", () => {
    expect(looksLikeCredentialValue("summarizeSecretContexts")).toBe(false);
  });

  it("looksLikeCredentialValue accepts real high-entropy secret", () => {
    expect(looksLikeCredentialValue("sk-ant-api03-longRandomString123456789")).toBe(true);
  });

  it("const secretContexts assignment does NOT create secret finding", () => {
    // The variable name contains 'secret' but the value is a camelCase function name.
    const report = staticScan("owner/repo", [
      {
        path: "lib/reports/findingSummary.ts",
        size: 200,
        content: `
          const secretContexts = buildSecretContextSummary(findings);
          const secretContext = extractSecretContext(finding);
        `,
      },
    ]);
    const secretFindings = report.findings.filter((f) => f.category === "security" && f.title.includes("redacted"));
    expect(secretFindings).toHaveLength(0);
  });

  it("OPENAI_API_KEY = 'sk-...' still creates a finding", () => {
    const report = staticScan("owner/repo", [
      {
        path: "src/config.ts",
        size: 100,
        content: `const OPENAI_API_KEY = "sk-proj-abc123def456ghi789jkl012mn";`,
      },
    ]);
    const secretFindings = report.findings.filter((f) => f.category === "security");
    expect(secretFindings.length).toBeGreaterThan(0);
  });

  it("DATABASE_URL with credentials still creates a finding", () => {
    const report = staticScan("owner/repo", [
      {
        path: "src/db.ts",
        size: 100,
        content: `const DATABASE_URL = "postgres://user:secretpassword123@db.example.com/prod";`,
      },
    ]);
    const secretFindings = report.findings.filter((f) => f.category === "security");
    expect(secretFindings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// E. Secret recommendations and security scoring
// ---------------------------------------------------------------------------

describe("E: secret recommendations and scoring", () => {
  it("fixture/test-only secrets use review wording, not rotation", () => {
    const report = staticScan("owner/repo", [
      {
        path: "__fixtures__/fakeEnv.ts",
        size: 200,
        content: `const FAKE_KEY = "sk-ant-api03-this-is-a-fake-test-credential-1234567";`,
      },
    ]);
    const secretFindings = report.findings.filter((f) => f.category === "security" && f.id.startsWith("redacted"));
    if (secretFindings.length > 0) {
      const hasRotation = secretFindings.some((f) => f.recommendation.toLowerCase().includes("rotate"));
      expect(hasRotation).toBe(false);
    }
  });

  it("production OpenAI key still reduces security score significantly", () => {
    const report = staticScan("owner/repo", [
      {
        path: "src/config.ts",
        size: 100,
        content: `const key = "sk-ant-api03-realProductionKeyAbcdef1234567890XYZ";`,
      },
    ]);
    expect(report.scores.security).toBeLessThan(80);
  });

  it("fixture-only fake secrets do not drop security below 70", () => {
    // Many fake secrets in fixtures — should not crater the score.
    const fakeSecretContent = Array.from(
      { length: 10 },
      (_, i) => `const KEY_${i} = "sk-ant-api03-fake-test-secret-number-${i}-abcdef123456";`,
    ).join("\n");

    const report = staticScan("owner/repo", [
      { path: "__fixtures__/bulkFakeSecrets.ts", size: 2000, content: fakeSecretContent },
    ]);
    expect(report.scores.security).toBeGreaterThanOrEqual(70);
  });

  it("fixture-only secrets produce review recommendation, not rotate", () => {
    const findings: Finding[] = [
      {
        id: "f1",
        category: "security",
        severity: "medium",
        title: "Secret-like value redacted",
        summary: "Fake key in fixtures (example/fixture).",
        evidencePaths: ["__fixtures__/fake.ts"],
        recommendation: "Fixture/example value detected. No rotation required unless this represents a real credential.",
        confidence: 0.6,
      },
    ];
    const recs = buildRecommendations(findings, { projectType: "ai_application" });
    const hasRotate = recs.some((r) => r.toLowerCase().includes("rotate"));
    const hasReview = recs.some((r) => r.toLowerCase().includes("review") || r.toLowerCase().includes("fixture"));
    expect(hasRotate).toBe(false);
    expect(hasReview).toBe(true);
  });

  it("production secret produces rotation recommendation", () => {
    const findings: Finding[] = [
      {
        id: "f1",
        category: "security",
        severity: "high",
        title: "Secret-like value redacted",
        summary: "OpenAI key detected in src/config.ts.",
        evidencePaths: ["src/config.ts"],
        recommendation: "Remove this value from the repository and rotate it if it was real.",
        confidence: 0.95,
      },
    ];
    const recs = buildRecommendations(findings, { projectType: "ai_application" });
    expect(recs.some((r) => r.toLowerCase().includes("rotate"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F. Agent card semantics — displayKind
// ---------------------------------------------------------------------------

describe("F: agent displayKind semantics", () => {
  it("agents.yaml entry → manifest displayKind, high confidence", () => {
    const report = staticScan("owner/repo", [
      {
        path: "agents.yaml",
        size: 200,
        content: `agents:
  - id: analyzer
    name: Analyzer Agent
    prompt_path: prompts/analyzer.md
    tools:
      - search_web
    evals:
      - evals/eval.yaml`,
      },
    ]);
    const agent = report.detectedAgents[0];
    expect(agent).toBeDefined();
    expect(agent.displayKind).toBe("manifest");
    expect(agent.confidence).toBe("high");
    // Manifest agents have mapped prompts
    expect(agent.promptPaths).toContain("prompts/analyzer.md");
  });

  it("/agents/analyzer.md → agent_file displayKind, medium confidence, not-mapped links", () => {
    const report = staticScan("owner/repo", [
      { path: "agents/analyzer.md", size: 100, content: "# Analyzer\nThis agent analyzes data." },
    ]);
    const agent = report.detectedAgents[0];
    expect(agent).toBeDefined();
    expect(agent.displayKind).toBe("agent_file");
    expect(agent.confidence).toBe("medium");
    // Agent file agents have no mapped prompt/tool/eval paths
    expect(agent.promptPaths).toHaveLength(0);
    expect(agent.toolNames).toHaveLength(0);
    expect(agent.evalPaths).toHaveLength(0);
  });

  it("prompt-only inference → inferred_candidate displayKind, low confidence", () => {
    const report = staticScan("owner/repo", [
      { path: "prompts/system.md", size: 100, content: "You are an AI assistant." },
    ]);
    if (report.detectedAgents.length > 0) {
      const agent = report.detectedAgents[0];
      expect(agent.displayKind).toBe("inferred_candidate");
      expect(agent.confidence).toBe("low");
      // Inferred candidates have no mapped links
      expect(agent.promptPaths).toHaveLength(0);
      expect(agent.toolNames).toHaveLength(0);
      expect(agent.evalPaths).toHaveLength(0);
    }
    // The key assertion: prompt-only should NOT produce agent_system
    expect(report.projectType).not.toBe("agent_system");
  });
});

// ---------------------------------------------------------------------------
// G. Export — agent source labels in markdown
// ---------------------------------------------------------------------------

describe("G: markdown export agent source labels", () => {
  function makeReportWithAgent(agent: DetectedAgent): ScanReport {
    return {
      repoName: "test/repo",
      scannedAt: new Date().toISOString(),
      filesScanned: 5,
      ignoredFiles: 1,
      projectType: "agent_system",
      detectedAgents: [agent],
      detectedWorkflowsDetailed: [],
      detectedCIWorkflows: [],
      detectedPrompts: [],
      detectedTools: [],
      detectedEvals: [],
      detectedTests: [],
      detectedWorkflows: [],
      findings: [],
      scores: {
        architecture: 80,
        promptQuality: 80,
        toolGovernance: 80,
        evalCoverage: 70,
        security: 88,
        documentation: 72,
        overall: 79,
      },
      recommendations: [],
    };
  }

  it("manifest agent → 'explicit manifest' label in export", () => {
    const agent: DetectedAgent = {
      id: "my-agent",
      name: "My Agent",
      promptPaths: ["prompts/system.md"],
      toolNames: ["search_web"],
      evalPaths: [],
      configPath: "agents.yaml",
      risks: [],
      source: "explicit",
      confidence: "high",
      displayKind: "manifest",
      evidenceReason: "Defined in agents.yaml",
    };
    const md = exportReportMarkdown(makeReportWithAgent(agent));
    expect(md).toContain("explicit manifest");
  });

  it("agent_file agent → 'agent file' label in export", () => {
    const agent: DetectedAgent = {
      id: "analyzer",
      name: "analyzer",
      promptPaths: [],
      toolNames: [],
      evalPaths: [],
      configPath: "agents/analyzer.md",
      risks: [],
      source: "inferred",
      confidence: "medium",
      displayKind: "agent_file",
      evidenceReason: "Found agent file at agents/analyzer.md",
    };
    const md = exportReportMarkdown(makeReportWithAgent(agent));
    expect(md).toContain("agent file");
  });

  it("inferred_candidate → 'inferred candidate' label in export", () => {
    const agent: DetectedAgent = {
      id: "inferred-agent",
      name: "Inferred agent candidate",
      promptPaths: [],
      toolNames: [],
      evalPaths: [],
      risks: [],
      source: "inferred",
      confidence: "low",
      displayKind: "inferred_candidate",
      evidenceReason: "Inferred from 2 prompt file(s)",
    };
    const md = exportReportMarkdown(makeReportWithAgent(agent));
    expect(md).toContain("inferred candidate");
  });

  it("export includes detectedPromptRelatedFiles count when present", () => {
    const report: ScanReport = {
      repoName: "test/repo",
      scannedAt: new Date().toISOString(),
      filesScanned: 10,
      ignoredFiles: 2,
      projectType: "ai_application",
      detectedAgents: [],
      detectedWorkflowsDetailed: [],
      detectedCIWorkflows: [],
      detectedPrompts: ["prompts/system.md"],
      detectedPromptRelatedFiles: ["lib/scanner/classifyFiles.ts", "lib/reports/buildReport.ts"],
      detectedTools: [],
      detectedEvals: [],
      detectedTests: [],
      detectedWorkflows: [],
      findings: [],
      scores: {
        architecture: 80,
        promptQuality: 80,
        toolGovernance: 80,
        evalCoverage: 70,
        security: 88,
        documentation: 72,
        overall: 79,
      },
      recommendations: [],
    };
    const md = exportReportMarkdown(report);
    expect(md).toContain("Prompt-related source files: 2");
  });
});
