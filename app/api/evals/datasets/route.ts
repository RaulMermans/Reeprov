import { NextRequest, NextResponse } from "next/server";
import {
  listEvalDatasets,
  saveEvalDataset,
  getEvalDataset,
} from "@/lib/core/evals/persistence";
import {
  evalDatasetSchema,
  computeEvalDatasetHash,
} from "@/lib/core/contracts/evalDefinitions";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { apiErrorResponse } from "@/lib/api/errors";

export async function GET(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const { searchParams } = new URL(request.url);
    const datasetId = searchParams.get("id");
    const versionStr = searchParams.get("version");

    if (datasetId) {
      const version = versionStr ? parseInt(versionStr, 10) : 1;
      const dataset = await getEvalDataset(datasetId, version);
      if (!dataset) {
        return NextResponse.json({ error: `Dataset '${datasetId}' not found.` }, { status: 404 });
      }
      return NextResponse.json({ dataset });
    }

    const datasets = await listEvalDatasets();
    return NextResponse.json({ datasets });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_WRITE" });
    const body = await request.json();
    const hash = body.content_hash || computeEvalDatasetHash(body);
    const dataset = evalDatasetSchema.parse({
      ...body,
      content_hash: hash,
      created_at: body.created_at || new Date().toISOString(),
    });

    await saveEvalDataset(dataset);
    return NextResponse.json({ dataset }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
