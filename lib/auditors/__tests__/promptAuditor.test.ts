import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promptAuditor } from "../promptAuditor";
import { PROMPT_EVIDENCE_LIMITS, selectPromptEvidence } from "../promptEvidence";
import { prepareRepoFiles } from "@/lib/scanner/staticScan";
import type { ScanReport } from "@/lib/scanner/types";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("prompt auditor feature flag", () => {
  it("does not call the LLM when the feature flag is disabled", async () => {
    process.env.ENABLE_LLM_AUDITORS = "false";
    const generateLLM = vi.fn();

    const result = await promptAuditor({
      report: reportWithPrompts([]),
      files: [],
      generateLLM,
    });

    expect(generateLLM).not.toHaveBeenCalled();
    expect(result.findings[0]?.id).toBe("auditor-no-prompts");
    expect(result.auditorStatus?.llmAuditorsEnabled).toBe(false);
  });

  it("returns a controlled finding for invalid LLM JSON", async () => {
    process.env.ENABLE_LLM_AUDITORS = "true";
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key";
    const files = prepareRepoFiles([
      {
        path: "prompts/support.md",
        size: 80,
        content: "System prompt: You are a support agent.",
      },
    ]);

    const result = await promptAuditor({
      report: reportWithPrompts(["prompts/support.md"]),
      files,
      generateLLM: vi.fn(async () => ({
        ok: true,
        result: {
          text: "not json",
          provider: "openai",
          model: "test-model",
        },
      })),
    });

    expect(result.findings[0]?.id).toBe("llm-prompt-auditor-invalid-json");
    expect(result.findings[0]?.severity).toBe("medium");
    expect(result.auditorStatus?.promptAuditorRan).toBe(false);
  });

  it("continues without calling the LLM when the provider key is missing", async () => {
    process.env.ENABLE_LLM_AUDITORS = "true";
    process.env.LLM_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    const generateLLM = vi.fn();

    const result = await promptAuditor({
      report: reportWithPrompts(["prompts/support.md"]),
      files: prepareRepoFiles([
        {
          path: "prompts/support.md",
          size: 80,
          content: "System prompt: You are a support agent.",
        },
      ]),
      generateLLM,
    });

    expect(generateLLM).not.toHaveBeenCalled();
    expect(result.findings[0]?.id).toBe("llm-prompt-auditor-not-configured");
    expect(result.auditorStatus?.promptAuditorRan).toBe(false);
  });
});

describe("prompt evidence selection", () => {
  it("caps prompt file count and includes relevant agent configs", () => {
    const promptPaths = Array.from({ length: 12 }, (_, index) => `prompts/small-${index}.md`);
    const files = prepareRepoFiles([
      ...promptPaths.map((path, index) => ({
        path,
        size: 80,
        content: `System prompt ${index}.`,
      })),
      {
        path: "agents.yaml",
        size: 60,
        content: "agents:\n  - prompt_path: prompts/small-0.md",
      },
    ]);

    const evidence = selectPromptEvidence(files, reportWithPrompts(promptPaths));

    expect(evidence.filter((item) => item.classification === "prompt")).toHaveLength(
      PROMPT_EVIDENCE_LIMITS.maxPromptFiles,
    );
    expect(evidence.map((item) => item.path)).toContain("agents.yaml");
  });

  it("excludes ignored files, env files, locks, and uses capped redacted snippets", () => {
    const promptPaths = Array.from({ length: 12 }, (_, index) => `prompts/prompt-${index}.md`);
    const files = prepareRepoFiles([
      ...promptPaths.map((path, index) => ({
        path,
        size: 5_200,
        content:
          index === 0
            ? `System prompt with key sk-${"a".repeat(24)} ${"x".repeat(4_500)}`
            : `System prompt ${index}. ${"x".repeat(4_500)}`,
      })),
      {
        path: "agents.yaml",
        size: 60,
        content: "agents:\n  - prompt_path: prompts/prompt-0.md",
      },
      {
        path: ".env.local",
        size: 30,
        content: "OPENAI_API_KEY=sk-secret",
      },
      {
        path: ".env.example",
        size: 30,
        content: "OPENAI_API_KEY=sk-example",
      },
      {
        path: "package-lock.json",
        size: 30,
        content: "{\"lockfileVersion\": 3}",
      },
      {
        path: "docs/prompt-notes.md",
        size: 80,
        content: "Documentation that mentions prompts.",
      },
    ]);

    const evidence = selectPromptEvidence(files, reportWithPrompts(promptPaths));
    const totalChars = evidence.reduce((sum, item) => sum + item.content.length, 0);
    const promptEvidence = evidence.filter((item) => item.classification === "prompt");

    expect(promptEvidence).toHaveLength(PROMPT_EVIDENCE_LIMITS.maxPromptFiles / 2);
    expect(totalChars).toBeLessThanOrEqual(PROMPT_EVIDENCE_LIMITS.maxTotalChars);
    expect(evidence.every((item) => item.content.length <= PROMPT_EVIDENCE_LIMITS.maxCharsPerFile)).toBe(true);
    expect(evidence.map((item) => item.path)).not.toContain(".env.local");
    expect(evidence.map((item) => item.path)).not.toContain(".env.example");
    expect(evidence.map((item) => item.path)).not.toContain("package-lock.json");
    expect(evidence.map((item) => item.path)).not.toContain("docs/prompt-notes.md");
    expect(evidence[0]?.content).toContain("[REDACTED:OpenAI API key]");
    expect(evidence[0]?.content).not.toContain(`sk-${"a".repeat(24)}`);
  });
});

function reportWithPrompts(detectedPrompts: string[]): ScanReport {
  return {
    repoName: "owner/repo",
    scannedAt: new Date(0).toISOString(),
    filesScanned: detectedPrompts.length,
    ignoredFiles: 0,
    detectedAgents: [],
    detectedPrompts,
    detectedTools: [],
    detectedEvals: [],
    detectedWorkflows: [],
    findings: [],
    scores: {
      architecture: 82,
      promptQuality: 82,
      toolGovernance: 82,
      evalCoverage: 82,
      security: 88,
      documentation: 82,
      overall: 83,
    },
    recommendations: [],
  };
}
