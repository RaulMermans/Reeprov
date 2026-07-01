import type { RunGraphAttachment, RunGraphNode } from "@/lib/runs/runGraph";
import type {
  VisualArtifactType,
  VisualEvalSubtype,
  VisualModelProvider,
  VisualNode,
  VisualNodeIdentity,
  VisualNodeMetrics,
  VisualToolSubtype,
} from "@/lib/visualGraph/types";

type MetadataSource = Record<string, unknown> | undefined;

function stringValue(metadata: MetadataSource, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function numberValue(metadata: MetadataSource, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function booleanValue(metadata: MetadataSource, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function lowerTokens(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ").toLowerCase();
}

const MODEL_PROVIDER_PATTERNS: Array<{ provider: VisualModelProvider; match: RegExp; label: string }> = [
  { provider: "openai", match: /\b(openai|gpt-|gpt_|o1|o3|o4)\b/, label: "OpenAI" },
  { provider: "anthropic", match: /\b(anthropic|claude)\b/, label: "Anthropic" },
  { provider: "google", match: /\b(google|gemini|palm|vertex)\b/, label: "Google" },
  { provider: "meta", match: /\b(meta|llama)\b/, label: "Meta" },
  { provider: "mistral", match: /\b(mistral|mixtral)\b/, label: "Mistral" },
  { provider: "local", match: /\b(local|ollama|vllm|llamacpp|llama\.cpp)\b/, label: "local" },
  { provider: "mock", match: /\b(mock|fixture|stub|fake)\b/, label: "mock" },
];

export function resolveModelProvider(metadata: MetadataSource, label?: string): {
  provider: VisualModelProvider;
  label: string;
} {
  const explicit = stringValue(metadata, ["model_provider", "provider", "vendor"]);
  const modelName = stringValue(metadata, ["model_name", "model", "deployment", "engine"]);
  const haystack = lowerTokens(explicit, modelName, label);
  for (const entry of MODEL_PROVIDER_PATTERNS) {
    if (entry.match.test(haystack)) return { provider: entry.provider, label: entry.label };
  }
  return { provider: "unknown", label: "unknown" };
}

const TOOL_SUBTYPE_PATTERNS: Array<{ subtype: VisualToolSubtype; match: RegExp; label: string }> = [
  { subtype: "web_search", match: /\b(web[_ -]?search|search|serp)\b/, label: "web search" },
  { subtype: "webpage_extract", match: /(^|[_\W])(webpage|extract|readability|page[_ -]?content)([_\W]|$)/, label: "webpage extract" },
  { subtype: "browser", match: /\b(browser|playwright|chrome|chromium|safari|firefox)\b/, label: "browser" },
  { subtype: "filesystem", match: /\b(filesystem|file[_ -]?system|read[_ -]?file|write[_ -]?file|path|fs)\b/, label: "filesystem" },
  { subtype: "database", match: /\b(database|postgres|mysql|sqlite|sql|snowflake|warehouse|query)\b/, label: "database" },
  { subtype: "github", match: /\b(github|octokit|repo|pull[_ -]?request|issue)\b/, label: "GitHub" },
  { subtype: "http_api", match: /\b(http|api|fetch|request|rest|graphql|webhook)\b/, label: "HTTP/API" },
  { subtype: "scraper", match: /\b(scrape|scraper|crawl|crawler|spider)\b/, label: "scraper" },
  { subtype: "validator", match: /\b(validate|validator|schema|lint|typecheck|check)\b/, label: "validator" },
];

export function resolveToolSubtype(name?: string, metadata?: MetadataSource): {
  subtype: VisualToolSubtype;
  label: string;
} {
  const explicit = stringValue(metadata, ["tool_subtype", "subtype", "category"]);
  const haystack = lowerTokens(explicit, name, stringValue(metadata, ["tool_name", "name"])).replace(/[_-]+/g, " ");
  for (const entry of TOOL_SUBTYPE_PATTERNS) {
    if (entry.match.test(haystack)) return { subtype: entry.subtype, label: entry.label };
  }
  return { subtype: "unknown_tool", label: "unknown tool" };
}

const EVAL_SUBTYPE_PATTERNS: Array<{ subtype: VisualEvalSubtype; match: RegExp; label: string }> = [
  { subtype: "quality", match: /\b(quality|output_quality|rubric|score)\b/, label: "quality" },
  { subtype: "factuality", match: /\b(factual|fact|truth|correctness)\b/, label: "factuality" },
  { subtype: "publishability", match: /\b(publish|publishability|editorial|readiness)\b/, label: "publishability" },
  { subtype: "contract", match: /\b(contract|schema|trace_contract|assertion|validity)\b/, label: "contract" },
  { subtype: "safety", match: /\b(safety|policy|harm|pii|security)\b/, label: "safety" },
  { subtype: "source_evidence", match: /\b(source|evidence|grounding|citation)\b/, label: "source/evidence" },
];

export function resolveEvalSubtype(name?: string, metadata?: MetadataSource): {
  subtype: VisualEvalSubtype;
  label: string;
} {
  const explicit = stringValue(metadata, ["eval_type", "type", "subtype", "category"]);
  const haystack = lowerTokens(explicit, name, stringValue(metadata, ["eval_name", "name"]));
  for (const entry of EVAL_SUBTYPE_PATTERNS) {
    if (entry.match.test(haystack)) return { subtype: entry.subtype, label: entry.label };
  }
  return { subtype: "unknown_eval", label: "unknown eval" };
}

const ARTIFACT_TYPE_PATTERNS: Array<{ type: VisualArtifactType; match: RegExp; label: string }> = [
  { type: "markdown", match: /\b(markdown|md|mdx)\b|\.mdx?$/i, label: "markdown" },
  { type: "json", match: /\b(json|json_report)\b|\.json$/i, label: "json" },
  { type: "report", match: /\b(report|summary|brief)\b/, label: "report" },
  { type: "image", match: /\b(image|png|jpg|jpeg|gif|webp|svg)\b|\.(png|jpe?g|gif|webp|svg)$/i, label: "image" },
  { type: "dataset", match: /\b(dataset|csv|parquet|table|rows)\b|\.(csv|parquet)$/i, label: "dataset" },
  { type: "file", match: /\b(file|artifact)\b|\.[a-z0-9]{1,8}$/i, label: "file" },
];

export function resolveArtifactType(name?: string, metadata?: MetadataSource): {
  type: VisualArtifactType;
  label: string;
} {
  const explicit = stringValue(metadata, ["artifact_type", "type", "mime_type", "content_type"]);
  const haystack = lowerTokens(explicit, name, stringValue(metadata, ["artifact_ref", "title", "name"]));
  for (const entry of ARTIFACT_TYPE_PATTERNS) {
    if (entry.match.test(haystack)) return { type: entry.type, label: entry.label };
  }
  return { type: "unknown_artifact", label: "unknown artifact" };
}

function commandSummary(command?: string): string | undefined {
  if (!command) return undefined;
  const normalized = command.replace(/\s+/g, " ").trim();
  if (normalized.length <= 48) return normalized;
  return `${normalized.slice(0, 45)}...`;
}

export function resolvePrimaryIdentity(node: RunGraphNode): VisualNodeIdentity {
  const typeLabel = node.type === "agent" ? "Agent" : "Stage";
  return {
    title: node.label,
    typeLabel,
    badge: node.type === "agent" ? "Agent" : "Stage",
  };
}

export function resolveEvidenceIdentity(attachment: RunGraphAttachment, visualType: VisualNode["type"]): VisualNodeIdentity {
  const metadata = attachment.metadata;
  if (visualType === "model") {
    const provider = resolveModelProvider(metadata, attachment.label);
    const modelName = stringValue(metadata, ["model_name", "model", "deployment", "engine"]) ?? attachment.label;
    return {
      title: modelName || "Model call",
      typeLabel: "Model",
      badge: provider.label,
      provider: provider.provider,
      providerLabel: provider.label,
      modelName,
    };
  }
  if (visualType === "tool") {
    const toolName = stringValue(metadata, ["tool_name", "name"]) ?? attachment.label;
    const subtype = resolveToolSubtype(toolName, metadata);
    return {
      title: toolName || "Tool call",
      typeLabel: "Tool",
      badge: subtype.label,
      toolName,
      toolSubtype: subtype.subtype,
    };
  }
  if (visualType === "skill") {
    const skillName = stringValue(metadata, ["skill_name", "skill", "name"]) ?? attachment.label;
    const skillSubtype = stringValue(metadata, ["skill_subtype", "subtype", "category"]);
    return {
      title: skillName || "Skill",
      typeLabel: "Skill",
      badge: skillSubtype ?? "skill",
      skillName,
      skillSubtype,
    };
  }
  if (visualType === "cli") {
    const command = stringValue(metadata, ["cli_command", "command"]) ?? attachment.label;
    return {
      title: commandSummary(command) ?? "CLI command",
      typeLabel: "CLI",
      badge: "CLI",
      commandSummary: commandSummary(command),
    };
  }
  if (visualType === "eval") {
    const evalName = stringValue(metadata, ["eval_name", "name"]) ?? attachment.label;
    const subtype = resolveEvalSubtype(evalName, metadata);
    return {
      title: evalName || "Eval",
      typeLabel: "Eval",
      badge: subtype.label,
      evalName,
      evalSubtype: subtype.subtype,
    };
  }
  if (visualType === "artifact") {
    const artifactName = stringValue(metadata, ["artifact_ref", "title", "name"]) ?? attachment.label;
    const artifactType = resolveArtifactType(artifactName, metadata);
    return {
      title: artifactName || "Artifact",
      typeLabel: "Artifact",
      badge: artifactType.label,
      artifactName,
      artifactType: artifactType.type,
    };
  }
  if (visualType === "recovery") {
    return {
      title: attachment.label || "Recovery",
      typeLabel: "Recovery",
      badge: "recovered",
    };
  }
  if (visualType === "issue") {
    return {
      title: attachment.label || "Issue",
      typeLabel: "Issue",
      badge: attachment.status === "critical" || attachment.status === "fail" ? "error" : "warning",
    };
  }
  return {
    title: attachment.label,
    typeLabel: "Evidence",
  };
}

export function resolveEvidenceMetrics(
  attachment: RunGraphAttachment,
  parentId: string,
): VisualNodeMetrics {
  const metadata = attachment.metadata;
  const inputTokens = numberValue(metadata, ["input_tokens", "prompt_tokens"]);
  const outputTokens = numberValue(metadata, ["output_tokens", "completion_tokens"]);
  const explicitTotal = numberValue(metadata, ["total_tokens", "tokens"]);
  const score = numberValue(metadata, ["score", "eval_score"]);
  return {
    inputTokens,
    outputTokens,
    totalTokens: explicitTotal ?? (
      typeof inputTokens === "number" || typeof outputTokens === "number"
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : undefined
    ),
    latencyMs: numberValue(metadata, ["latency_ms", "duration_ms"]) ?? attachment.durationMs,
    costUsd: attachment.costUsd ?? numberValue(metadata, ["cost_usd", "cost"]),
    retryCount: numberValue(metadata, ["retry_count", "retries"]),
    errorCount: attachment.error ? 1 : numberValue(metadata, ["error_count", "errors"]),
    score,
    passed: booleanValue(metadata, ["passed"]),
    threshold: numberValue(metadata, ["threshold", "pass_threshold"]),
    sizeBytes: numberValue(metadata, ["size_bytes", "bytes", "content_bytes"]),
    contentStatus: stringValue(metadata, ["content_status", "status"]),
    reason: stringValue(metadata, ["reason", "message", "recommendation"]) ?? attachment.detail,
    producingStageId: parentId,
  };
}

export function metadataString(metadata: MetadataSource, keys: string[]): string | undefined {
  return stringValue(metadata, keys);
}

export function metadataNumber(metadata: MetadataSource, keys: string[]): number | undefined {
  return numberValue(metadata, keys);
}
