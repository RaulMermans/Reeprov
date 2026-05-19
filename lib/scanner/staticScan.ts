import yaml from "js-yaml";
import { buildRecommendations } from "@/lib/reports/recommendations";
import { buildSystemGraph } from "@/lib/reports/systemGraph";
import { classifyFile } from "./classifyFiles";
import { deriveFileContext } from "./fileContext";
import { getExtension, getFileName, isEnvFileName, shouldIgnorePath } from "./ignoreRules";
import { detectModelPerformance, detectModels } from "./modelDetection";
import { redactSecrets } from "./redactSecrets";
import { scoreScan } from "./scoreScan";
import {
  hasDbCredentials,
  isLocalDbUrl,
  looksLikePlaceholder,
} from "./secretPatterns";
import type {
  AgentDisplayKind,
  AgentModelMapping,
  AgentPermissions,
  DetectedAgent,
  DetectedAssistantTooling,
  DetectedCIWorkflow,
  DetectedWorkflow,
  EvidenceSnippet,
  FileContext,
  Finding,
  ProjectType,
  RepoFile,
  ScanReport,
  ScanSource,
  WorkflowStage,
  ZipScanStats,
} from "./types";

interface RawRepoFile {
  path: string;
  size: number;
  content?: string;
}

interface StaticScanOptions {
  githubTreeTruncated?: boolean;
  scanSource?: ScanSource;
  zipStats?: ZipScanStats;
}

export function staticScan(
  repoName: string,
  rawFiles: RawRepoFile[],
  options: StaticScanOptions = {},
): ScanReport {
  return staticScanFromFiles(repoName, prepareRepoFiles(rawFiles), options);
}

export function prepareRepoFiles(rawFiles: RawRepoFile[]): RepoFile[] {
  return rawFiles.map(toRepoFile);
}

