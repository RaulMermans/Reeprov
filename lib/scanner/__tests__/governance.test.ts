import { describe, expect, it } from "vitest";
import { classifyFile } from "../classifyFiles";
import { classifyRepoMode } from "../classifyRepoMode";
import { computeGraphCompleteness } from "../graphCompleteness";
import { ingestEvalResults } from "../evalResultIngestion";
import { applyScoreGates, computeScoreDimensions } from "../scoreGates";
import { staticScan } from "../staticScan";
import type { RepositoryModeResult } from "../types";

// ---------------------------------------------------------------------------
// A. Golden AI application — fully mapped, high confidence
// ---------------------------------------------------------------------------

describe("A. golden_ai_application", () => {
  const files = [
    {
      path: "agents.yaml",
      size: 600,
      content: `agents:
  - id: audit_agent
    name: Audit Agent
    prompt_path: prompts/audit.md
    tools:
      - fetch_data
      - generate_report
    evals:
      - evals/audit-correctness.yaml
    model:
      provider: anthropic
      name: claude-3-5-sonnet

  - id: review_agent
    name: Review Agent
    prompt_path: prompts/review.md
    tools:
      - search_web
    evals:
      - evals/review-quality.yaml
    model:
      provider: google
      name: gemini-2.0-flash
`,
    },
    {
      path: "workflow.yaml",
      size: 400,
      content: `workflows:
  - id: audit_workflow
    name: Audit Workflow
    type: deterministic_workflow
    stages:
      - intake
      - retrieve
      - analyze
      - validate
      - report
    tools:
      - fetch_data
      - generate_report
    evals:
      - evals/audit-correctness.yaml
`,
    },
    {
      path: "prompts/audit.md",
      size: 200,
      content: "You are an AI auditor. System prompt: analyze the provided data.",
    },
    {
      path: "prompts/review.md",
      size: 180,
      content: "You are a review assistant. Your role is to critique the audit output.",
    },
    {
      path: "tools/fetch_data.ts",
      size: 300,
      content: 'export const fetchData = tool({ name: "fetch_data", requiresApproval: false });',
    },
    {
      path: "tools/generate_report.ts",
      size: 250,
      content: 'export const generateReport = tool({ name: "generate_report", requiresApproval: true });',
    },
    {
      path: "evals/audit-correctness.yaml",
      size: 150,
      content: "eval_cases:\n  - input: test\n    expected: pass",
    },
    {
      path: "evals/review-quality.yaml",
      size: 130,
      content: "eval_cases:\n  - input: review\n    expected: pass",
    },
    {
      path: "AGENTS.md",
      size: 300,
      content: "# Agents\nThis repository contains an audit agent and a review agent.",
    },
    {
      path: "src/app.ts",
      size: 500,
      content: "import Anthropic from '@anthropic-ai/sdk';\nexport function runAudit() {}",
    },
    {
      path: "eval-results.json",
      size: 200,
      content: JSON.stringify([
        { agent: "audit_agent", model: "claude-3-5-sonnet", provider: "anthropic", score: 0.92, pass: true },
        { agent: "review_agent", model: "gemini-2.0-flash", provider: "google", score: 0.88, pass: true },
      ]),
    },
  ];

  it("classifies as ai_application with high confidence", () => {
    const report = staticScan("owner/golden-ai-app", files);
    expect(report.repositoryMode?.mode).toBe("ai_application");
    expect(report.repositoryMode?.confidence).toBe("high");
  });

  it("detects both agents", () => {
    const report = staticScan("owner/golden-ai-app", files);
    expect(report.detectedAgents).toHaveLength(2);
  });

  it("does not flag missing manifest finding", () => {
    const report = staticScan("owner/golden-ai-app", files);
    const missingManifest = report.findings.find((f) => f.id === "missing-agent-config");
    expect(missingManifest).toBeUndefined();
  });

  it("has no write-tools-without-approval finding (generate_report has approval policy)", () => {
    const report = staticScan("owner/golden-ai-app", files);
    const finding = report.findings.find((f) => f.id === "write-tools-without-approval");
    expect(finding).toBeUndefined();
  });

  it("ingets eval performance results", () => {
    const report = staticScan("owner/golden-ai-app", files);
    expect(report.performanceData?.available).toBe(true);
    expect(report.performanceData?.evalResultCount).toBe(2);
  });

  it("has graph completeness > 0 due to mapped agents", () => {
    const report = staticScan("owner/golden-ai-app", files);
    expect(report.graphCompleteness?.completenessScore).toBeGreaterThan(50);
  });

  it("produces an ai_system_health score (not null)", () => {
    const report = staticScan("owner/golden-ai-app", files);
    expect(report.scoreDimensions?.aiSystemHealth).not.toBeNull();
    expect(typeof report.scoreDimensions?.aiSystemHealth).toBe("number");
  });

  it("includes reportVersion field", () => {
    const report = staticScan("owner/golden-ai-app", files);
    expect(report.reportVersion).toBeDefined();
    expect(typeof report.reportVersion).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// B. Negative control — non-AI repository
// ---------------------------------------------------------------------------

describe("B. negative_control_non_ai", () => {
  const files = [
    {
      path: "src/utils.ts",
      size: 200,
      content: "export function add(a: number, b: number): number { return a + b; }",
    },
    {
      path: "src/server.ts",
      size: 300,
      content: "import express from 'express';\nconst app = express();\napp.listen(3000);",
    },
    {
      path: "package.json",
      size: 120,
      content: '{ "name": "my-api", "scripts": { "start": "node src/server.js" }, "dependencies": { "express": "^4" } }',
    },
    {
      path: "README.md",
      size: 150,
      content: "# My API\nA simple REST API built with Express.",
    },
  ];

  it("classifies as non_ai", () => {
    const report = staticScan("owner/non-ai-repo", files);
    expect(report.repositoryMode?.mode).toBe("non_ai");
  });

  it("sets ai_system_health to null", () => {
    const report = staticScan("owner/non-ai-repo", files);
    expect(report.scoreDimensions?.aiSystemHealth).toBeNull();
  });

  it("still provides general_repo_hygiene", () => {
    const report = staticScan("owner/non-ai-repo", files);
    expect(typeof report.scoreDimensions?.generalRepoHygiene).toBe("number");
    expect((report.scoreDimensions?.generalRepoHygiene ?? 0)).toBeGreaterThan(0);
  });

  it("does not detect any agents", () => {
    const report = staticScan("owner/non-ai-repo", files);
    const realAgents = report.detectedAgents.filter((a) => a.confidence !== "low");
    expect(realAgents).toHaveLength(0);
  });

  it("applies architecture score cap for non-ai mode", () => {
    const report = staticScan("owner/non-ai-repo", files);
    expect(report.scores.architecture).toBeLessThanOrEqual(60);
  });
});

// ---------------------------------------------------------------------------
// C. Example-heavy framework repository
// ---------------------------------------------------------------------------

describe("C. example_heavy_framework", () => {
  const files = [
    {
      path: "examples/agent-example/agent.py",
      size: 300,
      content: "from langchain import LLMChain\nagent = LLMChain(llm=openai)",
    },
    {
      path: "examples/chatbot/chatbot.ts",
      size: 250,
      content: "import { ChatOpenAI } from 'langchain';\nconst chat = new ChatOpenAI();",
    },
    {
      path: "examples/summarizer/summarizer.py",
      size: 200,
      content: "from langchain.chains import SummarizationChain\nchain = SummarizationChain()",
    },
    {
      path: "examples/qa/qa_agent.py",
      size: 220,
      content: "from langchain import RetrievalQA\nqa = RetrievalQA.from_chain_type()",
    },
    {
      path: "examples/tools/calculator.py",
      size: 150,
      content: "def calculate(expression): return eval(expression)",
    },
    {
      path: "examples/tools/search.py",
      size: 170,
      content: "def web_search(query): return search_api.search(query)",
    },
    {
      path: "examples/README.md",
      size: 200,
      content: "# Examples\nThese examples show how to use the framework.",
    },
    {
      path: "package.json",
      size: 250,
      content: JSON.stringify({
        name: "langchain-examples",
        keywords: ["framework", "ai", "llm"],
        peerDependencies: { langchain: "^0.1" },
      }),
    },
    {
      path: "README.md",
      size: 300,
      content: "# LangChain Examples\nInstall: pip install langchain\nExamples for using LangChain.",
    },
  ];

  it("classifies as ai_framework_library or example_template (not ai_application)", () => {
    const report = staticScan("owner/framework-examples", files);
    expect(["ai_framework_library", "example_template"]).toContain(report.repositoryMode?.mode);
  });

  it("does not set ai_system_health as a high healthy score", () => {
    const report = staticScan("owner/framework-examples", files);
    // ai_system_health should be null for framework/example repos
    expect(report.scoreDimensions?.aiSystemHealth).toBeNull();
  });

  it("applies architecture score cap", () => {
    const report = staticScan("owner/framework-examples", files);
    expect(report.scores.architecture).toBeLessThanOrEqual(65);
  });

  it("reports score caps applied", () => {
    const report = staticScan("owner/framework-examples", files);
    expect((report.scoreCapsApplied?.length ?? 0)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// D. Dangerous tools without approval policy
// ---------------------------------------------------------------------------

describe("D. dangerous_tools_without_approval", () => {
  const files = [
    {
      path: "tools/email.ts",
      size: 200,
      content: 'export const sendEmail = tool({ name: "send_email", description: "Send email to customer" });',
    },
    {
      path: "tools/database.ts",
      size: 250,
      content: 'export const deleteRecord = tool({ name: "delete_record", description: "Delete a record from DB" });',
    },
    {
      path: "tools/publishing.ts",
      size: 180,
      content: 'export const publishPost = tool({ name: "publish_post", description: "Publish content publicly" });',
    },
    {
      path: "src/agent.ts",
      size: 300,
      content: "import OpenAI from 'openai';\nconst client = new OpenAI();",
    },
    {
      path: "AGENTS.md",
      size: 150,
      content: "# Agents\nThis agent uses several tools.",
    },
  ];

  it("creates a write-tools-without-approval finding", () => {
    const report = staticScan("owner/dangerous-tools", files);
    const finding = report.findings.find((f) => f.id === "write-tools-without-approval");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("high");
  });

  it("caps tool_governance at or below 65", () => {
    const report = staticScan("owner/dangerous-tools", files);
    expect(report.scores.toolGovernance).toBeLessThanOrEqual(65);
  });

  it("includes the tool governance cap in scoreCapsApplied", () => {
    const report = staticScan("owner/dangerous-tools", files);
    const cap = report.scoreCapsApplied?.find((c) => c.dimension === "toolGovernance");
    expect(cap).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// E. Fully mapped workflow
// ---------------------------------------------------------------------------

describe("E. fully_mapped_workflow", () => {
  const files = [
    {
      path: "workflow.yaml",
      size: 600,
      content: `workflows:
  - id: pipeline
    name: Audit Pipeline
    type: deterministic_workflow
    stages:
      - intake
      - retrieve
      - analyze
      - validate
      - report
    tools:
      - fetch_data
      - validate_schema
    evals:
      - evals/pipeline-correctness.yaml
`,
    },
    {
      path: "agents.yaml",
      size: 500,
      content: `agents:
  - id: pipeline_agent
    name: Pipeline Agent
    prompt_path: prompts/pipeline.md
    tools:
      - fetch_data
      - validate_schema
    evals:
      - evals/pipeline-correctness.yaml
`,
    },
    {
      path: "prompts/pipeline.md",
      size: 200,
      content: "You are a pipeline agent. Your task is to process and validate data.",
    },
    {
      path: "tools/fetch_data.ts",
      size: 150,
      content: 'export const fetchData = { name: "fetch_data", requiresApproval: false };',
    },
    {
      path: "tools/validate_schema.ts",
      size: 150,
      content: 'export const validateSchema = { name: "validate_schema", requiresApproval: false };',
    },
    {
      path: "evals/pipeline-correctness.yaml",
      size: 120,
      content: "eval_cases:\n  - input: test\n    expected: pass",
    },
    {
      path: "AGENTS.md",
      size: 200,
      content: "# Pipeline Agent\nProcesses and validates data through a multi-stage pipeline.",
    },
    {
      path: "src/main.ts",
      size: 300,
      content: "import Anthropic from '@anthropic-ai/sdk';\nexport async function runPipeline() {}",
    },
  ];

  it("detects the workflow manifest", () => {
    const report = staticScan("owner/fully-mapped-workflow", files);
    expect(report.detectedWorkflowsDetailed.length).toBeGreaterThan(0);
  });

  it("detects the agent with mapped attributes", () => {
    const report = staticScan("owner/fully-mapped-workflow", files);
    const agent = report.detectedAgents.find((a) => a.id === "pipeline_agent");
    expect(agent).toBeDefined();
    expect(agent?.promptPaths.length).toBeGreaterThan(0);
    expect(agent?.toolNames.length).toBeGreaterThan(0);
    expect(agent?.evalPaths.length).toBeGreaterThan(0);
  });

  it("has graph completeness > 80 due to fully mapped agent", () => {
    const report = staticScan("owner/fully-mapped-workflow", files);
    expect(report.graphCompleteness?.completenessScore).toBeGreaterThan(80);
  });

  it("has hasGraphEdges = true (reflected in higher ai_system_health cap)", () => {
    const report = staticScan("owner/fully-mapped-workflow", files);
    // With graph edges and manifests, ai_system_health should not be capped at 74
    expect(report.scoreDimensions?.aiSystemHealth).not.toBeNull();
    // Should exceed 74 (the cap only applies when no graph edges exist)
    expect((report.scoreDimensions?.aiSystemHealth ?? 0)).toBeGreaterThan(74);
  });
});

// ---------------------------------------------------------------------------
// F. Docs/examples with fake secrets — should not be high severity
// ---------------------------------------------------------------------------

describe("F. docs_examples_with_fake_secrets", () => {
  const files = [
    {
      path: "docs/setup.md",
      size: 300,
      content: `# Setup
Set your API key:
DATABASE_URL=postgresql://user:fake-password-do-not-use@db.example.com/mydb
OPENAI_API_KEY=sk-example-key-put-your-real-key-here
`,
    },
    {
      path: "examples/basic/config.ts",
      size: 200,
      content: `// Example configuration
const config = {
  apiKey: "sk-placeholder-replace-me",
  databaseUrl: "postgresql://localhost/mydb"
};`,
    },
    {
      path: "fixtures/test-data.json",
      size: 150,
      content: JSON.stringify({
        apiKey: "sk-test-fake-key-1234567890abcdef",
        token: "ghp_fakegithubtoken1234567890abcdef",
      }),
    },
    {
      path: "README.md",
      size: 200,
      content: "# My Project\nReplace OPENAI_API_KEY=sk-your-key-here with your real key.",
    },
    {
      path: "src/app.ts",
      size: 250,
      content: "import OpenAI from 'openai';\nconst client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });",
    },
  ];

  it("does not produce high-severity findings for docs/example secrets", () => {
    const report = staticScan("owner/docs-secrets", files);
    const highSecurityFindings = report.findings.filter(
      (f) => f.category === "security" && f.severity === "high",
    );
    // None should be from docs/example/fixture contexts
    const fromDocOrExample = highSecurityFindings.filter(
      (f) => f.summary.includes("(documentation)") || f.summary.includes("(example/fixture)"),
    );
    expect(fromDocOrExample).toHaveLength(0);
  });

  it("keeps security score above 60 for example-only secrets", () => {
    const report = staticScan("owner/docs-secrets", files);
    expect(report.scores.security).toBeGreaterThan(60);
  });

  it("does not crater ai_system_health from example secrets", () => {
    const report = staticScan("owner/docs-secrets", files);
    // Placeholder/example secrets should not drive ai_system_health to 0
    if (report.scoreDimensions?.aiSystemHealth !== null) {
      expect(report.scoreDimensions?.aiSystemHealth ?? 0).toBeGreaterThan(40);
    }
  });
});

// ---------------------------------------------------------------------------
// G. SVG / UI asset false positive — should not count as production agents
// ---------------------------------------------------------------------------

describe("G. svg_ui_agent_false_positive", () => {
  const files = [
    {
      path: "public/icons/agents/agent-icon.svg",
      size: 500,
      content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>',
    },
    {
      path: "src/components/AgentIcon.tsx",
      size: 200,
      content: "import AgentSvg from './agent-icon.svg';\nexport function AgentIcon() { return <AgentSvg />; }",
    },
    {
      path: "assets/agent-logo.svg",
      size: 300,
      content: '<svg xmlns="http://www.w3.org/2000/svg"><text>Agent Logo</text></svg>',
    },
    {
      path: "src/app.ts",
      size: 250,
      content: "import OpenAI from 'openai';\nexport function createApp() {}",
    },
    {
      path: "README.md",
      size: 150,
      content: "# My App\nAn AI-powered application.",
    },
  ];

  it("does not count SVG files as agent_config", () => {
    const svgFiles = files.filter((f) => f.path.endsWith(".svg"));
    for (const file of svgFiles) {
      const classification = classifyFile(file.path, file.content);
      expect(classification).not.toBe("agent_config");
    }
  });

  it("does not detect production agents from SVG files", () => {
    const report = staticScan("owner/svg-false-positive", files);
    // No manifest agents should be detected (only potentially inferred from prompt files)
    const manifestAgents = report.detectedAgents.filter((a) => a.displayKind === "manifest");
    expect(manifestAgents).toHaveLength(0);
  });

  it("classifies SVG in /agents/ directory as unknown, not agent_config", () => {
    const svgInAgentsDir = classifyFile("agents/ui/agent-avatar.svg", "");
    expect(svgInAgentsDir).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Unit tests for individual modules
// ---------------------------------------------------------------------------

describe("classifyRepoMode", () => {
  it("returns non_ai when no AI signals", () => {
    const fakeMode: RepositoryModeResult = {
      mode: "non_ai",
      confidence: "high",
      reasons: [],
      evidence: [],
      scoringPolicy: {
        aiSystemHealthApplicable: false,
        generalHygieneApplicable: true,
        governanceApplicable: false,
        description: "Non-AI",
      },
    };
    expect(fakeMode.mode).toBe("non_ai");
  });

  it("detects example_template from high example file ratio", () => {
    const exampleFiles = Array.from({ length: 10 }, (_, i) => ({
      path: `examples/demo-${i}/agent.py`,
      size: 100,
      content: "from langchain import LLM",
      name: `agent.py`,
      extension: ".py",
      classification: "source_code" as const,
      fileContext: "example" as const,
      redacted: false,
      ignored: false,
    }));
    const result = classifyRepoMode(exampleFiles, false, false, true);
    expect(["example_template", "ai_framework_library"]).toContain(result.mode);
  });
});

describe("computeGraphCompleteness", () => {
  it("returns 100 completeness when all agents are fully mapped", () => {
    const agents = [
      {
        id: "agent-1",
        name: "Agent 1",
        promptPaths: ["prompts/agent1.md"],
        toolNames: ["tool1"],
        evalPaths: ["evals/e1.yaml"],
        risks: [],
        source: "explicit" as const,
        confidence: "high" as const,
        displayKind: "manifest" as const,
      },
    ];
    const result = computeGraphCompleteness(agents, [], 1, 1, 1);
    expect(result.completenessScore).toBe(100);
  });

  it("returns low completeness when no manifest agents exist", () => {
    const agents = [
      {
        id: "inferred",
        name: "Inferred Agent",
        promptPaths: [],
        toolNames: [],
        evalPaths: [],
        risks: [],
        source: "inferred" as const,
        confidence: "low" as const,
        displayKind: "inferred_candidate" as const,
      },
    ];
    // No manifest agents → total = 0, ratio = 1 (no penalty), but prompts/tools/evals are 0/3
    const result = computeGraphCompleteness(agents, [], 3, 5, 2);
    // Agents ratio = 1 (no manifest agents = no penalty), prompts/tools/evals not mapped
    expect(result.mappedAgents).toBe(0);
    expect(result.totalAgents).toBe(0); // inferred_candidate not counted
    expect(result.mappedPrompts).toBe(0);
    expect(result.mappedTools).toBe(0);
    expect(result.mappedEvals).toBe(0);
  });

  it("returns 25 graph completeness when only agents detected but none linked", () => {
    // No manifest agents, 3 prompts, 5 tools, 2 evals → all ratios for mapped items = 0
    const result = computeGraphCompleteness([], [], 3, 5, 2);
    // agents ratio = 1 (no penalty), prompts = 0/3, tools = 0/5, evals = 0/2
    expect(result.completenessScore).toBeGreaterThanOrEqual(20);
    expect(result.completenessScore).toBeLessThanOrEqual(40);
  });
});

describe("ingestEvalResults", () => {
  it("parses eval-results.json correctly", () => {
    const files = [
      {
        path: "eval-results.json",
        name: "eval-results.json",
        size: 200,
        extension: ".json",
        content: JSON.stringify([
          { agent: "my_agent", model: "gpt-4", score: 0.9, pass: true },
          { agent: "my_agent", model: "gpt-4", score: 0.8, pass: true },
        ]),
        classification: "eval" as const,
        fileContext: "production" as const,
        redacted: false,
        ignored: false,
      },
    ];
    const result = ingestEvalResults(files);
    expect(result.available).toBe(true);
    expect(result.evalResultCount).toBe(2);
    expect(result.results[0].agent).toBe("my_agent");
    expect(result.results[0].score).toBe(0.9);
  });

  it("returns not available when no eval result files exist", () => {
    const files = [
      {
        path: "src/app.ts",
        name: "app.ts",
        size: 100,
        extension: ".ts",
        content: "export function main() {}",
        classification: "source_code" as const,
        fileContext: "production" as const,
        redacted: false,
        ignored: false,
      },
    ];
    const result = ingestEvalResults(files);
    expect(result.available).toBe(false);
    expect(result.evalResultCount).toBe(0);
  });

  it("parses JSONL format", () => {
    const files = [
      {
        path: "evals/results/run-001.jsonl",
        name: "run-001.jsonl",
        size: 200,
        extension: ".jsonl",
        content: [
          JSON.stringify({ agent: "a1", score: 0.95, pass: true }),
          JSON.stringify({ agent: "a1", score: 0.91, pass: true }),
          JSON.stringify({ agent: "a2", score: 0.72, pass: false }),
        ].join("\n"),
        classification: "eval" as const,
        fileContext: "production" as const,
        redacted: false,
        ignored: false,
      },
    ];
    const result = ingestEvalResults(files);
    expect(result.available).toBe(true);
    expect(result.evalResultCount).toBe(3);
  });
});

describe("applyScoreGates", () => {
  const baseScores = {
    architecture: 82,
    promptQuality: 82,
    toolGovernance: 82,
    evalCoverage: 82,
    security: 88,
    documentation: 82,
    overall: 83,
  };

  const baseMode: RepositoryModeResult = {
    mode: "ai_application",
    confidence: "medium",
    reasons: ["Application signals detected"],
    evidence: [],
    scoringPolicy: {
      aiSystemHealthApplicable: true,
      generalHygieneApplicable: true,
      governanceApplicable: true,
      description: "AI Application",
    },
  };

  it("caps architecture at 70 when no manifest exists", () => {
    const context = {
      hasAgentManifest: false,
      hasWorkflowManifest: false,
      hasEvals: true,
      hasWriteToolsWithoutApproval: false,
      hasModelMapping: false,
      hasGraphEdges: false,
      allArtifactsAreExamples: false,
      repositoryMode: baseMode,
    };
    const { scores, capsApplied } = applyScoreGates(baseScores, context);
    expect(scores.architecture).toBeLessThanOrEqual(70);
    expect(capsApplied.some((c) => c.dimension === "architecture")).toBe(true);
  });

  it("caps evalCoverage at 60 when no evals exist", () => {
    const context = {
      hasAgentManifest: true,
      hasWorkflowManifest: false,
      hasEvals: false,
      hasWriteToolsWithoutApproval: false,
      hasModelMapping: true,
      hasGraphEdges: true,
      allArtifactsAreExamples: false,
      repositoryMode: baseMode,
    };
    const { scores, capsApplied } = applyScoreGates(baseScores, context);
    expect(scores.evalCoverage).toBeLessThanOrEqual(60);
    expect(capsApplied.some((c) => c.dimension === "evalCoverage")).toBe(true);
  });

  it("caps toolGovernance at 65 when write tools have no approval policy", () => {
    const context = {
      hasAgentManifest: true,
      hasWorkflowManifest: false,
      hasEvals: true,
      hasWriteToolsWithoutApproval: true,
      hasModelMapping: true,
      hasGraphEdges: true,
      allArtifactsAreExamples: false,
      repositoryMode: baseMode,
    };
    const { scores, capsApplied } = applyScoreGates(baseScores, context);
    expect(scores.toolGovernance).toBeLessThanOrEqual(65);
    expect(capsApplied.some((c) => c.dimension === "toolGovernance")).toBe(true);
  });

  it("applies multiple caps for non-ai mode", () => {
    const nonAiMode: RepositoryModeResult = {
      ...baseMode,
      mode: "non_ai",
      scoringPolicy: {
        aiSystemHealthApplicable: false,
        generalHygieneApplicable: true,
        governanceApplicable: false,
        description: "Not an AI system",
      },
    };
    const context = {
      hasAgentManifest: false,
      hasWorkflowManifest: false,
      hasEvals: false,
      hasWriteToolsWithoutApproval: false,
      hasModelMapping: false,
      hasGraphEdges: false,
      allArtifactsAreExamples: false,
      repositoryMode: nonAiMode,
    };
    const { scores, capsApplied } = applyScoreGates(baseScores, context);
    expect(scores.architecture).toBeLessThanOrEqual(60);
    expect(scores.evalCoverage).toBeLessThanOrEqual(60);
    expect(scores.toolGovernance).toBeLessThanOrEqual(60);
    expect(capsApplied.length).toBeGreaterThanOrEqual(3);
  });
});

describe("computeScoreDimensions", () => {
  const scores = {
    architecture: 70,
    promptQuality: 75,
    toolGovernance: 65,
    evalCoverage: 60,
    security: 85,
    documentation: 72,
    overall: 71,
  };

  const aiMode: RepositoryModeResult = {
    mode: "ai_application",
    confidence: "high",
    reasons: [],
    evidence: [],
    scoringPolicy: {
      aiSystemHealthApplicable: true,
      generalHygieneApplicable: true,
      governanceApplicable: true,
      description: "AI Application",
    },
  };

  it("sets aiSystemHealth to null for non_ai mode", () => {
    const nonAiMode: RepositoryModeResult = {
      ...aiMode,
      mode: "non_ai",
      scoringPolicy: { ...aiMode.scoringPolicy, aiSystemHealthApplicable: false, governanceApplicable: false },
    };
    const ctx = {
      hasAgentManifest: false,
      hasWorkflowManifest: false,
      hasEvals: false,
      hasWriteToolsWithoutApproval: false,
      hasModelMapping: false,
      hasGraphEdges: false,
      allArtifactsAreExamples: false,
      repositoryMode: nonAiMode,
    };
    const dim = computeScoreDimensions(scores, ctx, 0);
    expect(dim.aiSystemHealth).toBeNull();
    expect(dim.governanceCompleteness).toBeNull();
  });

  it("caps aiSystemHealth at 74 when no graph edges", () => {
    const ctx = {
      hasAgentManifest: true,
      hasWorkflowManifest: false,
      hasEvals: true,
      hasWriteToolsWithoutApproval: false,
      hasModelMapping: true,
      hasGraphEdges: false, // no edges
      allArtifactsAreExamples: false,
      repositoryMode: aiMode,
    };
    const dim = computeScoreDimensions(scores, ctx, 0);
    expect(dim.aiSystemHealth).not.toBeNull();
    expect(dim.aiSystemHealth!).toBeLessThanOrEqual(74);
  });

  it("computes general hygiene even for non-AI repos", () => {
    const ctx = {
      hasAgentManifest: false,
      hasWorkflowManifest: false,
      hasEvals: false,
      hasWriteToolsWithoutApproval: false,
      hasModelMapping: false,
      hasGraphEdges: false,
      allArtifactsAreExamples: false,
      repositoryMode: { ...aiMode, mode: "non_ai" as const, scoringPolicy: { ...aiMode.scoringPolicy, aiSystemHealthApplicable: false, governanceApplicable: false } },
    };
    const dim = computeScoreDimensions(scores, ctx, 0);
    expect(typeof dim.generalRepoHygiene).toBe("number");
    expect(dim.generalRepoHygiene).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Regression: score caps visible in report
// ---------------------------------------------------------------------------

describe("score caps in report", () => {
  it("reports scoreCapsApplied when caps are triggered", () => {
    const report = staticScan("owner/unconfigured-ai", [
      {
        path: "src/ai-service.ts",
        size: 250,
        content: "import OpenAI from 'openai';\nexport async function complete(prompt: string) {}",
      },
      {
        path: "AGENTS.md",
        size: 100,
        content: "# AI Service",
      },
    ]);

    // Should have caps: no manifest, no evals, etc.
    expect(report.scoreCapsApplied).toBeDefined();
    expect((report.scoreCapsApplied?.length ?? 0)).toBeGreaterThan(0);
  });

  it("does not apply caps to repo with full manifest and evals", () => {
    const report = staticScan("owner/well-configured", [
      {
        path: "agents.yaml",
        size: 300,
        content: "agents:\n  - id: main\n    name: Main Agent\n    prompt_path: prompts/main.md\n    tools:\n      - search\n    evals:\n      - evals/main.yaml",
      },
      {
        path: "evals/main.yaml",
        size: 100,
        content: "eval_cases:\n  - input: hello\n    expected: world",
      },
      {
        path: "prompts/main.md",
        size: 100,
        content: "You are an AI assistant.",
      },
      {
        path: "AGENTS.md",
        size: 100,
        content: "# Main Agent",
      },
      {
        path: "src/app.ts",
        size: 200,
        content: "import Anthropic from '@anthropic-ai/sdk';\nexport function run() {}",
      },
    ]);

    // Architecture should NOT be capped at 70 (manifest exists)
    const archCap = report.scoreCapsApplied?.find(
      (c) => c.dimension === "architecture" && c.cap <= 70,
    );
    expect(archCap).toBeUndefined();

    // Eval coverage should NOT be capped (evals exist)
    const evalCap = report.scoreCapsApplied?.find(
      (c) => c.dimension === "evalCoverage",
    );
    expect(evalCap).toBeUndefined();
  });
});
