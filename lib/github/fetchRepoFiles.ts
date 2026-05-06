import type { Octokit } from "@octokit/rest";
import { shouldIgnorePath } from "@/lib/scanner/ignoreRules";
import { fetchRepoTree } from "./fetchRepoTree";

export interface FetchedRepoFile {
  path: string;
  size: number;
  content?: string;
}

const maxFiles = 300;

export async function fetchRepoFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<FetchedRepoFile[]> {
  const tree = await fetchRepoTree(octokit, owner, repo);
  const selected = tree.slice(0, maxFiles);

  return Promise.all(
    selected.map(async (file) => {
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
    }),
  );
}