export function staticScanFromFiles(
  repoName: string,
  files: RepoFile[],
  options: StaticScanOptions = {},
): ScanReport {
  const scannedFiles = files.filter((file) => !file.ignored);
  const findings: Finding[] = [];

  // -- File-level counts (separated by kind) --

  // Detect assistant tooling artifacts first so they can be excluded from product counts.
  const detectedAssistantTooling = detectAssistantTooling(files);
  const assistantToolingPaths = new Set(detectedAssistantTooling.map((t) => t.path));

  const detectedPrompts = scannedFiles
    .filter((file) => file.classification === "prompt" && !assistantToolingPaths.has(file.path))
    .map((file) => file.path);

  // Explicit AI evals: /evals/, /evaluations/, promptfoo configs.
  const detectedEvals = scannedFiles
    .filter((file) => file.classification === "eval")
    .map((file) => file.path);

  // Software tests: separate from AI evals.
  const detectedTests = scannedFiles
    .filter((file) => file.classification === "test")
    .map((file) => file.path);

  const detectedWorkflowPaths = scannedFiles
    .filter(
      (file) =>
        file.classification === "workflow" || file.classification === "workflow_config",
    )
    .map((file) => file.path);

  // Prompt-related source files: source code containing prompt language, but not
  // true prompt assets. Assistant tooling files are excluded.
  const detectedPromptRelatedFiles = scannedFiles
    .filter(
      (f) =>
        f.classification === "source_code" &&
        f.content &&
        promptLanguagePattern.test(f.content) &&
        !detectedPrompts.includes(f.path) &&
        !assistantToolingPaths.has(f.path) &&
        !isAssistantToolingPath(f.path),
    )
    .map((f) => f.path)
    .slice(0, 20);

  const detectedLLMInfrastructure = detectLLMInfrastructure(scannedFiles);

  const detectedTools = detectTools(scannedFiles);
  const detectedAgents = detectAgents(scannedFiles, detectedPrompts, detectedTools, detectedEvals);
  const detectedWorkflowsDetailed = detectWorkflows(scannedFiles);
  const detectedCIWorkflows = detectCIWorkflows(scannedFiles);

  // CI workflows alone do not make a project a workflow_system.
  // Low-confidence inferred candidates (prompt-only) do NOT determine project type.
  const hasRealAgents = detectedAgents.some((a) => a.confidence !== "low");
  const hasProductWorkflows = detectedWorkflowsDetailed.length > 0;
  const hasAiSignals = hasRealAgents || hasProductWorkflows || detectAiSignals(scannedFiles);
  const projectType = deriveProjectType(hasRealAgents, hasProductWorkflows, hasAiSignals);

  // -- Structural findings --

  if (!files.some((file) => file.path.toLowerCase().endsWith("agents.md"))) {
    findings.push(finding(
      "missing-agents-md",
      "documentation",
      "medium",
      "Missing AGENTS.md",
      "No AGENTS.md file was found to explain agent behavior and constraints.",
      [],
      "Add AGENTS.md with architecture, tool policy, memory policy, and safety constraints.",
      0.9,
    ));
  }

  const hasAgentConfig = files.some((file) => /(^|\/)agents\.(ya?ml|json)$/i.test(file.path));
  const hasWorkflowConfig = files.some((file) => file.classification === "workflow_config");

  if (!hasAgentConfig && !hasProductWorkflows && !hasWorkflowConfig) {
    const configRec = projectType === "ai_application"
      ? "If this project contains agent-like or workflow-like behavior, add agents.yaml or workflow.yaml. Otherwise, document AI model calls, prompts, tools, and evals in an ai-system.yaml inventory."
      : "Add an agents.yaml or workflow.yaml inventory to document agents, workflows, prompts, tools, evals, ownership, and safety boundaries.";
    findings.push(finding(
      "missing-agent-config",
      "architecture",
      projectType === "ai_application" ? "info" : "low",
      projectType === "ai_application" ? "No agent or workflow manifest found" : "Missing structured agent config",
      projectType === "ai_application"
        ? "AI-related code detected but no agents.yaml or workflow.yaml manifest was found."
        : "No agents.yaml, agents.yml, agents.json, or workflow manifest was found.",
      [],
      configRec,
      0.75,
    ));
  } else if (!hasAgentConfig && (hasProductWorkflows || hasWorkflowConfig) && !files.some((file) => file.classification === "workflow_config")) {
    findings.push(finding(
      "missing-workflow-config",
      "architecture",
      "low",
      "Workflow code detected but no workflow manifest found",
      "Workflow-like files exist but no workflow.yaml/workflow.json manifest was found.",
      detectedWorkflowPaths.slice(0, 3),
      "Add a workflow.yaml manifest to document workflow stages, tools, and safety policies.",
      0.7,
    ));
  }

  // Eval vs test distinction: only flag missing AI evals, not missing generic tests.
  if (detectedEvals.length === 0 && detectedTests.length > 0) {
    findings.push(finding(
      "missing-evals",
      "evalCoverage",
      "medium",
      "No dedicated AI eval suite detected",
      "Software tests were found, but no explicit AI eval suite or eval manifest was detected.",
      [],
      "Add eval cases for prompts, tool selection, grounding, refusal behavior, and failure modes.",
      0.85,
    ));
  } else if (detectedEvals.length === 0 && detectedTests.length === 0) {
    findings.push(finding(
      "missing-evals",
      "evalCoverage",
      "high",
      "No tests or evals detected",
      "Neither software tests nor a dedicated AI eval suite were found in this repository.",
      [],
      "Add tests for core behavior and dedicated AI eval cases for prompts, tool selection, and failure modes.",
      0.85,
    ));
  }

  // CI workflow finding when only CI workflows exist.
  if (detectedCIWorkflows.length > 0 && !hasProductWorkflows) {
    findings.push(finding(
      "ci-only-no-ai-workflow",
      "architecture",
      "info",
      "CI workflows detected; AI workflow manifest missing",
      `${detectedCIWorkflows.length} CI workflow(s) detected, but no AI/product workflow manifest was found.`,
      detectedCIWorkflows.map((w) => w.path).slice(0, 3),
      "Add workflow.yaml only if this repository contains an AI/product workflow that should be audited.",
      0.7,
    ));
  }

  if (options.githubTreeTruncated) {
    findings.push(finding(
      "github-tree-truncated",
      "architecture",
      "medium",
      "GitHub tree response truncated",
      "GitHub reported that the recursive repository tree response was truncated, so this scan may not include every file.",
      [],
      "Scan a narrower repository scope or add pagination-aware tree traversal before relying on this report for full coverage.",
      0.95,
    ));
  }

  if (detectedAssistantTooling.length > 0) {
    findings.push(finding(
      "assistant-tooling-detected",
      "architecture",
      "info",
      "Assistant tooling detected",
      `${detectedAssistantTooling.length} developer-assistant artifact(s) were found and separated from product agent/workflow analysis.`,
      detectedAssistantTooling.map((t) => t.path).slice(0, 5),
      "Keep assistant tooling separate from product manifests unless it is part of the deployed AI system.",
      0.9,
    ));
  }

  if (options.zipStats && options.zipStats.skippedByFileLimit > 0) {
    findings.push(finding(
      "zip-scan-prioritized-subset",
      "ingestion",
      options.zipStats.skippedByFileLimit > 200 ? "medium" : "low",
      "ZIP scan analyzed prioritized subset",
      `ZIP contained ${options.zipStats.candidateFiles} candidate files. AgentPulse scanned the top ${options.zipStats.scannedFiles} prioritized files and skipped ${options.zipStats.skippedByFileLimit} lower-priority files.`,
      [],
      "Use GitHub repository scanning for a complete scan, or reduce the ZIP size.",
      0.95,
    ));
  }

  // -- Security findings --

  for (const file of files) {
    if (file.ignored && isEnvFileName(file.name)) {
      findings.push(finding(
        `ignored-env-${hashId(file.path)}`,
        "security",
        "high",
        "Sensitive environment file present",
        `${file.path} was ignored and should not be committed to source control.`,
        [file.path],
        secretRecommendation(
          options.scanSource?.type,
          "Remove committed environment files and rotate any exposed credentials.",
        ),
        0.95,
      ));
    }

    if (file.redacted && file.secretMatchDetails && file.secretMatchDetails.length > 0) {
      const f = buildSecretFinding(file, options.scanSource?.type);
      if (f) findings.push(f);
    } else if (file.redacted) {
      // Fallback for backward compat: no detail available.
      findings.push(finding(
        `redacted-secret-${hashId(file.path)}`,
        "security",
        "high",
        "Secret-like value redacted",
        `Secret-like value detected and redacted in ${file.path}.`,
        [file.path],
        secretRecommendation(
          options.scanSource?.type,
          "Remove the value from the repository and rotate it if it was real.",
        ),
        0.85,
      ));
    }
  }

  // -- Tool governance findings --

  const writeToolPaths = scannedFiles.filter((file) => findWriteToolNames(file).length > 0);
  const hasApprovalPolicy = scannedFiles
    .filter(isLikelyToolOrAgentFile)
    .some((file) => approvalPolicyPattern.test(file.content ?? ""));

  if (writeToolPaths.length > 0 && !hasApprovalPolicy) {
    findings.push(finding(
      "write-tools-without-approval",
      "toolGovernance",
      "high",
      "Possible write tools without approval policy",
      "The scanner found write-like tool names but did not find an approval or dry-run policy.",
      writeToolPaths.map((file) => file.path),
      "Document and enforce approval gates for tools that create, update, publish, post, email, or delete.",
      0.7,
    ));
  }

  // -- Model/provider detection (deterministic) --
  const detectedModels = detectModels(files, detectedAgents, detectedWorkflowsDetailed);
  const modelPerformance = detectModelPerformance(files);

  // -- AI System Graph --
  const systemGraph = buildSystemGraph({
    detectedAgents,
    detectedWorkflowsDetailed,
    detectedPrompts,
    detectedPromptRelatedFiles,
    detectedTools,
    detectedEvals,
    detectedTests,
    detectedCIWorkflows,
    detectedModels,
    modelPerformance,
  });

  // -- Graph-derived findings (moderate, project-type-aware penalties) --
  const hasManifestAgents = detectedAgents.some((a) => a.displayKind === "manifest");
  if (hasManifestAgents) {
    if (systemGraph.summary.missingPromptLinks > 0) {
      findings.push(finding(
        "graph-agents-missing-prompts",
        "promptQuality",
        "low",
        "Manifest agents missing prompt mapping",
        `${systemGraph.summary.missingPromptLinks} agent(s) have no mapped prompt in agents.yaml.`,
        [],
        "Add prompts: list per agent in agents.yaml so prompts can be tied to specific agents.",
        0.7,
      ));
    }
    if (systemGraph.summary.missingEvalLinks > 0 && detectedEvals.length > 0) {
      findings.push(finding(
        "graph-agents-missing-evals",
        "evalCoverage",
        "low",
        "Agents not linked to evals",
        `${systemGraph.summary.missingEvalLinks} agent(s) have no mapped evals despite eval files existing in the repo.`,
        [],
        "Attach eval suites to the agents or workflow steps they validate.",
        0.7,
      ));
    }
    if (systemGraph.summary.missingModelLinks > 0) {
      findings.push(finding(
        "graph-agents-missing-model",
        "architecture",
        "low",
        "Manifest agents missing model/provider mapping",
        `${systemGraph.summary.missingModelLinks} agent(s) have no mapped model/provider in agents.yaml.`,
        [],
        "Add model: { provider, name } per agent in agents.yaml or workflow.yaml.",
        0.7,
      ));
    }
  }

  // Workflow stages missing
  for (const wf of detectedWorkflowsDetailed) {
    if (wf.source === "explicit" && (!wf.stages || wf.stages.length === 0)) {
      findings.push(finding(
        `graph-workflow-missing-steps-${wf.id}`,
        "architecture",
        "low",
        "Workflow manifest has no stages",
        `Workflow "${wf.name}" is defined but has no stages.`,
        wf.configPath ? [wf.configPath] : [],
        "Add stages with id, name, and agent fields to the workflow manifest.",
        0.7,
      ));
    }
  }

  const scores = scoreScan(findings);

  return {
    reportVersion: "1.0",
    repoName,
    scanSource: options.scanSource,
    zipStats: options.zipStats,
    scannedAt: new Date().toISOString(),
    filesScanned: scannedFiles.length,
    ignoredFiles: files.length - scannedFiles.length,
    projectType,
    detectedAgents,
    detectedWorkflowsDetailed,
    detectedCIWorkflows,
    detectedAssistantTooling,
    detectedPrompts,
    detectedPromptRelatedFiles,
    detectedLLMInfrastructure: detectedLLMInfrastructure.length > 0 ? detectedLLMInfrastructure : undefined,
    detectedTools,
    detectedEvals,
    detectedTests,
    detectedWorkflows: detectedWorkflowPaths,
    detectedModels,
    modelPerformance: modelPerformance.length > 0 ? modelPerformance : undefined,
    systemGraph,
    findings,
    scores,
    recommendations: buildRecommendations(findings, {
      projectType,
      systemGraph,
      hasManifestAgents,
      modelPerformance: modelPerformance.length > 0,
    }),
  };
}

