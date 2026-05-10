import { describe, expect, it } from "vitest";
import { classifyFile } from "../classifyFiles";
import { shouldIgnorePath } from "../ignoreRules";
import { redactSecrets } from "../redactSecrets";
import { estimateEntropy, looksLikeCredentialValue } from "../secretPatterns";
import { staticScan } from "../staticScan";

// ---------------------------------------------------------------------------
// Existing tests
// ---------------------------------------------------------------------------

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

    expect(report.findings.some((f) => f.id === "write-tools-without-approval")).toBe(false);
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

    const f = report.findings.find((item) => item.id === "write-tools-without-approval");
    expect(f?.severity).toBe("high");
  });

  it("does not flag write tools with approval policy", () => {
    const report = staticScan("owner/repo", [
      {
        path: "tools/email.ts",
        size: 150,
        content: 'export const sendEmailTool = { name: "send_email", requiresApproval: true };',
      },
    ]);

    expect(report.findings.some((f) => f.id === "write-tools-without-approval")).toBe(false);
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
    expect(report.detectedAgents.map((a) => a.id)).toEqual([
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

// ---------------------------------------------------------------------------
// A. Secret false positives
// ---------------------------------------------------------------------------

describe("secret false positives", () => {
  it("does not flag `for token in (...)` as a secret", () => {
    const result = redactSecrets('for token in ("€", "$"):\n  process(token)');
    expect(result.redacted).toBe(false);
    expect(result.matches).toHaveLength(0);
  });

  it('does not flag "computed-fact token" as a secret', () => {
    const result = redactSecrets('The computed-fact token is used for caching.');
    expect(result.redacted).toBe(false);
  });

  it("does not flag a function parameter named token as a high-severity secret", () => {
    const result = redactSecrets("function process(token: string): void { }");
    expect(result.redacted).toBe(false);
  });

  it("does not flag TOKEN = 'abc' (short value) as a secret", () => {
    const result = redactSecrets("TOKEN = 'abc'");
    expect(result.redacted).toBe(false);
  });

  it("does not flag an environment variable comment mentioning TOKEN", () => {
    const result = redactSecrets("# Set the TOKEN variable before running");
    expect(result.redacted).toBe(false);
  });

  it("does not redact CSRF_TOKEN with a short placeholder value", () => {
    const result = redactSecrets("CSRF_TOKEN=placeholder");
    expect(result.redacted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B. Real secret positives (high confidence)
// ---------------------------------------------------------------------------

describe("real secret positives", () => {
  it("detects fake GitHub token format as high-confidence finding", () => {
    const result = redactSecrets("GITHUB_TOKEN=ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456");
    expect(result.redacted).toBe(true);
    expect(result.matches).toContain("GitHub token");
    const detail = result.secretMatches.find((m) => m.kind === "GitHub token");
    expect(detail?.confidence).toBe("high");
  });

  it("detects fake Anthropic key format as high-confidence finding", () => {
    const result = redactSecrets("key=sk-ant-api03-aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsS");
    expect(result.redacted).toBe(true);
    expect(result.matches).toContain("Anthropic API key");
    const detail = result.secretMatches.find((m) => m.kind === "Anthropic API key");
    expect(detail?.confidence).toBe("high");
  });

  it("detects fake OpenAI key format as high-confidence finding", () => {
    const result = redactSecrets("OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456789012345");
    expect(result.redacted).toBe(true);
    expect(result.matches).toContain("OpenAI API key");
    const detail = result.secretMatches.find((m) => m.kind === "OpenAI API key");
    expect(detail?.confidence).toBe("high");
  });

  it("detects private key block as high-confidence finding", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----";
    const result = redactSecrets(pem);
    expect(result.redacted).toBe(true);
    expect(result.matches).toContain("Private key block");
    const detail = result.secretMatches.find((m) => m.kind === "Private key block");
    expect(detail?.confidence).toBe("high");
  });

  it("detects database URL with credentials as high-confidence finding", () => {
    const result = redactSecrets("DATABASE_URL=postgresql://user:s3cr3tP4ss@db.example.com/prod");
    expect(result.redacted).toBe(true);
    expect(result.matches).toContain("Database URL");
  });
});

// ---------------------------------------------------------------------------
// C. Medium confidence
// ---------------------------------------------------------------------------

describe("medium confidence secret assignments", () => {
  it("flags API_KEY with a long high-entropy value as medium or higher confidence", () => {
    const longValue = "aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789ABCDEF";
    const result = redactSecrets(`API_KEY="${longValue}"`);
    expect(result.redacted).toBe(true);
    const detail = result.secretMatches.find((m) => m.kind === "API key assignment");
    expect(detail).toBeDefined();
    expect(["medium", "high"]).toContain(detail?.confidence);
  });

  it("does not flag API_KEY with a short placeholder value", () => {
    const result = redactSecrets("API_KEY=abc");
    expect(result.redacted).toBe(false);
  });

  it("flags SECRET with long value as medium confidence", () => {
    const result = redactSecrets("MY_SECRET=aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789");
    expect(result.redacted).toBe(true);
    const detail = result.secretMatches.find((m) => m.kind === "Secret assignment");
    expect(detail?.confidence).toBe("medium");
  });
});

// ---------------------------------------------------------------------------
// D. Workflow manifest detection
// ---------------------------------------------------------------------------

describe("workflow manifest detection", () => {
  it("classifies workflow.yaml as workflow_config", () => {
    expect(classifyFile("workflow.yaml")).toBe("workflow_config");
  });

  it("classifies workflows.yaml as workflow_config", () => {
    expect(classifyFile("workflows.yaml")).toBe("workflow_config");
  });

  it("classifies workflow.json as workflow_config", () => {
    expect(classifyFile("workflow.json")).toBe("workflow_config");
  });

  it("workflow.yaml with one workflow creates one DetectedWorkflow", () => {
    const report = staticScan("owner/repo", [
      {
        path: "workflow.yaml",
        size: 200,
        content: `workflow:
  id: my_workflow
  name: My Analytics Workflow
  type: deterministic_workflow
  stages:
    - intake
    - analysis
    - report
`,
      },
    ]);

    expect(report.detectedWorkflowsDetailed).toHaveLength(1);
    expect(report.detectedWorkflowsDetailed[0].id).toBe("my_workflow");
    expect(report.detectedWorkflowsDetailed[0].stages).toEqual(["intake", "analysis", "report"]);
  });

  it("workflows.yaml with two workflows creates two DetectedWorkflow records", () => {
    const report = staticScan("owner/repo", [
      {
        path: "workflows.yaml",
        size: 300,
        content: `workflows:
  - id: workflow_a
    name: Workflow A
    type: deterministic_workflow
  - id: workflow_b
    name: Workflow B
    type: workflow_with_tools
`,
      },
    ]);

    expect(report.detectedWorkflowsDetailed).toHaveLength(2);
    expect(report.detectedWorkflowsDetailed.map((w) => w.id)).toEqual([
      "workflow_a",
      "workflow_b",
    ]);
  });

  it("supports singular workflow object at root", () => {
    const report = staticScan("owner/repo", [
      {
        path: "workflow.yaml",
        size: 100,
        content: `id: singular_workflow
name: Singular Workflow
type: deterministic_workflow
`,
      },
    ]);

    expect(report.detectedWorkflowsDetailed).toHaveLength(1);
    expect(report.detectedWorkflowsDetailed[0].id).toBe("singular_workflow");
  });
});

// ---------------------------------------------------------------------------
// E. Project type
// ---------------------------------------------------------------------------

describe("project type derivation", () => {
  it("returns agent_system when only agents are detected", () => {
    const report = staticScan("owner/repo", [
      {
        path: "agents.yaml",
        size: 100,
        content: `agents:
  - id: my_agent
    name: My Agent
    prompt_path: prompts/agent.md
    tools: [search]
    evals: []
`,
      },
    ]);
    expect(report.projectType).toBe("agent_system");
  });

  it("returns workflow_system when only workflows are detected", () => {
    const report = staticScan("owner/repo", [
      {
        path: "workflow.yaml",
        size: 100,
        content: `workflow:
  id: my_workflow
  name: My Workflow
  type: deterministic_workflow
`,
      },
    ]);
    expect(report.projectType).toBe("workflow_system");
  });

  it("returns hybrid_workflow_agent when both are detected", () => {
    const report = staticScan("owner/repo", [
      {
        path: "agents.yaml",
        size: 100,
        content: `agents:
  - id: my_agent
    name: My Agent
    prompt_path: prompts/agent.md
    tools: [search]
    evals: []
`,
      },
      {
        path: "workflow.yaml",
        size: 100,
        content: `workflow:
  id: my_workflow
  name: My Workflow
  type: deterministic_workflow
`,
      },
    ]);
    expect(report.projectType).toBe("hybrid_workflow_agent");
  });

  it("returns unknown_ai_project when neither agents nor workflows are detected", () => {
    const report = staticScan("owner/repo", [
      {
        path: "README.md",
        size: 100,
        content: "# A project without agents or workflows.",
      },
    ]);
    expect(report.projectType).toBe("unknown_ai_project");
  });
});

// ---------------------------------------------------------------------------
// F. Missing agent config logic
// ---------------------------------------------------------------------------

describe("missing agent config logic", () => {
  it("workflow project does not receive missing-agent-config finding", () => {
    const report = staticScan("owner/repo", [
      {
        path: "workflow.yaml",
        size: 100,
        content: `workflow:
  id: my_workflow
  name: My Workflow
  type: deterministic_workflow
`,
      },
    ]);
    expect(report.findings.some((f) => f.id === "missing-agent-config")).toBe(false);
  });

  it("unknown project receives recommendation to add agent or workflow manifest", () => {
    const report = staticScan("owner/repo", [
      {
        path: "README.md",
        size: 100,
        content: "# A simple project.",
      },
    ]);
    // Should have missing-agent-config finding since there's no workflow either
    expect(report.findings.some((f) => f.id === "missing-agent-config")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// G. Recommendation de-duplication
// ---------------------------------------------------------------------------

describe("recommendation de-duplication", () => {
  it("multiple secret findings collapse into one rotation recommendation", () => {
    const report = staticScan("owner/repo", [
      {
        path: "config/secrets.ts",
        size: 200,
        content: "const key1 = 'ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456';\nconst key2 = 'ghp_ZyXwVuTsRqPoNmLkJiHgFeDcBa654321';",
      },
      {
        path: "config/keys.ts",
        size: 200,
        content: "export const ANTHROPIC = 'sk-ant-api03-aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsS';",
      },
    ]);

    const rotateRecs = report.recommendations.filter((r) =>
      r.toLowerCase().includes("rotate"),
    );
    // Multiple secret findings should produce exactly ONE rotation recommendation
    expect(rotateRecs).toHaveLength(1);
  });

  it("no duplicate recommendations in the list", () => {
    const report = staticScan("owner/repo", [
      {
        path: "agents.yaml",
        size: 100,
        content: `agents:
  - id: my_agent
    name: My Agent
    prompt_path: prompts/agent.md
    tools: [search]
    evals: []
`,
      },
    ]);

    const unique = new Set(report.recommendations);
    expect(unique.size).toBe(report.recommendations.length);
  });
});

// ---------------------------------------------------------------------------
// H. Entropy helpers
// ---------------------------------------------------------------------------

describe("entropy helpers", () => {
  it("estimateEntropy returns 0 for empty string", () => {
    expect(estimateEntropy("")).toBe(0);
  });

  it("estimateEntropy returns low value for repetitive string", () => {
    expect(estimateEntropy("aaaaaaaaaa")).toBeLessThan(1);
  });

  it("estimateEntropy returns higher value for diverse string", () => {
    expect(estimateEntropy("aBcDeFgHiJkLmNoPqRsTuV")).toBeGreaterThan(3);
  });

  it("looksLikeCredentialValue returns false for short string", () => {
    expect(looksLikeCredentialValue("abc")).toBe(false);
  });

  it("looksLikeCredentialValue returns true for long high-entropy string", () => {
    expect(looksLikeCredentialValue("aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789ABCDEF")).toBe(true);
  });

  it("looksLikeCredentialValue returns false for long repetitive string", () => {
    expect(looksLikeCredentialValue("aaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
  });
});
