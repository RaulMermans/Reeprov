import type {
  DetectedAgent,
  DetectedModelConfig,
  DetectedModelPerformance,
  DetectedWorkflow,
  RepoFile,
} from "./types";

// Provider env var → provider name mapping.
const PROVIDER_ENV_VARS: Array<{ env: string; provider: string }> = [
  { env: "OPENAI_API_KEY", provider: "openai" },
  { env: "OPENAI_BASE_URL", provider: "openai" },
  { env: "ANTHROPIC_API_KEY", provider: "anthropic" },
  { env: "GOOGLE_API_KEY", provider: "google" },
  { env: "GEMINI_API_KEY", provider: "google" },
  { env: "GROQ_API_KEY", provider: "groq" },
  { env: "MISTRAL_API_KEY", provider: "mistral" },
  { env: "COHERE_API_KEY", provider: "cohere" },
  { env: "TOGETHER_API_KEY", provider: "together" },
  { env: "DEEPSEEK_API_KEY", provider: "deepseek" },
];

// Model name patterns → provider name.
const MODEL_PROVIDER_MAP: Array<{ pattern: RegExp; provider: string }> = [
  { pattern: /\bgpt-?4(?:\.1|o-mini|o|\.0)?\b/i, provider: "openai" },
  { pattern: /\bgpt-3(?:\.5)?(?:-turbo)?\b/i, provider: "openai" },
  { pattern: /\bo3(?:-mini)?\b/i, provider: "openai" },
  { pattern: /\bo4-mini\b/i, provider: "openai" },
  { pattern: /\bclaude-3(?:-(?:5|7|opus|sonnet|haiku))?(?:-[a-z0-9-]+)?\b/i, provider: "anthropic" },
  { pattern: /\bclaude-(?:opus|sonnet|haiku)-[0-9.]+\b/i, provider: "anthropic" },
  { pattern: /\bgemini-(?:1\.5|2\.0|2\.5)-(?:flash|pro)(?:-[a-z0-9-]+)?\b/i, provider: "google" },
  { pattern: /\bllama-?[0-9]+(?:[bx][0-9]+)?\b/i, provider: "meta" },
  { pattern: /\bmixtral-?[0-9a-zx]+\b/i, provider: "mistral" },
  { pattern: /\bmistral-(?:large|medium|small|tiny)\b/i, provider: "mistral" },
  { pattern: /\bdeepseek-[a-z0-9-]+\b/i, provider: "deepseek" },
];

