import yaml from "js-yaml";
import { classifyFile } from "./classifyFiles";
import { getExtension, getFileName, isEnvFileName, shouldIgnorePath } from "./ignoreRules";
import { redactSecrets } from "./redactSecrets";
import { scoreScan } from "./scoreScan";
import type {
  DetectedAgent,
  DetectedWorkflow,
  EvidenceSnippet,
  Finding,
  ProjectType,
  RepoFile,
  ScanReport,
} from "./types";

interface RawRepoFile {
  path: string;
  size: number;
  content?: string;
}

interface StaticScanOptions {
  githubTreeTruncated?: boolean;
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

  const detectedPrompts = scannedFiles
    .filter((file) => file.classification === "prompt")
    .map((file) => file.path);
  const detectedEvals = scannedFiles
    .filter((file) => file.classification === "eval" || file.classification === "test")
    .map((file) => file.path);
  const detectedWorkflowPaths = scannedFiles
    .filter((file) => file.classification === "workflow" || file.classification === "workflow_config")
    .map((file) => file.path);
  const detectedTools = detectTools(scannedFiles);
  const detectedAgents = detectAgents(scannedFiles, detectedPrompts, detectedTools, detectedEvals);
  const detectedWorkflowsDetailed = detectWorkflows(scannedFiles);

  const hasAgents = detectedAgents.length > 0;
  const hasWorkflows = detectedWorkflowsDetailed.length > 0;
  const projectType = deriveProjectType(hasAgents, hasWorkflows);

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

  // Only flag missing agent config when the project is not workflow-based.
  const hasAgentConfig = files.some((file) => /(^|\/)agents\.(ya?ml|json)$/i.test(file.path));
  const hasWorkflowConfig = files.some((file) => file.classification === "workflow_config");

