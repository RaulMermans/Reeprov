import type { FileContext } from "./types";

// Derive the operational context of a file from its path. Used to calibrate
// secret finding severity so that test/doc/example values don't score the
// same as production credentials.
export function deriveFileContext(path: string): FileContext {
  const lower = path.toLowerCase();
  const normalized = `/${lower}`;

  // CI infrastructure files must be checked before the generic /workflows/ path
  // so that .github/workflows/* is not mistaken for a product workflow.
  if (
    normalized.includes("/.github/workflows/") ||
    normalized.includes("/.circleci/") ||
    lower === ".gitlab-ci.yml" ||
    lower.includes(".gitlab-ci.") ||
    lower === "railway.json" ||
    lower === "vercel.json" ||
    lower === "netlify.toml" ||
    lower === "render.yaml"
  ) {
    return "ci";
  }

  // Test files (checked before prompt/eval so test filenames don't mis-classify)
  if (
    normalized.includes("/tests/") ||
    normalized.includes("/__tests__/") ||
    normalized.includes("/test/") ||
    normalized.includes("/cypress/") ||
    normalized.includes("/playwright/") ||
    lower.includes(".test.") ||
    lower.includes(".spec.")
  ) {
    return "test";
  }

  // Example / fixture / mock / stub directories
  if (
    normalized.includes("/examples/") ||
    normalized.includes("/example/") ||
    normalized.includes("/sample/") ||
    normalized.includes("/samples/") ||
    normalized.includes("/demo/") ||
    normalized.includes("/demos/") ||
    normalized.includes("/fixtures/") ||
    normalized.includes("/fixture/") ||
    normalized.includes("/mocks/") ||
    normalized.includes("/mock/") ||
    normalized.includes("/stubs/")
  ) {
    return "example";
  }

  // Database migrations
  if (
    normalized.includes("/migrations/") ||
    normalized.includes("/migration/") ||
    (lower.endsWith(".sql") && (normalized.includes("/schema") || normalized.includes("/seed")))
  ) {
    return "migration";
  }

  // Documentation files (markdown unless they are prompt/agent manifests)
  if (
    lower.endsWith(".md") ||
    normalized.includes("/docs/") ||
    lower === "readme" ||
    lower === "readme.md" ||
    lower === "agents.md" ||
    lower === "claude.md"
  ) {
    return "documentation";
  }

  // Config: package manifests, build configs, agent/workflow manifests
  if (
    lower === "package.json" ||
    lower === "pnpm-lock.yaml" ||
    lower === "package-lock.json" ||
    lower === "yarn.lock" ||
    lower.startsWith("tsconfig") ||
    lower.includes("vite.config.") ||
    lower.includes("next.config.") ||
    lower.includes(".eslintrc") ||
    lower.includes(".prettierrc") ||
    lower.endsWith(".env.example") ||
    lower === "agents.yaml" ||
    lower === "agents.yml" ||
    lower === "agents.json" ||
    lower === "workflow.yaml" ||
    lower === "workflow.yml" ||
    lower === "workflow.json" ||
    lower === "workflows.yaml" ||
    lower === "workflows.json" ||
    lower === "pipeline.yaml" ||
    lower === "pipeline.yml"
  ) {
    return "config";
  }

  // Production source directories
  if (
    normalized.includes("/app/") ||
    normalized.includes("/src/") ||
    normalized.includes("/backend/") ||
    normalized.includes("/worker/") ||
    normalized.includes("/lib/") ||
    normalized.includes("/server/") ||
    normalized.includes("/services/") ||
    normalized.includes("/api/")
  ) {
    return "production";
  }

  return "unknown";
}
