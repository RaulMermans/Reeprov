import { NextRequest, NextResponse } from "next/server";
import {
  listEvalSuites,
  saveEvalSuite,
  getEvalSuite,
} from "@/lib/core/evals/persistence";
import {
  evalSuiteSchema,
  computeEvalSuiteHash,
} from "@/lib/core/contracts/evalDefinitions";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { apiErrorResponse } from "@/lib/api/errors";

export async function GET(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const { searchParams } = new URL(request.url);
    const suiteId = searchParams.get("id");
    const versionStr = searchParams.get("version");

    if (suiteId) {
      const version = versionStr ? parseInt(versionStr, 10) : 1;
      const suite = await getEvalSuite(suiteId, version);
      if (!suite) {
        return NextResponse.json({ error: `Suite '${suiteId}' not found.` }, { status: 404 });
      }
      return NextResponse.json({ suite });
    }

    const suites = await listEvalSuites();
    return NextResponse.json({ suites });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_WRITE" });
    const body = await request.json();
    const hash = body.content_hash || computeEvalSuiteHash(body);
    const suite = evalSuiteSchema.parse({
      ...body,
      content_hash: hash,
      created_at: body.created_at || new Date().toISOString(),
    });

    await saveEvalSuite(suite);
    return NextResponse.json({ suite }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