// -- Secret finding calibration --

function buildSecretFinding(
  file: RepoFile,
  scanSourceType: ScanSource["type"] | undefined,
): Finding | null {
  const details = file.secretMatchDetails;
  if (!details || details.length === 0) return null;

  const context: FileContext = file.fileContext ?? "unknown";

  const highestConfidence = details.reduce(
    (best, m) => {
      if (m.confidence === "high") return "high";
      if (best === "high") return "high";
      if (m.confidence === "medium") return "medium";
      return best;
    },
    "low" as "low" | "medium" | "high",
  );

  // Placeholder detection: stub/example/changeme values are always info.
  const hasPlaceholder = details.some(
    (m) => m.matchedPreview && looksLikePlaceholder(m.matchedPreview),
  );

  // Credential-free database URL detection.
  const allDbUrl = details.every((m) => m.kind === "Database URL");
  const hasRealDbCredentials = details.some(
    (m) => m.kind === "Database URL" && m.matchedPreview && hasDbCredentials(m.matchedPreview),
  );
  const hasLocalDbUrl = details.some(
    (m) => m.kind === "Database URL" && m.matchedPreview && isLocalDbUrl(m.matchedPreview),
  );
  const isCredentialFreeOrLocalDb = allDbUrl && (!hasRealDbCredentials || hasLocalDbUrl);

  let severity: Finding["severity"];
  let confidenceValue: number;
  let recommendation: string;

  if (hasPlaceholder) {
    severity = "info";
    confidenceValue = 0.25;
    recommendation =
      "Placeholder or local value detected; no rotation required unless this is a real credential.";
  } else if (isCredentialFreeOrLocalDb) {
    severity = "info";
    confidenceValue = 0.25;
    recommendation =
      "Non-credentialed or local database URL detected. If it contains real credentials, move them to environment variables.";
  } else if (context === "example") {
    // Fixture/example directories — values are likely fake test data.
    severity = highestConfidence === "high" ? "medium" : "low";
    confidenceValue = highestConfidence === "high" ? 0.6 : 0.45;
    recommendation =
      "Fixture/example value detected. No rotation required unless this represents a real credential.";
  } else if (context === "documentation") {
    // Documentation examples — likely illustrative.
    severity = highestConfidence === "high" ? "medium" : "low";
    confidenceValue = highestConfidence === "high" ? 0.6 : 0.45;
    recommendation =
      "Review this documentation example. Replace with placeholders if it contains a real credential.";
  } else if (context === "test" || context === "migration") {
    // Test files may use realistic-looking values but are not production risk.
    severity = highestConfidence === "high" ? "medium" : "low";
    confidenceValue = highestConfidence === "high" ? 0.6 : 0.45;
    recommendation =
      "Review this test/example value. No rotation is required unless it represents a real credential.";
  } else if (context === "ci") {
    // CI config secrets are real risk if the file is committed.
    severity = highestConfidence === "high" ? "medium" : "low";
    confidenceValue = 0.65;
    recommendation =
      "Move CI secrets to your CI provider's secrets management. Do not commit them to the repository.";
  } else {
    // Production, config, or unknown context: full severity.
    severity = highestConfidence === "high" ? "high" : highestConfidence === "medium" ? "medium" : "low";
    confidenceValue =
      highestConfidence === "high" ? 0.95 : highestConfidence === "medium" ? 0.75 : 0.5;
    recommendation = scanSourceType === "zip"
      ? "If this ZIP came from a real repo, remove and rotate confirmed secrets."
      : "Remove this value from the repository and rotate it if it was real.";
  }

  const secretTypes = details.map((m) => m.kind).join(", ");
  const contextLabel = fileContextLabel(context);
  const snippets = buildSecretSnippets(file);

  return {
    ...finding(
      `redacted-secret-${hashId(file.path)}`,
      "security",
      severity,
      "Secret-like value redacted",
      `${secretTypes} detected and redacted in ${file.path}${contextLabel}.`,
      [file.path],
      recommendation,
      confidenceValue,
    ),
    evidenceSnippets: snippets,
  };
}

