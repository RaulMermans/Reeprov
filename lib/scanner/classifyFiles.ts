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

const configNames = new Set([
  "agents.yaml",
  "agents.yml",
  "agents.json",
  "agent.yaml",
  "agent.yml",
  "agent.json",
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
  if (name === "agents.md") return "documentation";
  if (configNames.has(name) || normalized.includes("/agents/")) {
    return "agent_config";
  }
  if (
    normalized.includes("/prompts/") ||
    name.includes("system-prompt") ||
    name.includes("prompt") ||
    promptLanguage(content)
  ) {
    return "prompt";
  }
  if (
    normalized.includes("/evals/") ||
    normalized.includes("/evaluations/") ||
    name.includes("promptfoo") ||
    name.includes("eval")
  ) {
    return "eval";
  }
  if (
    normalized.includes("/tests/") ||
    normalized.includes("/test/") ||
    name.endsWith(".test.ts") ||
    name.endsWith(".spec.ts") ||
    name.endsWith(".test.tsx") ||
    name.endsWith(".spec.tsx")
  ) {
    return "test";
  }
  if (
    normalized.includes("/tools/") ||
    /\b(function_tool|tool_call|toolhandler|tool_name)\b/i.test(content)
  ) {
    return "tool";
  }
  if (
    normalized.includes("/workflows/") ||
    normalized.includes("/.github/workflows/") ||
    lower.includes("langgraph") ||
    lower.includes("workflow")
  ) {
    return "workflow";
  }
  if (name === "readme.md" || normalized.includes("/docs/") || name.endsWith(".md")) {
    return "documentation";
  }
  if (sourceExtensions.has(extension)) return "source_code";

  return "unknown";
}

function promptLanguage(content: string) {
  return /\b(system prompt|developer message|tool policy|role:|instructions|you are an ai|never obey)\b/i.test(
    content,
  );
}
