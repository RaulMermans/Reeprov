import { NextRequest, NextResponse } from "next/server";
import {
  listExperimentDefinitions,
  saveExperimentDefinition,
  listExperimentResults,
} from "@/lib/core/experiment/persistence";
import { experimentDefinitionSchema } from "@/lib/core/contracts/experiment";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { apiErrorResponse } from "@/lib/api/errors";

export async function GET(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const definitions = await listExperimentDefinitions();
    const results = await listExperimentResults();
    return NextResponse.json({
      experiments: definitions,
      results,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_WRITE" });
    const body = await request.json();
    const definition = experimentDefinitionSchema.parse({
      ...body,
      created_at: body.created_at || new Date().toISOString(),
    });

    await saveExperimentDefinition(definition);
    return NextResponse.json({ experiment: definition }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