function fileContextLabel(context: FileContext): string {
  switch (context) {
    case "documentation": return " (documentation)";
    case "test": return " (test file)";
    case "example": return " (example/fixture)";
    case "ci": return " (CI configuration)";
    case "migration": return " (migration file)";
    default: return "";
  }
}

function secretRecommendation(sourceType: ScanSource["type"] | undefined, fallback: string) {
  if (sourceType === "zip") {
    return "If this ZIP came from a real repo, remove and rotate confirmed secrets.";
  }

  return fallback;
}

// -- Project type --

function deriveProjectType(hasAgents: boolean, hasProductWorkflows: boolean, hasAiSignals: boolean): ProjectType {
  if (hasAgents && hasProductWorkflows) return "hybrid_workflow_agent";
  if (hasAgents) return "agent_system";
  if (hasProductWorkflows) return "workflow_system";
  if (hasAiSignals) return "ai_application";
  return "unknown_ai_project";
}

// AI signals: model/provider imports, AI-related env names, AI function patterns — but no
// explicit agent or workflow manifest. Used to distinguish ai_application from unknown_ai_project.
function detectAiSignals(files: RepoFile[]): boolean {
  const aiProviderPattern =
    /\b(?:openai|anthropic|gemini|cohere|mistral|llm|langchain|llamaindex|vertexai|bedrock|groq|together)\b/i;
  const aiEnvPattern =
    /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|COHERE_API_KEY|TOGETHER_API_KEY|MISTRAL_API_KEY|LLM_PROVIDER|AI_MODEL|MODEL_PROVIDER|OPENAI_BASE_URL)\b/;
  const aiFunctionPattern =
    /\b(?:generateText|generateContent|createCompletion|chat\.completions|messages\.create|generate|summarize|classify|extract|enrich|embed|completion|streamText|generateObject)\b/;
  const aiImportPattern =
    /\b(?:from\s+["'](?:openai|@anthropic-ai|@google\/generative-ai|langchain|@langchain|llamaindex|groq-sdk|cohere-ai|together-ai)|import\s+OpenAI|import\s+Anthropic|require\(["']openai["']\))\b/;

  for (const file of files) {
    if (!file.content) continue;

    // High-signal: AI SDK imports
    if (aiImportPattern.test(file.content)) return true;

    // High-signal: AI API env names
    if (aiEnvPattern.test(file.content)) return true;

    // Medium-signal: AI provider names + AI function patterns together
    if (aiProviderPattern.test(file.content) && aiFunctionPattern.test(file.content)) return true;
  }

  // File-path signals: files named after AI providers or LLM concepts
  const aiPathPattern =
    /\b(?:openai|anthropic|gemini|llm|model[-_]provider|ai[-_]service|ai[-_]client|prompt[-_]builder|prompt[-_]service|ai[-_]utils?|modelService)\b/i;
  return files.some((f) => aiPathPattern.test(f.name));
}

// -- File preparation --

function toRepoFile(raw: RawRepoFile): RepoFile {
  const ignored = shouldIgnorePath(raw.path, raw.size);
  const initialContent = ignored.ignored ? undefined : raw.content;
  const classification = classifyFile(raw.path, initialContent);
  const fileContext = deriveFileContext(raw.path);
  const redaction = ignored.ignored
    ? { content: "", redacted: false, matches: [], secretMatches: [] }
    : redactSecrets(initialContent);

  return {
    path: raw.path,
    name: getFileName(raw.path),
    extension: getExtension(raw.path),
    size: raw.size,
    content: ignored.ignored ? undefined : redaction.content,
    classification,
    fileContext,
    redacted: redaction.redacted,
    secretMatches: redaction.matches,
    secretMatchDetails: redaction.secretMatches,
    ignored: ignored.ignored,
    reason: ignored.reason,
  };
}

// -- Assistant tooling path detection --

// Returns true if the file path belongs to a developer-assistant tooling folder
// (.claude, .cursor, .vscode, .windsurf, .github/copilot, etc.).
// These are excluded from product agent/workflow/prompt counts and reported separately.
function isAssistantToolingPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.startsWith(".claude/") ||
    lower.startsWith(".cursor/") ||
    lower.startsWith(".vscode/") ||
    lower.startsWith(".windsurf/") ||
    lower.startsWith(".github/copilot/") ||
    lower.startsWith("codex/") ||
    lower.startsWith("devtools/") ||
    lower.startsWith("ai-assistant/") ||
    lower.startsWith("assistant-tools/")
  );
}

