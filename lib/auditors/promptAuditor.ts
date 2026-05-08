import { readFileSync } from "node:fs";
import { join } from "node:path";
import { featureFlags, getLLMAuditorStatus } from "@/lib/config/featureFlags";
import { generateLLM } from "@/lib/llm/client";
import type { Finding } from "@/lib/scanner/types";
import { formatPromptEvidencePacket, selectPromptEvidence } from "./promptEvidence";
import { promptAuditorResultSchema } from "./schemas";
import type { Auditor } from "./types";

export const promptAuditor: Auditor = async (context) => {
  const llmEnabled = Boolean(context.allowLlmAuditors ?? true) && featureFlags.llmAuditorsEnabled;

  if (!llmEnabled) {
    return placeholderPromptAudit(context.report.detectedPrompts.length);
  }

  const status = getLLMAuditorStatus();
  const baseStatus = {
    llmAuditorsEnabled: true,
    promptAuditorRan: false,
    provider: status.provider ?? undefined,
  };

  if (!status.providerConfigured) {
    return {
      auditor: "prompt",
      findings: [
        finding(
          "llm-prompt-auditor-not-configured",
          "promptQuality",
          "info",
          "LLM Prompt Auditor not configured",
          "ENABLE_LLM_AUDITORS is true, but the selected provider API key is not configured.",
          [],
          "Set the server-side provider API key or disable ENABLE_LLM_AUDITORS until it is ready.",
          0.95,
        ),
      ],
      auditorStatus: {
        ...baseStatus,
        error: "Provider API key is not configured.",
      },
    };
  }

  const evidence = selectPromptEvidence(context.files, context.report);

  if (evidence.length === 0) {
    return {
      auditor: "prompt",
      findings: [
        finding(
          "llm-prompt-auditor-no-evidence",
          "promptQuality",
          "low",
          "No prompt evidence available for LLM audit",
          "The Prompt Auditor was enabled, but no eligible redacted prompt evidence was selected.",
          [],
          "Store important agent prompts in versioned prompt files so the Prompt Auditor can review them.",
          0.85,
        ),
      ],
      auditorStatus: baseStatus,
    };
  }

  const llm = context.generateLLM ?? generateLLM;
  const result = await llm({
    messages: [
      {
        role: "system",
        content: promptAuditorInstructions(),
      },
      {
        role: "user",
        content: [
          `Repository: ${context.report.repoName}`,
          "Analyze only this redacted prompt evidence packet:",
          formatPromptEvidencePacket(evidence),
        ].join("\n\n"),
      },
    ],
    temperature: 0.1,
    maxTokens: 1400,
  });

  if (!result.ok) {
    return {
      auditor: "prompt",
      findings: [
        finding(
          "llm-prompt-auditor-call-failed",
          "promptQuality",
          result.disabled ? "info" : "medium",
          result.disabled ? "Prompt Auditor did not run" : "Prompt Auditor LLM call failed",
          result.error,
          evidence.map((item) => item.path),
          "Keep relying on static scan findings and rerun the Prompt Auditor after provider configuration or service issues are resolved.",
          0.9,
        ),
      ],
      auditorStatus: {
        ...baseStatus,
        provider: result.provider ?? status.provider ?? undefined,
        model: result.model,
        error: result.error,
      },
    };
  }

  const parsedJson = parseJsonObject(result.result.text);
  const parsed = parsedJson ? promptAuditorResultSchema.safeParse(parsedJson) : undefined;

  if (!parsed?.success) {
    return {
      auditor: "prompt",
      findings: [
        finding(
          "llm-prompt-auditor-invalid-json",
          "promptQuality",
          "medium",
          "Prompt Auditor returned invalid structured output",
          "The LLM response could not be parsed as the required Prompt Auditor JSON schema.",
          evidence.map((item) => item.path),
          "Retry the audit. If this repeats, tighten the Prompt Auditor prompt or model response format.",
          0.9,
        ),
      ],
      auditorStatus: {
        ...baseStatus,
        provider: result.result.provider,
        model: result.result.model,
        error: "Invalid structured output.",
      },
    };
  }

  return {
    auditor: "prompt",
    findings: parsed.data.findings.map((item, index) =>
      finding(
        `llm-prompt-${hashId(`${item.title}-${index}`)}`,
        "promptQuality",
        item.severity,
        item.title,
        item.summary,
        item.evidencePaths,
        item.recommendation,
        item.confidence,
      ),
    ),
    promptQualityScore: parsed.data.score,
    auditorStatus: {
      llmAuditorsEnabled: true,
      promptAuditorRan: true,
      provider: result.result.provider,
      model: parsed.data.modelUsed ?? result.result.model,
    },
  };
};

function placeholderPromptAudit(detectedPromptCount: number) {
  return {
    auditor: "prompt",
    findings:
      detectedPromptCount === 0
        ? [
            finding(
              "auditor-no-prompts",
              "promptQuality",
              "low",
              "No prompt files detected",
              "The placeholder prompt auditor did not find prompt files to review.",
              [],
              "Store important prompts in versioned files so they can be audited and evaluated.",
              0.7,
            ),
          ]
        : [],
    auditorStatus: {
      llmAuditorsEnabled: false,
      promptAuditorRan: false,
    },
  };
}

function promptAuditorInstructions() {
  return readFileSync(join(process.cwd(), "prompts", "prompt-auditor.md"), "utf8");
}

function parseJsonObject(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
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
