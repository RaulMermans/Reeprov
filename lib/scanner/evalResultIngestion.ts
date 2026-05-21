import type { EvalPerformanceResult, PerformanceData, RepoFile } from "./types";

// Filename patterns that identify eval/benchmark result files.
const EVAL_RESULT_NAME_PATTERNS: RegExp[] = [
  /^eval[-_]results?\.(json|jsonl)$/i,
  /^benchmark[-_]results?\.(json|jsonl)$/i,
  /^benchmarks?\.(json|jsonl)$/i,
  /^model[-_]comparison\.(json|jsonl)$/i,
  /^performance[-_]results?\.(json|jsonl)$/i,
  /^results?\.(json|jsonl)$/i,
];

// Path patterns for results nested inside result directories.
const EVAL_RESULT_PATH_PATTERNS: RegExp[] = [
  /\/runs\/[^/]+\.jsonl?$/i,
  /\/evals?\/results?\/[^/]+\.jsonl?$/i,
  /\/evaluations?\/results?\/[^/]+\.jsonl?$/i,
  /\/benchmarks?\/results?\/[^/]+\.jsonl?$/i,
];

// Ingest eval/benchmark performance result files from the file set.
// Returns structured performance data if any result files are found.
export function ingestEvalResults(files: RepoFile[]): PerformanceData {
  const resultFiles = files.filter((f) => !f.ignored && isEvalResultFile(f));

  if (resultFiles.length === 0) {
    return { available: false, results: [], evalResultCount: 0, resultFiles: [] };
  }

  const allResults: EvalPerformanceResult[] = [];

  for (const file of resultFiles) {
    if (!file.content) continue;
    allResults.push(...parseEvalResults(file.content, file.path));
  }

  return {
    available: allResults.length > 0,
    results: allResults.slice(0, 500), // cap to prevent report bloat
    evalResultCount: allResults.length,
    resultFiles: resultFiles.map((f) => f.path),
  };
}

function isEvalResultFile(file: RepoFile): boolean {
  const name = file.name.toLowerCase();
  if (EVAL_RESULT_NAME_PATTERNS.some((p) => p.test(name))) return true;
  // Normalize path to always start with / for pattern matching.
  const normalized = `/${file.path.toLowerCase().replace(/^\//, "")}`;
  if (EVAL_RESULT_PATH_PATTERNS.some((p) => p.test(normalized))) return true;
  return false;
}

function parseEvalResults(content: string, path: string): EvalPerformanceResult[] {
  const results: EvalPerformanceResult[] = [];

  if (path.toLowerCase().endsWith(".jsonl")) {
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//")) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        const result = extractResult(parsed, path);
        if (result) results.push(result);
      } catch {
        // skip invalid lines
      }
    }
    return results;
  }

  // JSON array or single object
  try {
    const parsed: unknown = JSON.parse(content);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const result = extractResult(item, path);
        if (result) results.push(result);
      }
    } else {
      const result = extractResult(parsed, path);
      if (result) results.push(result);
    }
  } catch {
    // not valid JSON
  }

  return results;
}

function extractResult(obj: unknown, path: string): EvalPerformanceResult | null {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;

  const r = obj as Record<string, unknown>;

  // Require at least a score or pass field to qualify as an eval result.
  if (r.score === undefined && r.pass === undefined && r.latency_ms === undefined) return null;

  return {
    agent: typeof r.agent === "string" ? r.agent : undefined,
    workflow: typeof r.workflow === "string" ? r.workflow : undefined,
    model: typeof r.model === "string" ? r.model : undefined,
    provider: typeof r.provider === "string" ? r.provider : undefined,
    score: typeof r.score === "number" ? r.score : undefined,
    latencyMs: typeof r.latency_ms === "number" ? r.latency_ms : undefined,
    tokensInput: typeof r.tokens_input === "number" ? r.tokens_input : undefined,
    tokensOutput: typeof r.tokens_output === "number" ? r.tokens_output : undefined,
    costUsd: typeof r.cost_usd === "number" ? r.cost_usd : undefined,
    pass: typeof r.pass === "boolean" ? r.pass : undefined,
    sourcePath: path,
  };
}
