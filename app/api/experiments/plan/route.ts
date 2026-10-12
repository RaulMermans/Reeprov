import { NextRequest, NextResponse } from "next/server";
import { experimentDefinitionSchema } from "@/lib/core/contracts/experiment";
import { ExperimentPlanner } from "@/lib/core/experiment/planner";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const definition = experimentDefinitionSchema.parse({
      ...body,
      created_at: body.created_at || new Date().toISOString(),
    });

    const plan = ExperimentPlanner.plan(definition);
    return NextResponse.json({ plan });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
