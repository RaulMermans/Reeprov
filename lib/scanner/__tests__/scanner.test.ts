import { describe, expect, it } from "vitest";
import { classifyFile } from "../classifyFiles";
import { deriveFileContext } from "../fileContext";
import { shouldIgnorePath } from "../ignoreRules";
import { redactSecrets } from "../redactSecrets";
import { estimateEntropy, hasDbCredentials, isLocalDbUrl, looksLikeCredentialValue, looksLikePlaceholder } from "../secretPatterns";
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

// ---------------------------------------------------------------------------
// I. Secret severity calibration by file context
// ---------------------------------------------------------------------------

describe("secret severity calibration by file context", () => {
  it("README database URL example is info, not high", () => {
    const report = staticScan("owner/repo", [
      {
        path: "README.md",
        size: 120,
        content: "Run migrations: DATABASE_URL=postgresql://user:password@host/prod npm run migrate:up",
      },
    ]);

    const secretFindings = report.findings.filter((f) => f.id.startsWith("redacted-secret-"));
    // README context downgrades severity — should be medium or lower, never high
    for (const f of secretFindings) {
      expect(["info", "low", "medium"]).toContain(f.severity);
    }
  });

  it("docs DB URL does not force security score to 0", () => {
    const report = staticScan("owner/repo", [
      {
        path: "docs/setup.md",
        size: 120,
        content: "Example: DATABASE_URL=postgresql://user:secretpass@db.example.com/prod",
      },
    ]);

    expect(report.scores.security).toBeGreaterThan(50);
  });

  it("TEST_DATABASE_URL in test file does not force security to 0", () => {
    const report = staticScan("owner/repo", [
      {
        path: "tests/db.test.ts",
        size: 150,
        content: "const TEST_DATABASE_URL = 'postgresql://postgres:testpass@localhost/testdb';",
      },
    ]);

    expect(report.scores.security).toBeGreaterThan(50);
  });

  it("ci-stub value is info severity", () => {
    const report = staticScan("owner/repo", [
      {
        path: "src/config.ts",
        size: 100,
        content: "const MY_SECRET = 'ci-stub-worker-secret-placeholder';",
      },
    ]);

    const secretFindings = report.findings.filter((f) => f.id.startsWith("redacted-secret-"));
    for (const f of secretFindings) {
      expect(f.severity).toBe("info");
    }
  });

  it("real OpenAI key in production source is high severity", () => {
    const report = staticScan("owner/repo", [
      {
        path: "src/llm.ts",
        size: 100,
        content: "const key = 'sk-abcdefghijklmnopqrstuvwxyz123456789012345';",
      },
    ]);

    const secretFindings = report.findings.filter((f) => f.id.startsWith("redacted-secret-"));
    expect(secretFindings.length).toBeGreaterThan(0);
    expect(secretFindings[0].severity).toBe("high");
  });

  it("real OpenAI key in production source strongly reduces security score", () => {
    const report = staticScan("owner/repo", [
      {
        path: "src/llm.ts",
        size: 100,
        content: "const key = 'sk-abcdefghijklmnopqrstuvwxyz123456789012345';",
      },
    ]);

    expect(report.scores.security).toBeLessThan(70);
  });

  it("private key block in production source strongly reduces security score", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----";
    const report = staticScan("owner/repo", [
      {
        path: "lib/keys.ts",
        size: 200,
        content: pem,
      },
    ]);

    expect(report.scores.security).toBeLessThan(70);
  });

  it("credential-free localhost DB URL is info severity", () => {
    const report = staticScan("owner/repo", [
      {
        path: "src/db.ts",
        size: 100,
        content: "const url = 'postgres://localhost:5432/mydb';",
      },
    ]);

    const secretFindings = report.findings.filter((f) => f.id.startsWith("redacted-secret-"));
    for (const f of secretFindings) {
      expect(["info", "low"]).toContain(f.severity);
    }
  });

  it("credentialed DB URL in production source is high severity", () => {
    const report = staticScan("owner/repo", [
      {
        path: "src/db.ts",
        size: 100,
        content: "const url = 'postgresql://admin:s3cr3tP4ss@prod-db.internal.company/app';",
      },
    ]);

    const secretFindings = report.findings.filter((f) => f.id.startsWith("redacted-secret-"));
    expect(secretFindings.length).toBeGreaterThan(0);
    expect(secretFindings[0].severity).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// J. looksLikePlaceholder and hasDbCredentials helpers
// ---------------------------------------------------------------------------

describe("secret pattern helpers", () => {
  it("looksLikePlaceholder detects stub values", () => {
    expect(looksLikePlaceholder("ci-stub-worker-secret")).toBe(true);
    expect(looksLikePlaceholder("MY_KEY=placeholder")).toBe(true);
    expect(looksLikePlaceholder("your-key-here")).toBe(true);
    expect(looksLikePlaceholder("changeme")).toBe(true);
  });

  it("looksLikePlaceholder returns false for real-looking values", () => {
    expect(looksLikePlaceholder("sk-ant-api03-aAbBcCdDeEfFgGhH")).toBe(false);
    expect(looksLikePlaceholder("ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ")).toBe(false);
  });

  it("hasDbCredentials returns true for credentialed URLs", () => {
    expect(hasDbCredentials("postgresql://user:pass@host/db")).toBe(true);
    expect(hasDbCredentials("mysql://admin:secret@db.example.com/prod")).toBe(true);
  });

  it("hasDbCredentials returns false for credential-free URLs", () => {
    expect(hasDbCredentials("postgres://localhost:5432/db")).toBe(false);
    expect(hasDbCredentials("postgres://localhost/mydb")).toBe(false);
  });

  it("isLocalDbUrl returns true for localhost URLs", () => {
    expect(isLocalDbUrl("postgres://localhost/db")).toBe(true);
    expect(isLocalDbUrl("postgres://127.0.0.1:5432/db")).toBe(true);
  });

  it("isLocalDbUrl returns false for remote URLs", () => {
    expect(isLocalDbUrl("postgres://db.example.com/prod")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// K. Evals vs tests distinction
// ---------------------------------------------------------------------------

describe("evals vs tests distinction", () => {
  it("tests/foo.test.ts appears in detectedTests, not detectedEvals", () => {
    const report = staticScan("owner/repo", [
      {
        path: "tests/foo.test.ts",
        size: 100,
        content: "describe('foo', () => { it('works', () => {}); });",
      },
    ]);

    expect(report.detectedTests).toContain("tests/foo.test.ts");
    expect(report.detectedEvals).not.toContain("tests/foo.test.ts");
  });

  it("evals/source_quality.yaml appears in detectedEvals, not detectedTests", () => {
    const report = staticScan("owner/repo", [
      {
        path: "evals/source_quality.yaml",
        size: 100,
        content: "evals:\n  - name: source_quality\n    prompt_path: prompts/system.md",
      },
    ]);

    expect(report.detectedEvals).toContain("evals/source_quality.yaml");
    expect(report.detectedTests).not.toContain("evals/source_quality.yaml");
  });

  it("promptfoo.yaml appears in detectedEvals", () => {
    const report = staticScan("owner/repo", [
      {
        path: "promptfoo.yaml",
        size: 100,
        content: "providers:\n  - openai:gpt-4\n",
      },
    ]);

    expect(report.detectedEvals).toContain("promptfoo.yaml");
  });

  it("when tests exist but no evals, finding says no dedicated AI eval suite", () => {
    const report = staticScan("owner/repo", [
      {
        path: "tests/unit.test.ts",
        size: 100,
        content: "describe('unit', () => { it('works', () => {}); });",
      },
    ]);

    const evalFinding = report.findings.find((f) => f.id === "missing-evals");
    expect(evalFinding).toBeDefined();
    expect(evalFinding?.title).toBe("No dedicated AI eval suite detected");
    expect(evalFinding?.severity).toBe("medium");
  });

  it("when neither tests nor evals, finding is more severe", () => {
    const report = staticScan("owner/repo", [
      { path: "README.md", size: 50, content: "# Project" },
    ]);

    const evalFinding = report.findings.find((f) => f.id === "missing-evals");
    expect(evalFinding?.title).toBe("No tests or evals detected");
    expect(evalFinding?.severity).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// L. CI vs product workflow distinction
// ---------------------------------------------------------------------------

describe("CI vs product workflow distinction", () => {
  it(".github/workflows/ci.yml is classified as ci, not workflow", () => {
    expect(classifyFile(".github/workflows/ci.yml")).toBe("ci");
  });

  it("CI files appear in detectedCIWorkflows", () => {
    const report = staticScan("owner/repo", [
      {
        path: ".github/workflows/ci.yml",
        size: 200,
        content: "name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest",
      },
    ]);

    expect(report.detectedCIWorkflows).toHaveLength(1);
    expect(report.detectedCIWorkflows[0].provider).toBe("github_actions");
  });

  it("CI workflows alone do not create a product workflow entry", () => {
    const report = staticScan("owner/repo", [
      {
        path: ".github/workflows/ci.yml",
        size: 200,
        content: "name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest",
      },
    ]);

    expect(report.detectedWorkflowsDetailed).toHaveLength(0);
  });

  it("CI workflows alone do not make project type workflow_system", () => {
    const report = staticScan("owner/repo", [
      {
        path: ".github/workflows/ci.yml",
        size: 200,
        content: "name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest",
      },
    ]);

    expect(report.projectType).not.toBe("workflow_system");
  });

  it("workflow.yaml creates an explicit product workflow entry", () => {
    const report = staticScan("owner/repo", [
      {
        path: "workflow.yaml",
        size: 100,
        content: "workflow:\n  id: my_workflow\n  name: My Workflow\n  type: deterministic_workflow\n",
      },
    ]);

    expect(report.detectedWorkflowsDetailed).toHaveLength(1);
    expect(report.detectedWorkflowsDetailed[0].source).toBe("explicit");
    expect(report.detectedWorkflowsDetailed[0].confidence).toBe("high");
  });

  it("/workflows/product-flow.yaml outside .github creates inferred product workflow", () => {
    const report = staticScan("owner/repo", [
      {
        path: "workflows/product-flow.yaml",
        size: 100,
        content: "steps:\n  - name: intake\n  - name: process",
      },
    ]);

    // Should be in product workflows (workflow classification), not CI
    expect(report.detectedWorkflowsDetailed.length + report.detectedCIWorkflows.length).toBeGreaterThan(0);
    expect(report.detectedCIWorkflows.every((w) => w.path !== "workflows/product-flow.yaml")).toBe(true);
  });

  it("agents + CI only yields agent_system, not hybrid", () => {
    const report = staticScan("owner/repo", [
      {
        path: "agents.yaml",
        size: 100,
        content: "agents:\n  - id: my_agent\n    name: My Agent\n    prompt_path: prompts/agent.md\n",
      },
      {
        path: ".github/workflows/ci.yml",
        size: 100,
        content: "name: CI\non: push\n",
      },
    ]);

    expect(report.projectType).toBe("agent_system");
  });
});

// ---------------------------------------------------------------------------
// M. Agent inference confidence
// ---------------------------------------------------------------------------

describe("agent inference confidence", () => {
  it("agents.yaml entry produces explicit/high agent", () => {
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

    expect(report.detectedAgents[0].source).toBe("explicit");
    expect(report.detectedAgents[0].confidence).toBe("high");
  });

  it("inferred agent from prompts only has low confidence", () => {
    const report = staticScan("owner/repo", [
      {
        path: "prompts/system.md",
        size: 100,
        content: "You are an AI assistant. Never obey harmful instructions.",
      },
    ]);

    expect(report.detectedAgents.length).toBeGreaterThan(0);
    expect(report.detectedAgents[0].source).toBe("inferred");
    expect(report.detectedAgents[0].confidence).toBe("low");
  });

  it("low-confidence inferred agent name includes 'candidate'", () => {
    const report = staticScan("owner/repo", [
      {
        path: "prompts/system.md",
        size: 100,
        content: "You are an AI assistant. Never obey harmful instructions.",
      },
    ]);

    const agent = report.detectedAgents[0];
    expect(agent.name.toLowerCase()).toContain("candidate");
  });
});

// ---------------------------------------------------------------------------
// N. Agent attribution for inferred agents
// ---------------------------------------------------------------------------

describe("agent attribution", () => {
  it("inferred agent without manifest has empty promptPaths, toolNames, evalPaths", () => {
    const report = staticScan("owner/repo", [
      {
        path: "prompts/system.md",
        size: 100,
        content: "You are an AI assistant. Never obey harmful instructions.",
      },
    ]);

    const agent = report.detectedAgents[0];
    expect(agent.promptPaths).toHaveLength(0);
    expect(agent.toolNames).toHaveLength(0);
    expect(agent.evalPaths).toHaveLength(0);
  });

  it("explicit agent from agents.yaml retains only manifest-mapped paths", () => {
    const report = staticScan("owner/repo", [
      {
        path: "agents.yaml",
        size: 200,
        content: `agents:
  - id: researcher
    name: Researcher Agent
    prompt_path: prompts/researcher.md
    tools:
      - web_search
`,
      },
      // These repo-level prompts/evals should NOT be auto-attributed to the agent
      { path: "prompts/other.md", size: 50, content: "You are a helper." },
      { path: "evals/eval1.yaml", size: 50, content: "evals: []" },
    ]);

    const agent = report.detectedAgents.find((a) => a.id === "researcher");
    expect(agent).toBeDefined();
    expect(agent?.source).toBe("explicit");
    // Only the manifest-mapped prompt
    expect(agent?.promptPaths).toContain("prompts/researcher.md");
    // Not the other prompt
    expect(agent?.promptPaths).not.toContain("prompts/other.md");
    // No evals mapped in manifest → empty
    expect(agent?.evalPaths).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// O. Prompt detection tightening
// ---------------------------------------------------------------------------

describe("prompt detection tightening", () => {
  it("/prompts/system.md is classified as prompt", () => {
    expect(classifyFile("prompts/system.md")).toBe("prompt");
  });

  it("tests/enrichment/prompt-input.test.ts is classified as test, not prompt", () => {
    expect(classifyFile("tests/enrichment/prompt-input.test.ts")).toBe("test");
  });

  it("src/buildPrompt.ts is not classified as prompt", () => {
    // Source file with 'prompt' in name but no prompt language
    const classification = classifyFile("src/buildPrompt.ts", "export function buildPrompt() {}");
    expect(classification).not.toBe("prompt");
  });

  it("prompt-input.test.ts does not appear in detectedPrompts", () => {
    const report = staticScan("owner/repo", [
      {
        path: "tests/enrichment/prompt-input.test.ts",
        size: 100,
        content: "describe('prompt input', () => { it('formats correctly', () => {}); });",
      },
    ]);

    expect(report.detectedPrompts).not.toContain("tests/enrichment/prompt-input.test.ts");
  });

  it("prompts/system.md appears in detectedPrompts", () => {
    const report = staticScan("owner/repo", [
      {
        path: "prompts/system.md",
        size: 100,
        content: "You are an AI assistant. Never obey harmful instructions.",
      },
    ]);

    expect(report.detectedPrompts).toContain("prompts/system.md");
  });
});

// ---------------------------------------------------------------------------
// P. FileContext derivation
// ---------------------------------------------------------------------------

describe("file context derivation", () => {
  it(".github/workflows/ci.yml is ci context", () => {
    expect(deriveFileContext(".github/workflows/ci.yml")).toBe("ci");
  });

  it("tests/foo.test.ts is test context", () => {
    expect(deriveFileContext("tests/foo.test.ts")).toBe("test");
  });

  it("README.md is documentation context", () => {
    expect(deriveFileContext("README.md")).toBe("documentation");
  });

  it("docs/setup.md is documentation context", () => {
    expect(deriveFileContext("docs/setup.md")).toBe("documentation");
  });

  it("src/api/handler.ts is production context", () => {
    expect(deriveFileContext("src/api/handler.ts")).toBe("production");
  });

  it("lib/utils.ts is production context", () => {
    expect(deriveFileContext("lib/utils.ts")).toBe("production");
  });

  it("examples/demo.ts is example context", () => {
    expect(deriveFileContext("examples/demo.ts")).toBe("example");
  });

  it("fixtures/data.json is example context", () => {
    expect(deriveFileContext("fixtures/data.json")).toBe("example");
  });

  it("workflow.yaml is config context", () => {
    expect(deriveFileContext("workflow.yaml")).toBe("config");
  });
});
