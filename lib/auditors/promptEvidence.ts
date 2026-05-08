import { isEnvFileName } from "@/lib/scanner/ignoreRules";
import type { FileClassification, RepoFile, ScanReport } from "@/lib/scanner/types";

export const PROMPT_EVIDENCE_LIMITS = {
  maxPromptFiles: 10,
  maxCharsPerFile: 4_000,
  maxTotalChars: 20_000,
};

export interface PromptEvidenceItem {
  path: string;
  classification: Extract<FileClassification, "prompt" | "agent_config">;
  content: string;
}

export function selectPromptEvidence(
  files: RepoFile[],
  report: Pick<ScanReport, "detectedPrompts">,
): PromptEvidenceItem[] {
  const promptPaths = new Set(report.detectedPrompts);
  const promptFiles = files
    .filter((file) => isEvidenceCandidate(file))
    .filter((file) => file.classification === "prompt")
    .slice(0, PROMPT_EVIDENCE_LIMITS.maxPromptFiles);

  const agentConfigs = files
    .filter((file) => isEvidenceCandidate(file))
    .filter((file) => file.classification === "agent_config")
    .filter((file) => referencesPrompt(file, promptPaths));

  const selected = [...promptFiles, ...agentConfigs];
  const evidence: PromptEvidenceItem[] = [];
  let totalChars = 0;

  for (const file of selected) {
    const remaining = PROMPT_EVIDENCE_LIMITS.maxTotalChars - totalChars;
    if (remaining <= 0) break;

    const content = (file.content ?? "").slice(
      0,
      Math.min(PROMPT_EVIDENCE_LIMITS.maxCharsPerFile, remaining),
    );

    if (!content) continue;

    evidence.push({
      path: file.path,
      classification: file.classification as PromptEvidenceItem["classification"],
      content,
    });
    totalChars += content.length;
  }

  return evidence;
}

export function formatPromptEvidencePacket(evidence: PromptEvidenceItem[]) {
  return evidence
    .map((item) => [
      `Path: ${item.path}`,
      `Classification: ${item.classification}`,
      "Redacted content snippet:",
      item.content,
    ].join("\n"))
    .join("\n\n---\n\n");
}

function isEvidenceCandidate(file: RepoFile) {
  if (file.ignored) return false;
  if (!file.content) return false;
  if (file.classification === "environment") return false;
  if (isEnvFileName(file.name)) return false;
  if (/^package-lock\.json$/i.test(file.name)) return false;

  return file.classification === "prompt" || file.classification === "agent_config";
}

function referencesPrompt(file: RepoFile, promptPaths: Set<string>) {
  const content = file.content ?? "";

  if (/\bprompts?\b|\bprompt_path\b|\bpromptPath\b/i.test(content)) {
    return true;
  }

  for (const promptPath of promptPaths) {
    const promptName = promptPath.split("/").pop() ?? promptPath;
    if (content.includes(promptPath) || content.includes(promptName)) {
      return true;
    }
  }

  return false;
}
