import { describe, expect, it } from "vitest";
import { exportReportMarkdown } from "@/lib/reports/exportMarkdown";
import { buildFindingSummary } from "@/lib/reports/findingSummary";
import { buildRecommendations } from "@/lib/reports/recommendations";
import { buildScoreExplanations } from "@/lib/reports/scoreExplanations";
import { staticScan } from "@/lib/scanner/staticScan";
import type { Finding, ScanReport } from "@/lib/scanner/types";
import { projectTypeDescription, projectTypeLabel } from "@/lib/utils/format";

// ---------------------------------------------------------------------------
// A. Project type detection
// ---------------------------------------------------------------------------

describe("ai_application project type", () => {
  it("detects ai_application from OpenAI SDK import", () => {
    const report = staticScan("owner/repo", [
      {
        path: "src/ai.ts",
        size: 80,
        content: `import OpenAI from "openai";\nconst client = new OpenAI();`,
      },
    ]);
    expect(report.projectType).toBe("ai_application");
  });

  it("detects ai_application from Anthropic SDK import", () => {
    const report = staticScan("owner/repo", [
      {
        path: "src/client.ts",
        size: 80,
        content: `import Anthropic from "@anthropic-ai/sdk";\nconst client = new Anthropic();`,
      },
    ]);
    expect(report.projectType).toBe("ai_application");
  });

  it("detects ai_application from AI API env name", () => {
    const report = staticScan("owner/repo", [
      {
        path: "src/config.ts",
        size: 60,
        content: "const key = process.env.OPENAI_API_KEY;",
      },
    ]);
    expect(report.projectType).toBe("ai_application");
  });

  it("detects ai_application from AI function call pattern", () => {
    const report = staticScan("owner/repo", [
      {
        path: "src/service.ts",
        size: 120,
        content: "const result = await openai.generateText({ model: 'gpt-4', prompt });",
      },
    ]);
    expect(report.projectType).toBe("ai_application");
  });

  it("CI workflows alone do not create workflow_system", () => {
    const report = staticScan("owner/repo", [
      {
        path: ".github/workflows/ci.yml",
        size: 80,
        content: "on: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest",
      },
    ]);
    expect(report.projectType).not.toBe("workflow_system");
  });

  it("agents.yaml alone creates agent_system", () => {
    const report = staticScan("owner/repo", [
      {
        path: "agents.yaml",
        size: 80,
        content: "agents:\n  - id: my_agent\n    name: My Agent",
      },
    ]);
    expect(report.projectType).toBe("agent_system");
  });

  it("workflow.yaml alone creates workflow_system", () => {
    const report = staticScan("owner/repo", [
      {
        path: "workflow.yaml",
        size: 80,
        content: "workflow:\n  id: pipeline\n  name: Pipeline",
      },
    ]);
    expect(report.projectType).toBe("workflow_system");
  });

  it("agents.yaml and workflow.yaml together create hybrid_workflow_agent", () => {
    const report = staticScan("owner/repo", [
      {
        path: "agents.yaml",
        size: 80,
        content: "agents:\n  - id: my_agent\n    name: My Agent",
      },
      {
        path: "workflow.yaml",
        size: 80,
        content: "workflow:\n  id: pipeline\n  name: Pipeline",
      },
    ]);
    expect(report.projectType).toBe("hybrid_workflow_agent");
  });

  it("no AI signals produces unknown_ai_project", () => {
    const report = staticScan("owner/repo", [
      {
        path: "src/utils.ts",
        size: 60,
        content: "export function add(a: number, b: number) { return a + b; }",
      },
    ]);
    expect(report.projectType).toBe("unknown_ai_project");
  });
});

// ---------------------------------------------------------------------------
// B. Project type labels and descriptions
// ---------------------------------------------------------------------------

describe("projectTypeLabel and projectTypeDescription", () => {
  it("labels ai_application correctly", () => {
    expect(projectTypeLabel("ai_application")).toBe("AI application");
  });

  it("describes ai_application correctly", () => {
    expect(projectTypeDescription("ai_application")).toContain("AI-related code detected");
  });

  it("describes unknown_ai_project correctly", () => {
    expect(projectTypeDescription("unknown_ai_project")).toContain("No clear AI");
  });
});

// ---------------------------------------------------------------------------
// C. Recommendations — project-type-aware and de-duplicated
// ---------------------------------------------------------------------------

