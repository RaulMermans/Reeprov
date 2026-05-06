import yaml from "js-yaml";
import { classifyFile } from "./classifyFiles";
import { getExtension, getFileName, shouldIgnorePath } from "./ignoreRules";
import { redactSecrets } from "./redactSecrets";
import { scoreScan } from "./scoreScan";
import type { DetectedAgent, Finding, RepoFile, ScanReport } from "./types";

interface RawRepoFile {
  path: string;
  size: number;
  content?: string;
}

export function staticScan(repoName: string, rawFiles: RawRepoFile[]): ScanReport {
  const files = rawFiles.map(toRepoFile);
  const scannedFiles = files.filter((file) => !file.ignored);
  const findings: Finding[] = [];

  const detectedPrompts = scannedFiles
    .filter((file) => file.classification === "prompt")
    .map((file) => file.path);
  const detectedEvals = scannedFiles
    .filter((file) => file.classification === "eval" || file.classification === "test")
    .map((file) => file.path);
  const detectedWorkflows = scannedFiles
    .filter((file) => file.classification === "workflow")
    .map((file) => file.path);
  const detectedTools = detectTools(scannedFiles);
  const detectedAgents = detectAgents(scannedFiles, detectedPrompts, detectedTools, detectedEvals);

  if (!files.some((file) => file.path.toLowerCase().endsWith("agents.md"))) {
    findings.push(finding("missing-agents-md", "documentation", "medium", "Missing AGENTS.md", "No AGENTS.md file was found to explain agent behavior and constraints.", [], "Add AGENTS.md with architecture, tool policy, memory policy, and safety constraints.", 0.9));
  }

  if (!files.some((file) => /(^|\/)agents\.(ya?ml|json)$/i.test(file.path))) {
    findings.push(finding("missing-agent-config", "architecture", "low", "Missing structured agent config", "No agents.yaml, agents.yml, or agents.json file was found.", [], "Add a structured agent inventory so scanners and reviewers can reason about agent boundaries.", 0.75));
  }

  if (!files.some((file) => /(^|\/)(evals|evaluations)\//i.test(file.path))) {
    findings.push(finding("missing-evals", "evalCoverage", "medium", "No evals directory detected", "The repository does not appear to include a dedicated eval suite.", [], "Add eval cases for core prompts, tools, and failure modes.", 0.85));
  }

  for (const file of files) {
    if (file.ignored && /^\.env(\.|$)|(^|\/)\.env(\.|$)/i.test(file.path)) {
      findings.push(finding(`ignored-env-${hashId(file.path)}`, "security", "high", "Sensitive environment file present", `${file.path} was ignored and should not be committed to source control.`, [file.path], "Remove committed environment files and rotate any exposed credentials.", 0.95));
    }
    if (file.redacted) {
      findings.push(finding(`redacted-secret-${hashId(file.path)}`, "security", "high", "Secret-like value redacted", `Secret-like content was detected and redacted in ${file.path}.`, [file.path], "Remove the value from the repository and rotate it if it was real.", 0.85));
    }
  }

  const writeToolPaths = scannedFiles.filter((file) => {
    const text = `${file.path}\n${file.content ?? ""}`;
    return /\b(send_email|delete|update|create|post|publish)\b/i.test(text);
  });

  const hasApprovalPolicy = scannedFiles.some((file) =>
    /\b(approval policy|human approval|requires approval|confirm before|dry-run|dry run)\b/i.test(
      file.content ?? "",
    ),
  );

  if (writeToolPaths.length > 0 && !hasApprovalPolicy) {
    findings.push(finding("write-tools-without-approval", "toolGovernance", "high", "Possible write tools without approval policy", "The scanner found write-like tool names but did not find an approval or dry-run policy.", writeToolPaths.map((file) => file.path), "Document and enforce approval gates for tools that create, update, publish, post, email, or delete.", 0.7));
  }

  const reportFindings = findings;
  const scores = scoreScan(reportFindings);

  return {
    repoName,
    scannedAt: new Date().toISOString(),
    filesScanned: scannedFiles.length,
    ignoredFiles: files.length - scannedFiles.length,
    detectedAgents,
    detectedPrompts,
    detectedTools,
    detectedEvals,
    detectedWorkflows,
    findings: reportFindings,
    scores,
    recommendations: recommendations(reportFindings),
  };
}

function toRepoFile(raw: RawRepoFile): RepoFile {
  const ignored = shouldIgnorePath(raw.path, raw.size);
  const initialContent = ignored.ignored ? undefined : raw.content;
  const classification = classifyFile(raw.path, initialContent);
  const redaction = ignored.ignored ? { content: "", redacted: false } : redactSecrets(initialContent);

  return {
    path: raw.path,
    name: getFileName(raw.path),
    extension: getExtension(raw.path),
    size: raw.size,
    content: ignored.ignored ? undefined : redaction.content,
    classification,
    redacted: redaction.redacted,
    ignored: ignored.ignored,
    reason: ignored.reason,
  };
}

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

  return configs.map((file, index) => ({
    id: `agent-${index + 1}`,
    name: agentNameFromConfig(file) ?? file.name.replace(/\.[^.]+$/, ""),
    promptPaths,
    toolNames,
    evalPaths,
    configPath: file.path,
    risks: [],
  }));
}

function agentNameFromConfig(file: RepoFile) {
  if (!file.content) return undefined;

  try {
    const parsed = /\.(ya?ml)$/i.test(file.path)
      ? yaml.load(file.content)
      : JSON.parse(file.content);

    if (isRecord(parsed) && typeof parsed.name === "string") {
      return parsed.name;
    }

    if (
      isRecord(parsed) &&
      Array.isArray(parsed.agents) &&
      isRecord(parsed.agents[0]) &&
      typeof parsed.agents[0].name === "string"
    ) {
      return parsed.agents[0].name;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function detectTools(files: RepoFile[]) {
  const toolNames = new Set<string>();

  for (const file of files) {
    if (file.classification === "tool") {
      toolNames.add(file.path);
    }

    const matches = file.content?.matchAll(/\b(?:tool|function_tool|toolName|name)\s*[:=]\s*["'`]([a-zA-Z0-9_-]+)["'`]/g);
    for (const match of matches ?? []) {
      toolNames.add(match[1]);
    }
  }

  return [...toolNames];
}

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

function recommendations(findings: Finding[]) {
  return findings
    .filter((findingItem) => findingItem.severity !== "info")
    .slice(0, 5)
    .map((findingItem) => findingItem.recommendation);
}
