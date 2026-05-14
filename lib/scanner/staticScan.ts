import yaml from "js-yaml";
import { classifyFile } from "./classifyFiles";
import { deriveFileContext } from "./fileContext";
import { getExtension, getFileName, isEnvFileName, shouldIgnorePath } from "./ignoreRules";
import { redactSecrets } from "./redactSecrets";
import { scoreScan } from "./scoreScan";
import {
  hasDbCredentials,
  isLocalDbUrl,
  looksLikePlaceholder,
} from "./secretPatterns";
import type {
  DetectedAgent,
  DetectedCIWorkflow,
  DetectedWorkflow,
  EvidenceSnippet,
  FileContext,
  Finding,
  ProjectType,
  RepoFile,
  ScanReport,
  ScanSource,
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

  const detectedPrompts = scannedFiles
    .filter((file) => file.classification === "prompt")
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

  const detectedTools = detectTools(scannedFiles);
  const detectedAgents = detectAgents(scannedFiles, detectedPrompts, detectedTools, detectedEvals);
  const detectedWorkflowsDetailed = detectWorkflows(scannedFiles);
  const detectedCIWorkflows = detectCIWorkflows(scannedFiles);

  // CI workflows alone do not make a project a workflow_system.
  const hasAgents = detectedAgents.length > 0;
  const hasProductWorkflows = detectedWorkflowsDetailed.length > 0;
  const projectType = deriveProjectType(hasAgents, hasProductWorkflows);

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
    findings.push(finding(
      "missing-agent-config",
      "architecture",
      "low",
      "Missing structured agent config",
      "No agents.yaml, agents.yml, agents.json, or workflow manifest was found.",
      [],
      "Add an agents.yaml or workflow.yaml inventory so scanners and reviewers can reason about agent or workflow boundaries.",
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

  const scores = scoreScan(findings);

  return {
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
    detectedPrompts,
    detectedTools,
    detectedEvals,
    detectedTests,
    detectedWorkflows: detectedWorkflowPaths,
    findings,
    scores,
    recommendations: buildRecommendations(findings),
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
      "Placeholder/stub value detected; no rotation required unless this represents a real credential.";
  } else if (isCredentialFreeOrLocalDb) {
    severity = "info";
    confidenceValue = 0.25;
    recommendation =
      "Non-credentialed or local database URL detected. If it contains real credentials, move them to environment variables.";
  } else if (context === "documentation" || context === "example") {
    // Docs and examples with apparent secret values — likely illustrative.
    severity = highestConfidence === "high" ? "medium" : "low";
    confidenceValue = highestConfidence === "high" ? 0.6 : 0.45;
    recommendation =
      "Review this documentation/example value. If it is real, move it to environment variables and rotate it.";
  } else if (context === "test" || context === "migration") {
    // Test files may use realistic-looking values but are not production risk.
    severity = highestConfidence === "high" ? "medium" : "low";
    confidenceValue = highestConfidence === "high" ? 0.6 : 0.45;
    recommendation =
      "Review this test value. If it is real, move it to environment variables and rotate it.";
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

function deriveProjectType(hasAgents: boolean, hasProductWorkflows: boolean): ProjectType {
  if (hasAgents && hasProductWorkflows) return "hybrid_workflow_agent";
  if (hasAgents) return "agent_system";
  if (hasProductWorkflows) return "workflow_system";
  return "unknown_ai_project";
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
  const stages = valueStrings(record.stages);
  const tools = valueStrings(record.tools);
  const evals = valueStrings(record.evals);

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

function detectAgents(
  files: RepoFile[],
  promptPaths: string[],
  toolNames: string[],
  evalPaths: string[],
): DetectedAgent[] {
  const configs = files.filter((file) => file.classification === "agent_config");

  // If no agent configs and no prompts, no agents detected.
  if (configs.length === 0 && promptPaths.length === 0) {
    return [];
  }

  // Inferred agent from prompts only — low confidence, no attribute mapping.
  if (configs.length === 0 && promptPaths.length > 0) {
    return [
      {
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
        evidenceReason: `Inferred from ${promptPaths.length} prompt file(s); no agents.yaml found`,
      },
    ];
  }

  const detected = configs.flatMap((file, configIndex) =>
    agentsFromConfig(file, configIndex, promptPaths, toolNames, evalPaths),
  );

  return detected.length > 0 ? detected : configs.map((file, index) => ({
    id: `agent-${index + 1}`,
    name: file.name.replace(/\.[^.]+$/, ""),
    promptPaths,
    toolNames,
    evalPaths,
    configPath: file.path,
    risks: ["Agent config could not be parsed, so scanner used repository-level evidence."],
    source: "explicit" as const,
    confidence: "medium" as const,
    evidenceReason: `Found ${file.path} but could not parse it`,
  }));
}

function agentsFromConfig(
  file: RepoFile,
  configIndex: number,
  defaultPromptPaths: string[],
  defaultToolNames: string[],
  defaultEvalPaths: string[],
): DetectedAgent[] {
  const parsed = parseStructuredConfig(file);
  if (!parsed) return [];

  const entries = agentConfigEntries(parsed);

  return entries.map((entry, entryIndex) => {
    const record = isRecord(entry) ? entry : {};
    const id = firstString(record.id);
    const name = firstString(record.name);
    const promptPaths = collectFieldStrings(record, ["prompt_path", "promptPath", "prompt"]);
    const toolNames = collectFieldStrings(record, ["tools"]);
    const evalPaths = collectFieldStrings(record, ["evals"]);
    const missing = [
      id ? undefined : "id",
      name ? undefined : "name",
      promptPaths.length > 0 ? undefined : "prompt_path",
      toolNames.length > 0 ? undefined : "tools",
      evalPaths.length > 0 ? undefined : "evals",
    ].filter(Boolean);

    // For explicit agents: only use manifest-mapped paths, not repo-level fallbacks.
    // If the manifest doesn't map prompts/tools/evals, show empty (not mapped).
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
    };
  });
}

// Agent configs in /agents/ directory with non-source files → inferred/medium.
function _detectAgentsFromAgentsDir(
  files: RepoFile[],
): DetectedAgent[] {
  return files
    .filter(
      (f) =>
        `/${f.path.toLowerCase()}`.includes("/agents/") &&
        f.classification === "agent_config" &&
        !f.ignored,
    )
    .map((f, index) => ({
      id: slug(f.name.replace(/\.[^.]+$/, "") || `agent-${index + 1}`),
      name: f.name.replace(/\.[^.]+$/, "") || `Agent ${index + 1}`,
      promptPaths: [],
      toolNames: [],
      evalPaths: [],
      configPath: f.path,
      risks: ["Agent inferred from /agents/ directory file; no top-level agents.yaml config found."],
      source: "inferred" as const,
      confidence: "medium" as const,
      evidenceReason: `Found agent file at ${f.path}`,
    }));
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

// -- Recommendation de-duplication --

function buildRecommendations(findings: Finding[]): string[] {
  const actionable = findings.filter((f) => f.severity !== "info");

  const secretRotationFindings = actionable.filter((f) =>
    f.recommendation.toLowerCase().includes("rotate"),
  );
  const otherFindings = actionable.filter(
    (f) => !f.recommendation.toLowerCase().includes("rotate"),
  );

  const deduped: string[] = [];

  if (secretRotationFindings.length === 1) {
    deduped.push(secretRotationFindings[0].recommendation);
  } else if (secretRotationFindings.length > 1) {
    deduped.push(
      `Review and rotate any confirmed secret-like values flagged in ${secretRotationFindings.length} files.`,
    );
  }

  const seen = new Set<string>(deduped);
  for (const f of otherFindings) {
    if (!seen.has(f.recommendation)) {
      seen.add(f.recommendation);
      deduped.push(f.recommendation);
    }
  }

  return deduped.slice(0, 6);
}