function detectAssistantTooling(files: RepoFile[]): DetectedAssistantTooling[] {
  const results: DetectedAssistantTooling[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (file.ignored) continue;
    if (!isAssistantToolingPath(file.path)) continue;
    if (seen.has(file.path)) continue;
    seen.add(file.path);

    const lower = file.path.toLowerCase();
    const name = getFileName(lower);

    let kind: DetectedAssistantTooling["kind"] = "other";
    let label: string | undefined;

    if (lower.startsWith(".claude/")) {
      if (lower.includes("/agents/") || name.endsWith("_agent.md") || name.endsWith("_agent.py")) {
        kind = "assistant_agent";
        label = formatAgentName(name);
      } else if (lower.includes("/skills/")) {
        kind = "claude_skill";
        const skillSegment = file.path.split("/").slice(0, 3).join("/");
        label = skillSegment;
      } else if (lower.includes("/prompts/") || name.endsWith(".prompt.md") || name.startsWith("system-prompt")) {
        kind = "assistant_prompt";
      } else {
        kind = "other";
      }
    } else if (lower.startsWith(".cursor/")) {
      if (lower.includes("/rules/")) {
        kind = "cursor_rule";
      } else if (lower.includes("/agents/") || name.endsWith("_agent")) {
        kind = "assistant_agent";
        label = formatAgentName(name);
      } else {
        kind = "other";
      }
    } else if (lower.startsWith(".vscode/")) {
      kind = "vscode_config";
    } else {
      kind = "other";
    }

    results.push({ path: file.path, kind, label });
  }

  return results;
}

// -- CI workflow detection --

function detectCIWorkflows(files: RepoFile[]): DetectedCIWorkflow[] {
  return files
    .filter((f) => f.classification === "ci" && !f.ignored)
    .map((f) => ({
      name: getFileName(f.path).replace(/\.[^.]+$/, ""),
      path: f.path,
      provider: ciProvider(f.path),
    }));
}

function ciProvider(path: string): DetectedCIWorkflow["provider"] {
  const normalized = `/${path.toLowerCase()}`;
  if (normalized.includes("/.github/workflows/")) return "github_actions";
  if (normalized.includes(".gitlab-ci")) return "gitlab";
  if (normalized.includes("/.circleci/")) return "circleci";
  return "unknown";
}

// -- Workflow detection --

function detectWorkflows(files: RepoFile[]): DetectedWorkflow[] {
  const configFiles = files.filter((f) => f.classification === "workflow_config");
  const workflows: DetectedWorkflow[] = [];

  for (const file of configFiles) {
    const parsed = parseStructuredConfig(file);
    if (!parsed) {
      workflows.push({
        id: slug(file.name.replace(/\.[^.]+$/, "")),
        name: file.name.replace(/\.[^.]+$/, ""),
        configPath: file.path,
        risks: ["Workflow manifest could not be parsed."],
        source: "explicit",
        confidence: "medium",
        evidenceReason: `Found ${file.path}`,
      });
      continue;
    }

    const entries = workflowConfigEntries(parsed);
    for (const entry of entries) {
      workflows.push(workflowFromEntry(entry, file.path));
    }
  }

  // If no config files but /workflows/ directory exists outside .github, infer a workflow.
  const hasProductWorkflowDir = files.some((f) => {
    const n = `/${f.path.toLowerCase()}`;
    return n.includes("/workflows/") && !n.includes("/.github/") && !f.ignored;
  });
  if (configFiles.length === 0 && hasProductWorkflowDir) {
    const workflowFiles = files.filter((f) => {
      const n = `/${f.path.toLowerCase()}`;
      return n.includes("/workflows/") && !n.includes("/.github/") && !f.ignored;
    });
    workflows.push({
      id: "inferred-workflow",
      name: "Inferred Workflow",
      type: "unknown",
      configPath: workflowFiles[0]?.path,
      risks: ["Workflow inferred from /workflows/ directory; no manifest found."],
      source: "inferred",
      confidence: "medium",
      evidenceReason: "Found /workflows/ directory without a manifest",
    });
  }

  return workflows;
}

function workflowConfigEntries(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!isRecord(parsed)) return [];

  if (Array.isArray(parsed.workflows)) return parsed.workflows;
  if (isRecord(parsed.workflows)) return Object.values(parsed.workflows);
  if (isRecord(parsed.workflow) || typeof parsed.workflow === "object") {
    const w = parsed.workflow;
    if (w !== null && typeof w === "object") return [w];
  }
  if ("id" in parsed || "name" in parsed) return [parsed];
  return [];
}

function workflowFromEntry(entry: unknown, configPath: string): DetectedWorkflow {
  const record = isRecord(entry) ? entry : {};
  const id = firstString(record.id) ?? firstString(record.name) ?? "workflow";
  const name = firstString(record.name) ?? firstString(record.id) ?? "Workflow";
  const rawType = firstString(record.type);
  const type = parseWorkflowType(rawType);

  const stagesRaw = record.stages;
  let stages: string[];
  let stagesDetailed: WorkflowStage[] | undefined;
  if (Array.isArray(stagesRaw) && stagesRaw.some((s) => isRecord(s))) {
    stagesDetailed = stagesRaw.map((s, idx) => parseWorkflowStage(s, idx));
    stages = stagesDetailed.map((s) => s.name ?? s.id);
  } else {
    stages = valueStrings(stagesRaw);
  }

  const tools = valueStrings(record.tools);
  const evals = valueStrings(record.evals);
  const owner = firstString(record.owner);
  const status = firstString(record.status);
  const architecture = firstString(record.architecture);
  const approvalGates = valueStrings(record.approval_gates).concat(valueStrings(record.approvalGates));
  const artifacts = valueStrings(record.artifacts);

  return {
    id: slug(id),
    name,
    type: type ?? "unknown",
    stages: stages.length > 0 ? stages : undefined,
    tools: tools.length > 0 ? tools : undefined,
    evals: evals.length > 0 ? evals : undefined,
    configPath,
    source: "explicit",
    confidence: "high",
    evidenceReason: `Defined in ${configPath}`,
    ...(stagesDetailed && stagesDetailed.length > 0 ? { stagesDetailed } : {}),
    ...(owner ? { owner } : {}),
    ...(status ? { status } : {}),
    ...(architecture ? { architecture } : {}),
    ...(approvalGates.length > 0 ? { approvalGates: [...new Set(approvalGates)] } : {}),
    ...(artifacts.length > 0 ? { artifacts } : {}),
  };
}

