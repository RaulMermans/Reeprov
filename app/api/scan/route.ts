import { NextResponse } from "next/server";
import { z } from "zod";
import { getGitHubClient } from "@/lib/github/client";
import { fetchRepoFiles } from "@/lib/github/fetchRepoFiles";
import { buildReport, mockReport } from "@/lib/reports/buildReport";

const scanRequestSchema = z.object({
  owner: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  mock: z.boolean().optional(),
});

export async function POST(request: Request) {
  const body = scanRequestSchema.parse(await request.json().catch(() => ({})));
  const octokit = getGitHubClient();

  if (body.mock || !octokit || !body.owner || !body.name) {
    return NextResponse.json(mockReport());
  }

  const files = await fetchRepoFiles(octokit, body.owner, body.name);
  const report = buildReport({
    repoName: `${body.owner}/${body.name}`,
    files,
  });

  return NextResponse.json(report);
}