describe("buildRecommendations de-duplication", () => {
  function makeFinding(id: string, rec: string, severity: Finding["severity"] = "medium"): Finding {
    return {
      id,
      category: "architecture",
      severity,
      title: "Test finding",
      summary: "Test summary",
      evidencePaths: [],
      recommendation: rec,
      confidence: 0.8,
    };
  }

  it("collapses duplicate inventory recommendations into one", () => {
    const findings = [
      makeFinding("f1", "Add an agents.yaml or workflow.yaml inventory so scanners and reviewers can reason about agent or workflow boundaries."),
      makeFinding("f2", "Add an agent inventory that names each agent, prompt, tool boundary, and owner."),
    ];
    const recs = buildRecommendations(findings, { projectType: "agent_system" });
    const inventoryRecs = recs.filter((r) => r.includes("agents.yaml") || r.includes("agent") || r.includes("inventory"));
    expect(inventoryRecs).toHaveLength(1);
  });

  it("agent_system recommendation mentions agents.yaml first", () => {
    const findings = [
      makeFinding("f1", "Add an agents.yaml or workflow.yaml inventory so scanners can reason about boundaries."),
    ];
    const recs = buildRecommendations(findings, { projectType: "agent_system" });
    expect(recs[0]).toContain("agents.yaml");
  });

  it("workflow_system recommendation mentions workflow.yaml first", () => {
    const findings = [
      makeFinding("f1", "Add an agents.yaml or workflow.yaml inventory so scanners can reason about boundaries."),
    ];
    const recs = buildRecommendations(findings, { projectType: "workflow_system" });
    expect(recs[0]).toContain("workflow.yaml");
  });

  it("ai_application recommendation uses softer conditional language", () => {
    const findings = [
      makeFinding("f1", "Add an agents.yaml or workflow.yaml inventory to document agents and workflows."),
    ];
    const recs = buildRecommendations(findings, { projectType: "ai_application" });
    expect(recs[0]).toContain("ai-system.yaml");
  });

  it("unknown project type uses cautious language", () => {
    const findings = [
      makeFinding("f1", "Add an agents.yaml or workflow.yaml inventory."),
    ];
    const recs = buildRecommendations(findings, { projectType: "unknown_ai_project" });
    expect(recs[0]).toContain("only if");
  });

  it("multiple secret findings collapse into one rotation message", () => {
    const findings = [
      makeFinding("f1", "Remove this value from the repository and rotate it if it was real.", "high"),
      makeFinding("f2", "Remove this value from the repository and rotate it if it was real.", "high"),
      makeFinding("f3", "Remove this value from the repository and rotate it if it was real.", "medium"),
    ];
    const recs = buildRecommendations(findings, { projectType: "agent_system" });
    const rotateRecs = recs.filter((r) => r.toLowerCase().includes("rotat") || r.includes("files"));
    expect(rotateRecs).toHaveLength(1);
    expect(rotateRecs[0]).toContain("3 files");
  });

  it("info findings are excluded from recommendations", () => {
    const findings = [
      makeFinding("f1", "Placeholder/stub value detected; no rotation required.", "info"),
    ];
    const recs = buildRecommendations(findings, { projectType: "agent_system" });
    expect(recs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// D. Finding summary
// ---------------------------------------------------------------------------

describe("buildFindingSummary", () => {
  const findings: Finding[] = [
    {
      id: "f1",
      category: "security",
      severity: "high",
      title: "Secret-like value redacted",
      summary: "API key detected in src/config.ts.",
      evidencePaths: ["src/config.ts"],
      recommendation: "Rotate it.",
      confidence: 0.95,
    },
    {
      id: "f2",
      category: "security",
      severity: "medium",
      title: "Secret-like value redacted",
      summary: "API key detected in tests/fixture.ts (test file).",
      evidencePaths: ["tests/fixture.ts"],
      recommendation: "Review this test value.",
      confidence: 0.6,
    },
    {
      id: "f3",
      category: "architecture",
      severity: "low",
      title: "Missing structured agent config",
      summary: "No agents.yaml found.",
      evidencePaths: [],
      recommendation: "Add agents.yaml.",
      confidence: 0.75,
    },
    {
      id: "f4",
      category: "evalCoverage",
      severity: "medium",
      title: "No dedicated AI eval suite",
      summary: "Tests detected but no evals.",
      evidencePaths: [],
      recommendation: "Add eval cases.",
      confidence: 0.85,
    },
    {
      id: "f5",
      category: "security",
      severity: "info",
      title: "Secret-like value redacted",
      summary: "Placeholder detected.",
      evidencePaths: [],
      recommendation: "Placeholder/stub value detected; no rotation required.",
      confidence: 0.25,
    },
  ];

  it("counts severity correctly", () => {
    const summary = buildFindingSummary(findings);
    expect(summary.bySeverity.high).toBe(1);
    expect(summary.bySeverity.medium).toBe(2);
    expect(summary.bySeverity.low).toBe(1);
    expect(summary.bySeverity.info).toBe(1);
    expect(summary.bySeverity.critical).toBe(0);
    expect(summary.total).toBe(5);
  });

  it("counts category correctly", () => {
    const summary = buildFindingSummary(findings);
    const security = summary.byCategory.find((c) => c.category === "security");
    const arch = summary.byCategory.find((c) => c.category === "architecture");
    expect(security?.count).toBe(3);
    expect(arch?.count).toBe(1);
  });

  it("identifies secret contexts for security findings", () => {
    const summary = buildFindingSummary(findings);
    expect(summary.secretContexts.length).toBeGreaterThan(0);
    const testCtx = summary.secretContexts.find((sc) => sc.context === "test");
    expect(testCtx?.count).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// E. Score explanations
// ---------------------------------------------------------------------------

describe("buildScoreExplanations", () => {
  function makeReport(overrides: Partial<ScanReport> = {}): ScanReport {
    return {
      repoName: "test/repo",
      scannedAt: new Date().toISOString(),
      filesScanned: 10,
      ignoredFiles: 2,
      projectType: "ai_application",
      detectedAgents: [],
      detectedWorkflowsDetailed: [],
      detectedCIWorkflows: [],
      detectedPrompts: [],
      detectedTools: [],
      detectedEvals: [],
      detectedTests: ["src/app.test.ts"],
      detectedWorkflows: [],
      findings: [],
      scores: {
        architecture: 80,
        promptQuality: 82,
        toolGovernance: 82,
        evalCoverage: 70,
        security: 88,
        documentation: 72,
        overall: 80,
      },
      recommendations: [],
      ...overrides,
    };
  }

  it("security explanation is positive when no high-confidence production secrets exist", () => {
    const report = makeReport();
    const explanations = buildScoreExplanations(report);
    const sec = explanations.find((e) => e.category === "security");
    expect(sec?.positives.some((p) => p.includes("No high-confidence production secrets"))).toBe(true);
    expect(sec?.penalties).toHaveLength(0);
  });

  it("security explanation includes penalty for production high-severity secret finding", () => {
    const report = makeReport({
      findings: [
        {
          id: "f1",
          category: "security",
          severity: "high",
          title: "Secret-like value redacted",
          summary: "OpenAI key detected in src/config.ts.",
          evidencePaths: ["src/config.ts"],
          recommendation: "Rotate it.",
          confidence: 0.95,
        },
      ],
    });
    const explanations = buildScoreExplanations(report);
    const sec = explanations.find((e) => e.category === "security");
    expect(sec?.penalties).toContain("Secret-like value redacted");
  });

  it("eval coverage explanation mentions software tests separately", () => {
    const report = makeReport({
      detectedTests: ["src/app.test.ts", "src/utils.test.ts"],
      detectedEvals: [],
    });
    const explanations = buildScoreExplanations(report);
    const ev = explanations.find((e) => e.category === "evalCoverage");
    expect(ev?.positives.some((p) => p.includes("software test"))).toBe(true);
  });

  it("eval coverage explanation mentions AI evals when present", () => {
    const report = makeReport({
      detectedEvals: ["evals/prompt_eval.yaml"],
    });
    const explanations = buildScoreExplanations(report);
    const ev = explanations.find((e) => e.category === "evalCoverage");
    expect(ev?.positives.some((p) => p.includes("AI eval"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F. Markdown export
// ---------------------------------------------------------------------------

describe("exportReportMarkdown", () => {
  function makeReport(projectType: ScanReport["projectType"] = "ai_application"): ScanReport {
    return {
      repoName: "test/repo",
      scannedAt: new Date().toISOString(),
      filesScanned: 10,
      ignoredFiles: 2,
      projectType,
      detectedAgents: [],
      detectedWorkflowsDetailed: [],
      detectedCIWorkflows: [
        { name: "ci", path: ".github/workflows/ci.yml", provider: "github_actions" },
      ],
      detectedPrompts: [],
      detectedTools: [],
      detectedEvals: [],
      detectedTests: ["src/app.test.ts"],
      detectedWorkflows: [],
      findings: [],
      scores: {
        architecture: 80,
        promptQuality: 82,
        toolGovernance: 82,
        evalCoverage: 70,
        security: 88,
        documentation: 72,
        overall: 80,
      },
      recommendations: ["Add agents.yaml to map each agent."],
    };
  }

  it("includes project type description in output", () => {
    const md = exportReportMarkdown(makeReport("ai_application"));
    expect(md).toContain("AI application");
    expect(md).toContain("AI-related code detected");
  });

  it("includes Score Explanations section", () => {
    const md = exportReportMarkdown(makeReport());
    expect(md).toContain("## Score Explanations");
  });

  it("includes Findings Summary section", () => {
    const md = exportReportMarkdown(makeReport());
    expect(md).toContain("## Findings Summary");
  });

  it("includes CI workflows section separately", () => {
    const md = exportReportMarkdown(makeReport());
    expect(md).toContain("## CI Workflows");
    expect(md).toContain("GitHub Actions");
  });

  it("does not include raw secrets in exported markdown", () => {
    const report = makeReport();
    report.findings = [
      {
        id: "f1",
        category: "security",
        severity: "high",
        title: "Secret-like value redacted",
        summary: "API key detected in src/config.ts.",
        evidencePaths: ["src/config.ts"],
        evidenceSnippets: [
          { path: "src/config.ts", excerpt: "OPENAI_API_KEY=[REDACTED:OpenAI API key]", redacted: true },
        ],
        recommendation: "Rotate it.",
        confidence: 0.95,
      },
    ];
    const md = exportReportMarkdown(report);
    expect(md).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
    expect(md).toContain("[REDACTED:");
  });

  it("CI workflows do not appear in AI/product workflows section", () => {
    const md = exportReportMarkdown(makeReport());
    expect(md).toContain("## Detected AI/Product Workflows");
    const aiSection = md.split("## Detected AI/Product Workflows")[1]?.split("##")[0] ?? "";
    expect(aiSection).not.toContain(".github/workflows");
  });
});
