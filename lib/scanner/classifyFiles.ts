import type { FileClassification } from "./types";
import { getExtension, getFileName } from "./ignoreRules";

const sourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".php",
]);

// Binary and UI asset extensions that should never be classified as agent configs,
// even when found inside an /agents/ directory.
const assetExtensions = new Set([
  ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico",
  ".bmp", ".tiff", ".css", ".scss", ".less", ".woff", ".woff2",
  ".ttf", ".eot", ".mp4", ".mp3", ".wav", ".pdf",
]);

const agentConfigNames = new Set([
  "agents.yaml",
  "agents.yml",
  "agents.json",
  "agent.yaml",
  "agent.yml",
  "agent.json",
]);

// Structured workflow manifest filenames (AI/product workflows only).
// .github/workflows/* are CI files, not product workflows.
const workflowConfigNames = new Set([
  "workflow.yaml",
  "workflow.yml",
  "workflow.json",
  "workflows.yaml",
  "workflows.yml",
  "workflows.json",
  "pipeline.yaml",
  "pipeline.yml",
  "pipeline.json",
]);

const packageNames = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "requirements.txt",
  "pyproject.toml",
  "uv.lock",
]);

export function classifyFile(path: string, content = ""): FileClassification {
  const lower = path.toLowerCase();
  const name = getFileName(lower);
  const extension = getExtension(lower);
  const normalized = `/${lower}`;

  if (name === ".env.example") return "environment";
  if (packageNames.has(name)) return "package_config";
  if (
    name === "agents.md" ||
    name === "claude.md" ||
    name === "readme.md" ||
    normalized.includes("/docs/")
  ) {
    return "documentation";
  }
  if (agentConfigNames.has(name)) {
    return "agent_config";
  }
  if (workflowConfigNames.has(name)) {
    return "workflow_config";
  }

  // CI infrastructure files must be classified before the generic /workflows/
  // path so that .github/workflows/* is not treated as a product workflow.
  if (isCIPath(normalized, lower)) {
    return "ci";
  }

  if (normalized.includes("/agents/")) {
    // Asset/binary files (SVGs, images, CSS) inside /agents/ are never agent configs.
    if (assetExtensions.has(extension)) return "unknown";
    return sourceExtensions.has(extension) || /\b(export|function|class|import|def)\b/.test(content)
      ? "source_code"
      : "agent_config";
  }

  // Test files are checked before prompt/eval so that filenames like
  // "prompt-input.test.ts" are correctly classified as tests, not prompts.
  if (isTestPath(normalized, name)) {
    return "test";
  }

  // Prompt files: only classify as prompt when not in a test or source
  // directory, and only for genuine prompt assets.
  if (isPromptFile(normalized, name, content)) {
    return "prompt";
  }

  // Evals: dedicated AI evaluation directories and manifest files.
  if (isEvalFile(normalized, name)) {
    return "eval";
  }

  if (
    normalized.includes("/tools/") ||
    /\b(function_tool|tool_call|toolhandler|tool_name)\b/i.test(content)
  ) {
    return "tool";
  }

  // Product workflows: /workflows/ outside of .github (already caught above as CI).
  if (
    normalized.includes("/workflows/") ||
    lower.includes("langgraph") ||
    lower.includes("workflow")
  ) {
    return "workflow";
  }

  if (name.endsWith(".md")) {
    return "documentation";
  }
  if (sourceExtensions.has(extension)) return "source_code";

  return "unknown";
}

function isCIPath(normalized: string, lower: string): boolean {
  return (
    normalized.includes("/.github/workflows/") ||
    normalized.includes("/.circleci/") ||
    lower === ".gitlab-ci.yml" ||
    lower.includes(".gitlab-ci.")
  );
}

function isTestPath(normalized: string, name: string): boolean {
  return (
    normalized.includes("/tests/") ||
    normalized.includes("/__tests__/") ||
    normalized.includes("/test/") ||
    normalized.includes("/cypress/") ||
    normalized.includes("/playwright/") ||
    name.endsWith(".test.ts") ||
    name.endsWith(".spec.ts") ||
    name.endsWith(".test.tsx") ||
    name.endsWith(".spec.tsx") ||
    name.endsWith(".test.js") ||
    name.endsWith(".spec.js") ||
    name.endsWith(".test.py") ||
    name.endsWith(".spec.py")
  );
}

function isPromptFile(normalized: string, name: string, content: string): boolean {
  // Files in /prompts/ directory are always prompt assets.
  if (normalized.includes("/prompts/")) return true;
  // Named system-prompt files or persona files are always prompts.
  if (name.startsWith("system-prompt") || name === "system-persona.md") return true;
  // *.prompt.md / *.prompt.ts / *.prompt.txt / *.prompt.js files are prompt assets.
  if (/\.prompt\.(md|txt|ts|js)$/.test(name)) return true;
  // Content-based detection: only for files not in known source/library/fixture directories.
  // This prevents scanner source files, report builders, and fixtures from being
  // counted as prompt assets just because they contain prompt-related words.
  if (
    promptLanguage(content) &&
    !normalized.includes("/src/") &&
    !normalized.includes("/app/") &&
    !normalized.includes("/tools/") &&
    !normalized.includes("/lib/") &&
    !normalized.includes("/components/") &&
    !normalized.includes("/api/") &&
    !normalized.includes("/scanner/") &&
    !normalized.includes("/reports/") &&
    !normalized.includes("/auditors/") &&
    !normalized.includes("/__fixtures__/") &&
    !normalized.includes("/fixtures/") &&
    !normalized.includes("/fixture/") &&
    !normalized.includes("/mocks/") &&
    !normalized.includes("/mock/") &&
    !normalized.includes("/__mocks__/") &&
    !normalized.includes("/testdata/") &&
    !normalized.includes("/docs/") &&
    !normalized.includes("/documentation/") &&
    !normalized.includes("/examples/") &&
    !normalized.includes("/example/") &&
    !normalized.includes("/samples/") &&
    !normalized.includes("/sample/") &&
    !normalized.includes("/demos/") &&
    !normalized.includes("/demo/")
  ) {
    return true;
  }
  return false;
}

function isEvalFile(normalized: string, name: string): boolean {
  return (
    normalized.includes("/evals/") ||
    normalized.includes("/evaluations/") ||
    normalized.includes("/evaluation/") ||
    normalized.includes("/evaluators/") ||
    name.includes("promptfoo") ||
    // Eval manifests (but not generic test files named with "eval")
    (name.includes("eval") && (name.endsWith(".yaml") || name.endsWith(".yml") || name.endsWith(".json")))
  );
}

function promptLanguage(content: string) {
  return /\b(system prompt|developer message|tool policy|role:|instructions|you are an ai|never obey)\b/i.test(
    content,
  );
}
