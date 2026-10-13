import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { authorizeRequest, AccessControlError } from "@/lib/auth/accessControl";
import { getGitHubClient } from "@/lib/github/client";

export async function GET(request: Request) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });

    const octokit = getGitHubClient();

    if (!octokit) {
      return NextResponse.json({
        mode: "mock",
        repos: [
          { owner: "mock-owner", name: "mock-agent-repo", fullName: "mock-owner/mock-agent-repo" },
          { owner: "mock-owner", name: "workflow-bot", fullName: "mock-owner/workflow-bot" },
        ],
      });
    }

    const repos = await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
      per_page: 100,
      sort: "updated",
    });

    return NextResponse.json({
      mode: "github",
      repos: repos.map((repo) => ({
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        private: repo.private,
        defaultBranch: repo.default_branch,
      })),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
