import type { Octokit } from "@octokit/rest";

export interface RepoTreeFile {
  path: string;
  sha: string;
  size: number;
}

export interface RepoTreeResult {
  files: RepoTreeFile[];
  treeTruncated: boolean;
}

export async function fetchRepoTree(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<RepoTreeResult> {
  const repoResponse = await octokit.rest.repos.get({ owner, repo });
  const branch = repoResponse.data.default_branch;
  const ref = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });
  const tree = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: ref.data.object.sha,
    recursive: "true",
  });

  return {
    files: tree.data.tree
      .filter((item) => item.type === "blob" && item.path && item.sha)
      .map((item) => ({
        path: item.path ?? "",
        sha: item.sha ?? "",
        size: item.size ?? 0,
      })),
    treeTruncated: tree.data.truncated,
  };
}
