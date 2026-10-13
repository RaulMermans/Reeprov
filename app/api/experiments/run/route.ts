import { NextRequest, NextResponse } from "next/server";
import { experimentDefinitionSchema } from "@/lib/core/contracts/experiment";
import { ExperimentRunner } from "@/lib/core/experiment/runner";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { apiErrorResponse } from "@/lib/api/errors";

export async function POST(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_WRITE" });
    const body = await request.json();
    const definition = experimentDefinitionSchema.parse({
      ...body,
      created_at: body.created_at || new Date().toISOString(),
    });

    const result = await ExperimentRunner.run(definition);
    return NextResponse.json({ result }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