// Import patterns → provider name.
const PROVIDER_IMPORT_MAP: Array<{ pattern: RegExp; provider: string }> = [
  { pattern: /\b(?:from\s+["']openai["']|import\s+OpenAI|require\(\s*["']openai["']\s*\))/i, provider: "openai" },
  { pattern: /\b(?:from\s+["']@anthropic-ai\/sdk["']|import\s+Anthropic|require\(\s*["']@anthropic-ai\/sdk["']\s*\))/i, provider: "anthropic" },
  { pattern: /\b(?:from\s+["']@google\/(?:genai|generative-ai)["']|require\(\s*["']@google\/(?:genai|generative-ai)["']\s*\))/i, provider: "google" },
  { pattern: /\b(?:from\s+["']google-generativeai["']|import\s+google\.generativeai|import\s+google_generativeai)\b/i, provider: "google" },
  { pattern: /\b(?:from\s+["']groq(?:-sdk)?["']|require\(\s*["']groq(?:-sdk)?["']\s*\))/i, provider: "groq" },
  { pattern: /\b(?:from\s+["']@mistralai\/mistralai["']|require\(\s*["']@mistralai\/mistralai["']\s*\))/i, provider: "mistral" },
  { pattern: /\b(?:from\s+["']cohere-ai["']|require\(\s*["']cohere-ai["']\s*\))/i, provider: "cohere" },
  { pattern: /\b(?:from\s+["']together-ai["']|require\(\s*["']together-ai["']\s*\))/i, provider: "together" },
];

export function detectModels(
  files: RepoFile[],
  agents: DetectedAgent[],
  workflows: DetectedWorkflow[],
): DetectedModelConfig[] {
  const results: DetectedModelConfig[] = [];
  let counter = 0;
  const nextId = () => `model-${++counter}`;

  // 1. Manifest models from agents.
  for (const agent of agents) {
    if (agent.model) {
      results.push({
        id: nextId(),
        provider: agent.model.provider,
        ...(agent.model.name ? { model: agent.model.name } : {}),
        sourcePath: agent.configPath ?? "agents manifest",
        confidence: "high",
        source: "manifest",
        mappedAgentIds: [agent.id],
      });
    }
  }

  // 2. Manifest models from workflow stages.
  for (const wf of workflows) {
    if (!wf.stagesDetailed) continue;
    for (const stage of wf.stagesDetailed) {
      if (!stage.model) continue;
      results.push({
        id: nextId(),
        provider: stage.model.provider,
        ...(stage.model.name ? { model: stage.model.name } : {}),
        sourcePath: wf.configPath ?? "workflow manifest",
        confidence: "high",
        source: "manifest",
        ...(stage.agent ? { mappedAgentIds: [stage.agent] } : {}),
      });
    }
  }

  // 3. Code string models.
  const seenCodeKey = new Set<string>();
  for (const file of files) {
    if (file.ignored || !file.content) continue;
    if (file.classification === "documentation") continue;

    for (const { pattern, provider } of MODEL_PROVIDER_MAP) {
      const matches = [...file.content.matchAll(new RegExp(pattern, pattern.flags + (pattern.flags.includes("g") ? "" : "g")))];
      for (const m of matches) {
        const modelName = m[0];
        const key = `${provider}|${modelName}|${file.path}`;
        if (seenCodeKey.has(key)) continue;
        seenCodeKey.add(key);
        results.push({
          id: nextId(),
          provider,
          model: modelName,
          sourcePath: file.path,
          confidence: "medium",
          source: "code",
        });
      }
    }
  }

  // 4. Provider imports (no model name).
  const seenImportKey = new Set<string>();
  for (const file of files) {
    if (file.ignored || !file.content) continue;
    if (file.classification === "documentation") continue;

    for (const { pattern, provider } of PROVIDER_IMPORT_MAP) {
      if (pattern.test(file.content)) {
        const key = `${provider}|${file.path}`;
        if (seenImportKey.has(key)) continue;
        seenImportKey.add(key);
        results.push({
          id: nextId(),
          provider,
          sourcePath: file.path,
          confidence: "low",
          source: "import",
        });
      }
    }
  }

  // 5. Env-only provider detection (.env.example or similar).
  const seenEnvKey = new Set<string>();
  for (const file of files) {
    if (file.ignored || !file.content) continue;
    const isEnv = file.classification === "environment" || /\.env(\.|$)/i.test(file.name);
    if (!isEnv) continue;

    for (const { env, provider } of PROVIDER_ENV_VARS) {
      if (new RegExp(`(?:^|\\n|\\s)${env}\\b`).test(file.content)) {
        const key = `${provider}|${file.path}|${env}`;
        if (seenEnvKey.has(key)) continue;
        seenEnvKey.add(key);
        results.push({
          id: nextId(),
          provider,
          sourcePath: file.path,
          confidence: "low",
          source: "env",
        });
      }
    }
  }

  return dedupeModelConfigs(results);
}

// Collapse duplicates with same provider+model+sourcePath, keeping the highest-confidence record
// and merging mappedAgentIds.
function dedupeModelConfigs(configs: DetectedModelConfig[]): DetectedModelConfig[] {
  const map = new Map<string, DetectedModelConfig>();
  const rank = { high: 3, medium: 2, low: 1 } as const;
  for (const cfg of configs) {
    const key = `${cfg.provider}|${cfg.model ?? "-"}|${cfg.sourcePath}|${cfg.source}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...cfg });
      continue;
    }
    if (rank[cfg.confidence] > rank[existing.confidence]) {
      existing.confidence = cfg.confidence;
    }
    if (cfg.mappedAgentIds) {
      const merged = new Set([...(existing.mappedAgentIds ?? []), ...cfg.mappedAgentIds]);
      existing.mappedAgentIds = [...merged];
    }
  }
  return [...map.values()];
}

// ---------------- Performance data ----------------

const PERFORMANCE_FILENAME_PATTERNS: RegExp[] = [
  /(^|\/)eval[-_]results?\.json$/i,
  /(^|\/)runs\.json$/i,
  /(^|\/)traces\.json$/i,
  /(^|\/)metrics\.json$/i,
  /(^|\/)model[-_]comparison\.json$/i,
  /(^|\/)reports\/evals\/[^/]+\.json$/i,
  /(^|\/)evals\/results\/[^/]+\.json$/i,
];

export function detectModelPerformance(files: RepoFile[]): DetectedModelPerformance[] {
  const results: DetectedModelPerformance[] = [];

  for (const file of files) {
    if (file.ignored || !file.content) continue;
    if (!PERFORMANCE_FILENAME_PATTERNS.some((p) => p.test(file.path))) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(file.content);
    } catch {
      continue;
    }

    const runs = extractPerformanceRuns(parsed);
    for (const run of runs) {
      if (!isRecord(run)) continue;
      const provider = firstString(run.provider);
      const model = firstString(run.model);
      if (!provider || !model) continue;
      results.push({
        ...(firstString(run.agent_id ?? run.agentId) ? { agentId: firstString(run.agent_id ?? run.agentId) } : {}),
        provider,
        model,
        ...(firstString(run.eval_id ?? run.evalId) ? { evalId: firstString(run.eval_id ?? run.evalId) } : {}),
        ...(typeof run.score === "number" ? { score: run.score } : {}),
        ...(typeof run.latency_ms === "number"
          ? { latencyMs: run.latency_ms }
          : typeof run.latencyMs === "number"
            ? { latencyMs: run.latencyMs }
            : {}),
        ...(typeof run.input_tokens === "number"
          ? { inputTokens: run.input_tokens }
          : typeof run.inputTokens === "number"
            ? { inputTokens: run.inputTokens }
            : {}),
        ...(typeof run.output_tokens === "number"
          ? { outputTokens: run.output_tokens }
          : typeof run.outputTokens === "number"
            ? { outputTokens: run.outputTokens }
            : {}),
        ...(typeof run.cost_usd === "number"
          ? { costUsd: run.cost_usd }
          : typeof run.costUsd === "number"
            ? { costUsd: run.costUsd }
            : {}),
        sourcePath: file.path,
      });
    }
  }

  return results;
}

function extractPerformanceRuns(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!isRecord(parsed)) return [];
  if (Array.isArray(parsed.runs)) return parsed.runs;
  if (Array.isArray(parsed.results)) return parsed.results;
  if (Array.isArray(parsed.evaluations)) return parsed.evaluations;
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    for (const v of value) {
      const s = firstString(v);
      if (s) return s;
    }
  }
  return undefined;
}
