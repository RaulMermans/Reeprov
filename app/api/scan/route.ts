import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, invalidRequest } from "@/lib/api/errors";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { getGitHubClient } from "@/lib/github/client";
import { fetchRepoFiles } from "@/lib/github/fetchRepoFiles";
import { mockReport } from "@/lib/reports/buildReport";
import { getReportStore } from "@/lib/db/getStores";
import { runScanPipeline } from "@/lib/reports/runScanPipeline";

const scanRequestSchema = z.object({
  owner: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  mock: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    requireAccessKey(request);

    const body = await parseScanBody(request);
    const octokit = getGitHubClient();

    if (body.mock || !octokit) {
      const report = await mockReport({ allowLlmAuditors: true });
      // Mock scans are not persisted to avoid polluting history.
      return NextResponse.json(report);
    }

    if (!body.owner || !body.name) {
      throw invalidRequest("Scan requests must include owner and name, or set mock to true.");
    }

    const scan = await fetchRepoFiles(octokit, body.owner, body.name);
    const report = await runScanPipeline({
      repoName: `${body.owner}/${body.name}`,
      files: scan.files,
      githubTreeTruncated: scan.treeTruncated,
      scanSource: {
        type: "github",
        label: `${body.owner}/${body.name}`,
        owner: body.owner,
        repo: body.name,
      },
      allowLlmAuditors: true,
    });

    // Persist the redacted report. Non-fatal on failure.
    const persistence = await getReportStore().saveReport(report);

    return NextResponse.json({
      ...report,
      _persistence: persistence,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

async function parseScanBody(request: Request) {
  let json: unknown;

  try {
    json = await request.json();
  } catch {
    throw invalidRequest("Request body must be valid JSON.");
  }

  const parsed = scanRequestSchema.safeParse(json);

  if (!parsed.success) {
    throw invalidRequest("Request body must include valid scan parameters.");
  }

  return parsed.data;
}
