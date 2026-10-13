import { NextRequest, NextResponse } from "next/server";
import {
  listEvalDefinitions,
  saveEvalDefinition,
} from "@/lib/core/evals/persistence";
import {
  evalDefinitionSchema,
  computeEvalDefinitionHash,
} from "@/lib/core/contracts/evalDefinitions";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { apiErrorResponse } from "@/lib/api/errors";

export async function GET(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const definitions = await listEvalDefinitions();
    return NextResponse.json({ definitions });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_WRITE" });
    const body = await request.json();
    const hash = body.content_hash || computeEvalDefinitionHash(body);
    const definition = evalDefinitionSchema.parse({
      ...body,
      content_hash: hash,
      created_at: body.created_at || new Date().toISOString(),
    });

    await saveEvalDefinition(definition);
    return NextResponse.json({ definition }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