  if (!hasAgentConfig && !hasWorkflows && !hasWorkflowConfig) {
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
  } else if (!hasAgentConfig && (hasWorkflows || hasWorkflowConfig) && !files.some((file) => file.classification === "workflow_config")) {
    // Workflow code exists but no manifest — suggest adding workflow.yaml.
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

  if (!files.some((file) => /(^|\/)(evals|evaluations)\//i.test(file.path))) {
    findings.push(finding(
      "missing-evals",
      "evalCoverage",
      "medium",
      "No evals directory detected",
      "The repository does not appear to include a dedicated eval suite.",
      [],
      "Add eval cases for core prompts, tools, and failure modes.",
      0.85,
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
        "Remove committed environment files and rotate any exposed credentials.",
        0.95,
      ));
    }

    if (file.redacted && file.secretMatchDetails && file.secretMatchDetails.length > 0) {
      // Derive severity and confidence from the highest-confidence match.
      const highestConfidence = file.secretMatchDetails.reduce((best, m) => {
        if (m.confidence === "high") return "high";
        if (best === "high") return "high";
        if (m.confidence === "medium") return "medium";
        return best;
      }, "low" as "low" | "medium" | "high");

      const severity = highestConfidence === "high" ? "high" : highestConfidence === "medium" ? "medium" : "low";
      // Confidence value influences scoring (1.0 = high, 0.75 = medium, 0.5 = low).
      const confidenceValue = highestConfidence === "high" ? 0.95 : highestConfidence === "medium" ? 0.75 : 0.5;

      const secretTypes = file.secretMatchDetails.map((m) => m.kind).join(", ");
      const snippets = buildSecretSnippets(file);

      findings.push({
        ...finding(
          `redacted-secret-${hashId(file.path)}`,
          "security",
          severity,
          "Secret-like value redacted",
          `${secretTypes} detected and redacted in ${file.path}.`,
          [file.path],
          "Remove the value from the repository and rotate it if it was real.",
          confidenceValue,
        ),
        evidenceSnippets: snippets,
      });
    } else if (file.redacted) {
      // Fallback for backward compat: no detail available.
      findings.push(finding(
        `redacted-secret-${hashId(file.path)}`,
        "security",
        "high",
        "Secret-like value redacted",
        `Secret-like value detected and redacted in ${file.path}.`,
        [file.path],
        "Remove the value from the repository and rotate it if it was real.",
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
    scannedAt: new Date().toISOString(),
    filesScanned: scannedFiles.length,
    ignoredFiles: files.length - scannedFiles.length,
    projectType,
    detectedAgents,
    detectedWorkflowsDetailed,
    detectedPrompts,
    detectedTools,
    detectedEvals,
    detectedWorkflows: detectedWorkflowPaths,
    findings,
    scores,
    recommendations: buildRecommendations(findings),
  };
}

// -- Project type --

function deriveProjectType(hasAgents: boolean, hasWorkflows: boolean): ProjectType {
  if (hasAgents && hasWorkflows) return "hybrid_workflow_agent";
  if (hasAgents) return "agent_system";
  if (hasWorkflows) return "workflow_system";
  return "unknown_ai_project";
}

// -- File preparation --

function toRepoFile(raw: RawRepoFile): RepoFile {
  const ignored = shouldIgnorePath(raw.path, raw.size);
  const initialContent = ignored.ignored ? undefined : raw.content;
  const classification = classifyFile(raw.path, initialContent);
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
    redacted: redaction.redacted,
    secretMatches: redaction.matches,
    secretMatchDetails: redaction.secretMatches,
    ignored: ignored.ignored,
    reason: ignored.reason,
  };
}

// -- Workflow detection --

function detectWorkflows(files: RepoFile[]): DetectedWorkflow[] {
  const configFiles = files.filter((f) => f.classification === "workflow_config");
  const workflows: DetectedWorkflow[] = [];

  for (const file of configFiles) {
    const parsed = parseStructuredConfig(file);
    if (!parsed) {
      // Config file present but unparseable — create a placeholder.
      workflows.push({
        id: slug(file.name.replace(/\.[^.]+$/, "")),
        name: file.name.replace(/\.[^.]+$/, ""),
        configPath: file.path,
        risks: ["Workflow manifest could not be parsed."],
      });
      continue;
    }

    const entries = workflowConfigEntries(parsed);
    for (const entry of entries) {
      workflows.push(workflowFromEntry(entry, file.path));
    }
  }

  // If no config files but workflows/ directory exists, infer a workflow.
  const hasWorkflowDir = files.some((f) => `/${f.path.toLowerCase()}`.includes("/workflows/") && !f.ignored);
  if (configFiles.length === 0 && hasWorkflowDir) {
    const workflowFiles = files.filter((f) => `/${f.path.toLowerCase()}`.includes("/workflows/") && !f.ignored);
    workflows.push({
      id: "inferred-workflow",
      name: "Inferred Workflow",
      type: "unknown",
      configPath: workflowFiles[0]?.path,
      risks: ["Workflow inferred from /workflows/ directory; no manifest found."],
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
  // Single workflow object at root.
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

  if (configs.length === 0 && promptPaths.length === 0) {
    return [];
  }

  if (configs.length === 0) {
    return [
      {
        id: "inferred-agent",
        name: "Inferred Agent",
        promptPaths,
        toolNames,
        evalPaths,
        risks: ["Agent inferred from prompts because no explicit agent config was found."],
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
  }));
}

function agentsFromConfig(
  file: RepoFile,
  configIndex: number,
  defaultPromptPaths: string[],
  defaultToolNames: string[],
  defaultEvalPaths: string[],
) {
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

    return {
      id: slug(id ?? name ?? `${file.name}-${entryIndex + 1}`),
      name: name ?? id ?? `Agent ${configIndex + 1}.${entryIndex + 1}`,
      promptPaths: promptPaths.length > 0 ? promptPaths : defaultPromptPaths,
      toolNames: toolNames.length > 0 ? toolNames : defaultToolNames,
      evalPaths: evalPaths.length > 0 ? evalPaths : defaultEvalPaths,
      configPath: file.path,
      risks:
        missing.length > 0
          ? [`Agent config is missing ${missing.join(", ")}.`]
          : [],
    };
  });
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
  // Content is already redacted; show a short window around the redaction marker.
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

  // Group secret rotation messages so they collapse into one.
  const secretRotationFindings = actionable.filter((f) =>
    f.recommendation.toLowerCase().includes("rotate"),
  );
  const otherFindings = actionable.filter(
    (f) => !f.recommendation.toLowerCase().includes("rotate"),
  );

  const deduped: string[] = [];

  // Collapse all "rotate" recommendations into one.
  if (secretRotationFindings.length === 1) {
    deduped.push(secretRotationFindings[0].recommendation);
  } else if (secretRotationFindings.length > 1) {
    deduped.push(
      `Review and rotate any confirmed secret-like values flagged in ${secretRotationFindings.length} files.`,
    );
  }

  // De-duplicate the rest by exact text, preserving order.
  const seen = new Set<string>(deduped);
  for (const f of otherFindings) {
    if (!seen.has(f.recommendation)) {
      seen.add(f.recommendation);
      deduped.push(f.recommendation);
    }
  }

  return deduped.slice(0, 6);
}
