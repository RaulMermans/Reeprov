import { Octokit } from "@octokit/rest";

export function getGitHubToken() {
  return process.env.GITHUB_TOKEN;
}

export function getGitHubClient() {
  const token = getGitHubToken();
  if (!token) return null;

  return new Octokit({
    auth: token,
  });
}