function parseWorkflowStage(entry: unknown, idx: number): WorkflowStage {
  const record = isRecord(entry) ? entry : {};
  const id = firstString(record.id) ?? firstString(record.name) ?? `stage-${idx + 1}`;
  const name = firstString(record.name);
  const agent = firstString(record.agent);
  const prompt = firstString(record.prompt) ?? firstString(record.prompt_path);
  const tools = valueStrings(record.tools);
  const evals = valueStrings(record.evals);
  const model = parseModelMapping(record.model);
  const approvalGate =
    record.approval_gate === true ||
    record.approvalGate === true ||
    record.approval === true ||
    undefined;
  const artifacts = valueStrings(record.artifacts).concat(valueStrings(record.produces));

  return {
    id: slug(id),
    ...(name ? { name } : {}),
    ...(agent ? { agent } : {}),
    ...(prompt ? { prompt } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(evals.length > 0 ? { evals } : {}),
    ...(model ? { model } : {}),
    ...(approvalGate ? { approvalGate: true } : {}),
    ...(artifacts.length > 0 ? { artifacts: [...new Set(artifacts)] } : {}),
  };
}

function parseWorkflowType(raw: string | undefined): DetectedWorkflow["type"] {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (lower.includes("hybrid")) return "hybrid_workflow_agent";
  if (lower.includes("tool")) return "workflow_with_tools";
  if (lower.includes("deterministic")) return "deterministic_workflow";
  return "unknown";
}

// -- Agent detection --

// Returns true for top-level manifest files: agents.yaml, agents.yml, agents.json.
function isManifestAgentConfig(path: string): boolean {
  const name = getFileName(path.toLowerCase());
  return /^agents?\.(ya?ml|json)$/.test(name);
}

// Returns true for source files whose filename pattern suggests they are agent modules.
// Covers common Python/TypeScript naming conventions for product agent files.
function isAgentSourceFile(path: string): boolean {
  const name = getFileName(path.toLowerCase());
  return (
    name.endsWith("_agent.py") ||
    name.endsWith("_agent.ts") ||
    name.endsWith("_evaluator.py") ||
    name.endsWith("_evaluator.ts") ||
    name.endsWith("_judge.py") ||
    name.endsWith("_critic.py") ||
    name.endsWith("_planner.py") ||
    name.endsWith("_router.py") ||
    name.endsWith("_researcher.py") ||
    name.endsWith("_writer.py") ||
    name.endsWith("_editor.py") ||
    /^agent[_-]/.test(name)
  );
}

// Format a filename like "editor_agent.py" → "Editor Agent" for display.
function formatAgentName(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function detectAgents(
  files: RepoFile[],
  promptPaths: string[],
  toolNames: string[],
  evalPaths: string[],
): DetectedAgent[] {
  // Exclude assistant tooling files from ALL agent detection paths.
  const configs = files.filter(
    (file) => file.classification === "agent_config" && !file.ignored && !isAssistantToolingPath(file.path),
  );

  // Manifest configs: top-level agents.yaml / agents.yml / agents.json files.
  const manifestConfigs = configs.filter((f) => isManifestAgentConfig(f.path));
  // Agent dir files: non-manifest agent_config files in /agents/ directory (e.g., /agents/researcher.md).
  const agentDirFiles = configs.filter((f) => !isManifestAgentConfig(f.path));

  // Source-based agent files: *_agent.py, *_evaluator.py, etc.
  // Exclude assistant tooling paths so .claude/skills/.../agents/*.py is not counted.
  const agentSourceFiles = files.filter(
    (f) =>
      !f.ignored &&
      f.classification === "source_code" &&
      isAgentSourceFile(f.path) &&
      !isAssistantToolingPath(f.path),
  );

  const hasManifest = manifestConfigs.length > 0;
  const hasAgentDirFiles = agentDirFiles.length > 0;
  const hasAgentSourceFiles = agentSourceFiles.length > 0;

  if (!hasManifest && !hasAgentDirFiles && !hasAgentSourceFiles && promptPaths.length === 0) {
    return [];
  }

  const detected: DetectedAgent[] = [];

  // Parse manifest agents (agents.yaml/agents.json) — highest confidence.
  for (const [configIndex, file] of manifestConfigs.entries()) {
    const fromConfig = agentsFromConfig(file, configIndex);
    if (fromConfig.length > 0) {
      detected.push(...fromConfig.map((a) => ({ ...a, displayKind: "manifest" as AgentDisplayKind })));
    } else {
      detected.push({
        id: `agent-${configIndex + 1}`,
        name: file.name.replace(/\.[^.]+$/, ""),
        promptPaths: [],
        toolNames: [],
        evalPaths: [],
        configPath: file.path,
        risks: ["Agent config could not be parsed."],
        source: "explicit" as const,
        confidence: "medium" as const,
        displayKind: "manifest" as AgentDisplayKind,
        evidenceReason: `Found ${file.path} but could not parse it`,
      });
    }
  }

  // Agent directory files (unstructured — /agents/*.md, /agents/*.yaml without top-level manifest).
  for (const [index, file] of agentDirFiles.entries()) {
    const agentName = formatAgentName(file.name) || `Agent ${index + 1}`;
    detected.push({
      id: slug(file.name.replace(/\.[^.]+$/, "") || `agent-dir-${index + 1}`),
      name: agentName,
      promptPaths: [],
      toolNames: [],
      evalPaths: [],
      configPath: file.path,
      risks: ["Agent file in /agents/ directory detected; no top-level agents.yaml config found."],
      source: "inferred" as const,
      confidence: "medium" as const,
      displayKind: "agent_file" as AgentDisplayKind,
      evidenceReason: `Found agent file at ${file.path}`,
    });
  }

  // Source-based agent files (*_agent.py, *_evaluator.py, *_judge.py, etc.).
  // Only added when no manifest or dir files found yet; never from assistant tooling paths.
  if (detected.length === 0 && hasAgentSourceFiles) {
    for (const [index, file] of agentSourceFiles.entries()) {
      const agentName = formatAgentName(file.name) || `Agent ${index + 1}`;
      detected.push({
        id: slug(file.name.replace(/\.[^.]+$/, "") || `agent-src-${index + 1}`),
        name: agentName,
        promptPaths: [],
        toolNames: [],
        evalPaths: [],
        configPath: file.path,
        risks: ["Agent detected from filename pattern; no structured agent config found."],
        source: "inferred" as const,
        confidence: "medium" as const,
        displayKind: "agent_file" as AgentDisplayKind,
        evidenceReason: "Python agent module detected under product agents directory.",
      });
    }
  }

  // Prompt-only inference — low confidence, does NOT define project type.
  if (detected.length === 0 && promptPaths.length > 0) {
    detected.push({
      id: "inferred-agent",
      name: "Inferred agent candidate",
      promptPaths: [],
      toolNames: [],
      evalPaths: [],
      risks: [
        "Agent inferred from prompt files. No explicit agent config was found.",
        "Prompt, tool, and eval links are not mapped without an agent config.",
      ],
      source: "inferred",
      confidence: "low",
      displayKind: "inferred_candidate" as AgentDisplayKind,
      evidenceReason: `Inferred from ${promptPaths.length} prompt file(s); no agents.yaml found`,
    });
  }

  return detected;
}

function agentsFromConfig(
  file: RepoFile,
  configIndex: number,
): DetectedAgent[] {
  const parsed = parseStructuredConfig(file);
  if (!parsed) return [];

  const entries = agentConfigEntries(parsed);

  return entries.map((entry, entryIndex) => {
    const record = isRecord(entry) ? entry : {};
    const id = firstString(record.id);
    const name = firstString(record.name);

    // Plain shape: prompts: [...]
    let promptPaths = collectFieldStrings(record, ["prompt_path", "promptPath", "prompt", "prompts"]);
    let toolNames = collectFieldStrings(record, ["tools"]);
    let evalPaths = collectFieldStrings(record, ["evals"]);

    // Nested shape: files.prompt, tools.allowed, evals.paths.
    const filesField = isRecord(record.files) ? record.files : undefined;
    if (filesField) {
      const promptFile = firstString(filesField.prompt);
      if (promptFile) promptPaths = [...new Set([...promptPaths, promptFile])];
    }
    if (isRecord(record.tools)) {
      const allowed = valueStrings(record.tools.allowed);
      if (allowed.length > 0) toolNames = [...new Set([...toolNames, ...allowed])];
    }
    if (isRecord(record.evals)) {
      const evalsPaths = valueStrings(record.evals.paths);
      if (evalsPaths.length > 0) evalPaths = [...new Set([...evalPaths, ...evalsPaths])];
    }

    const model = parseModelMapping(record.model);
    // Provider-only shape: provider: { name: ... }
    if (!model && isRecord(record.provider)) {
      const providerName = firstString(record.provider.name);
      if (providerName) {
        // hoist provider into model with no name.
      }
    }
    const owner = firstString(record.owner);
    const permissions = parsePermissions(record.permissions);
    const filesRecord: Record<string, string> | undefined = filesField
      ? Object.fromEntries(
          Object.entries(filesField).flatMap(([k, v]) => {
            const s = firstString(v);
            return s ? [[k, s]] : [];
          }),
        )
      : undefined;

    const missing = [
      id ? undefined : "id",
      name ? undefined : "name",
      promptPaths.length > 0 ? undefined : "prompt_path",
      toolNames.length > 0 ? undefined : "tools",
      evalPaths.length > 0 ? undefined : "evals",
    ].filter(Boolean);

    return {
      id: slug(id ?? name ?? `${file.name}-${entryIndex + 1}`),
      name: name ?? id ?? `Agent ${configIndex + 1}.${entryIndex + 1}`,
      promptPaths,
      toolNames,
      evalPaths,
      configPath: file.path,
      risks: missing.length > 0 ? [`Agent config is missing ${missing.join(", ")}.`] : [],
      source: "explicit" as const,
      confidence: "high" as const,
      evidenceReason: `Defined in ${file.path}`,
      ...(model ? { model } : {}),
      ...(owner ? { owner } : {}),
      ...(permissions ? { permissions } : {}),
      ...(filesRecord && Object.keys(filesRecord).length > 0 ? { files: filesRecord } : {}),
    };
  });
}

function parseModelMapping(value: unknown): AgentModelMapping | undefined {
  if (!isRecord(value)) return undefined;
  const provider = firstString(value.provider);
  const name = firstString(value.name) ?? firstString(value.model);
  if (!provider && !name) return undefined;
  const temperature = typeof value.temperature === "number" ? value.temperature : undefined;
  const maxTokens =
    typeof value.max_tokens === "number"
      ? value.max_tokens
      : typeof value.maxTokens === "number"
        ? value.maxTokens
        : undefined;
  return {
    provider: provider ?? "unknown",
    ...(name ? { name } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  };
}

function parsePermissions(value: unknown): AgentPermissions | undefined {
  if (!isRecord(value)) return undefined;
  const out: AgentPermissions = {};
  if (typeof value.external_network === "boolean") out.externalNetwork = value.external_network;
  else if (typeof value.externalNetwork === "boolean") out.externalNetwork = value.externalNetwork;
  if (typeof value.write_files === "boolean") out.writeFiles = value.write_files;
  else if (typeof value.writeFiles === "boolean") out.writeFiles = value.writeFiles;
  if (typeof value.publish === "boolean") out.publish = value.publish;
  const extra: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(value)) {
    if (["external_network", "externalNetwork", "write_files", "writeFiles", "publish"].includes(k)) continue;
    if (typeof v === "boolean") extra[k] = v;
  }
  if (Object.keys(extra).length > 0) out.extra = extra;
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseStructuredConfig(file: RepoFile) {
  if (!file.content) return undefined;

  try {
    return /\.(ya?ml)$/i.test(file.path)
      ? yaml.load(file.content)
      : JSON.parse(file.content);
  } catch {
    return undefined;
  }
}

function agentConfigEntries(parsed: unknown) {
  if (Array.isArray(parsed)) return parsed;
  if (!isRecord(parsed)) return [];

  if (Array.isArray(parsed.agents)) return parsed.agents;
  if (isRecord(parsed.agents)) return Object.values(parsed.agents);
  return [parsed];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// -- LLM infrastructure detection --

// Detects LLM provider/client files that are infrastructure, not prompt assets.
// Examples: llm/client.py, providers/openai.ts, modelProvider.ts
function detectLLMInfrastructure(files: RepoFile[]): string[] {
  const results: string[] = [];

  for (const file of files) {
    if (file.ignored || isAssistantToolingPath(file.path)) continue;
    if (file.classification !== "source_code") continue;

    const lower = file.path.toLowerCase();
    const name = getFileName(lower);
    const normalized = `/${lower}`;

    const isLLMInfra = (
      normalized.includes("/llm/") ||
      (normalized.includes("/providers/") && /\b(openai|anthropic|gemini|cohere|mistral|groq|together|bedrock)\b/.test(file.content ?? "")) ||
      /^(openai|anthropic|gemini|model[_-]?provider|ai[_-]?service|ai[_-]?client|llm[_-]?client|model[_-]?service)\.(ts|js|py)$/.test(name)
    );

    if (isLLMInfra) results.push(file.path);
  }

  return results.slice(0, 20);
}

// -- Tool detection --

function detectTools(files: RepoFile[]) {
  const toolNames = new Set<string>();

  for (const file of files) {
    if (!isToolExtractionCandidate(file)) continue;

    const names = extractToolNames(file);
    for (const name of names) toolNames.add(name);
    if (names.length === 0 && file.classification === "tool") {
      toolNames.add(file.path);
    }
  }

  return [...toolNames];
}

function isToolExtractionCandidate(file: RepoFile) {
  const normalized = `/${file.path.toLowerCase()}`;
  return (
    file.classification === "tool" ||
    file.classification === "agent_config" ||
    normalized.includes("/tools/") ||
    normalized.includes("/agents/")
  );
}

function extractToolNames(file: RepoFile) {
  if (file.classification === "agent_config") {
    const parsed = parseStructuredConfig(file);
    return parsed ? uniqueStrings(collectStructuredToolNames(parsed)) : [];
  }

  const content = file.content ?? "";
  const names = [
    ...matchAll(content, /\b(?:tool|function_tool|toolName|name)\s*[:=]\s*["'`]([a-zA-Z0-9_-]+)["'`]/g),
    ...toolArrayNames(content),
    ...matchAll(content, /\b(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)\s*\(/g),
    ...matchAll(content, /\b(?:export\s+)?(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*tool\s*\(/g),
  ];

  return uniqueStrings(names);
}

function collectStructuredToolNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectStructuredToolNames);
  if (!isRecord(value)) return [];

  const names: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (key === "tools" || key === "tool") {
      names.push(...collectToolValueNames(child));
      continue;
    }
    if ((key === "toolName" || key === "tool_name") && typeof child === "string") {
      names.push(child);
      continue;
    }
    names.push(...collectStructuredToolNames(child));
  }
  return names;
}

function collectToolValueNames(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectToolValueNames);
  if (!isRecord(value)) return [];
  return [
    ...collectFieldStrings(value, ["name", "id", "toolName", "tool_name"]),
    ...collectStructuredToolNames(value),
  ];
}

function collectFieldStrings(record: Record<string, unknown>, keys: string[]) {
  return uniqueStrings(keys.flatMap((key) => valueStrings(record[key])));
}

function firstString(value: unknown) {
  return valueStrings(value)[0];
}

function valueStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(valueStrings);
  return [];
}

function matchAll(content: string, pattern: RegExp) {
  return [...content.matchAll(pattern)].map((match) => match[1]).filter(Boolean);
}

function toolArrayNames(content: string) {
  const names: string[] = [];
  for (const match of content.matchAll(/\btools\s*[:=]\s*\[([\s\S]{0,500}?)\]/g)) {
    names.push(...matchAll(match[1], /["'`]([a-zA-Z0-9_-]+)["'`]/g));
  }
  return names;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function slug(value: string) {
  const next = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
  return next || "agent";
}

function findWriteToolNames(file: RepoFile) {
  if (!isLikelyToolOrAgentFile(file)) return [];
  return extractToolNames(file).filter(isWriteToolName);
}

function isWriteToolName(name: string) {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return writeToolTerms.some((term) => normalized.startsWith(term));
}

function isLikelyToolOrAgentFile(file: RepoFile) {
  const normalized = `/${file.path.toLowerCase()}`;
  return (
    file.classification === "tool" ||
    file.classification === "agent_config" ||
    normalized.includes("/tools/") ||
    normalized.includes("/agents/") ||
    /\btool(s)?\.(ts|tsx|js|jsx|py|ya?ml|json)$/i.test(file.name)
  );
}

// Used to detect prompt-related source files (for detectedPromptRelatedFiles).
const promptLanguagePattern =
  /\b(?:system prompt|developer message|tool policy|role:|instructions|you are an ai|never obey)\b/i;

const approvalPolicyPattern =
  /\b(?:human approval|approval_required|approvalRequired|requiresApproval|requires_approval|requireApproval|confirm before|confirmationRequired|dry run|dry-run|dryRun|dry_run|approval gate|approvalGate|human_in_the_loop|humanInTheLoop)\b/i;

const writeToolTerms = [
  "sendemail",
  "delete",
  "update",
  "create",
  "post",
  "publish",
  "refund",
  "cancel",
  "remove",
  "disable",
  "overwrite",
  "archive",
  "trash",
  "invite",
  "revoke",
];

// -- Evidence snippets --

function buildSecretSnippets(file: RepoFile): EvidenceSnippet[] {
  if (!file.content) return [];
  const marker = "[REDACTED:";
  const index = file.content.indexOf(marker);
  if (index < 0) return [];

  const start = Math.max(0, index - 60);
  const end = Math.min(file.content.length, index + 120);
  const raw = file.content.slice(start, end).replace(/\n/g, " ").trim();
  const excerpt = raw.length > 240 ? `${raw.slice(0, 237)}...` : raw;

  return [{ path: file.path, excerpt, redacted: true }];
}

// -- Finding builder --

function finding(
  id: string,
  category: string,
  severity: Finding["severity"],
  title: string,
  summary: string,
  evidencePaths: string[],
  recommendation: string,
  confidence: number,
): Finding {
  return { id, category, severity, title, summary, evidencePaths, recommendation, confidence };
}

function hashId(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

