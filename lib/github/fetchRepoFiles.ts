import type { Octokit } from "@octokit/rest";
import { shouldIgnorePath } from "@/lib/scanner/ignoreRules";
import { mapLimit } from "@/lib/utils/mapLimit";
import { fetchRepoTree } from "./fetchRepoTree";

export interface FetchedRepoFile {
  path: string;
  size: number;
  content?: string;
}

export interface FetchedRepoFilesResult {
  files: FetchedRepoFile[];
  treeTruncated: boolean;
}

const maxFiles = 300;
const maxBlobConcurrency = 8;
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

const packageConfigNames = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "requirements.txt",
  "pyproject.toml",
  "uv.lock",
]);

export async function fetchRepoFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<FetchedRepoFilesResult> {
  const tree = await fetchRepoTree(octokit, owner, repo);
  const selected = selectFiles(tree.files);

  const files = await mapLimit(
    selected,
    maxBlobConcurrency,
    async (file): Promise<FetchedRepoFile> => {
      const ignore = shouldIgnorePath(file.path, file.size);
      if (ignore.ignored) {
        return { path: file.path, size: file.size };
      }

      const blob = await octokit.rest.git.getBlob({
        owner,
        repo,
        file_sha: file.sha,
      });

      const content =
        blob.data.encoding === "base64"
          ? Buffer.from(blob.data.content, "base64").toString("utf8")
          : blob.data.content;

      return {
        path: file.path,
        size: file.size,
        content,
      };
    },
  );

  return { files, treeTruncated: tree.truncated };
}

function selectFiles<T extends { path: string }>(files: T[]) {
  return [...files]
    .sort(
      (left, right) =>
        priority(left.path) - priority(right.path) || left.path.localeCompare(right.path),
    )
    .slice(0, maxFiles);
}

function priority(path: string) {
  const lower = path.toLowerCase();
  const normalized = `/${lower}`;
  const name = lower.split("/").pop() ?? lower;
  const extensionIndex = name.lastIndexOf(".");
  const extension = extensionIndex > 0 ? name.slice(extensionIndex) : "";

  if (name === "agents.md") return 0;
  if (/^agents\.(ya?ml|json)$/.test(name)) return 1;
  if (/^\.env(\.|$)/.test(name)) return 2;
  if (normalized.includes("/agents/")) return 3;
  if (normalized.includes("/prompts/")) return 4;
  if (normalized.includes("/tools/")) return 5;
  if (normalized.includes("/evals/") || normalized.includes("/evaluations/")) return 6;
  if (normalized.includes("/workflows/") || normalized.includes("/.github/workflows/")) return 7;
  if (name === "readme.md") return 8;
  if (normalized.includes("/docs/")) return 9;
  if (packageConfigNames.has(name)) return 10;
  if (sourceExtensions.has(extension)) return 11;

  return 20;
}
