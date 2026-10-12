import { NextRequest, NextResponse } from "next/server";
import {
  listExperimentDefinitions,
  saveExperimentDefinition,
  listExperimentResults,
} from "@/lib/core/experiment/persistence";
import { experimentDefinitionSchema } from "@/lib/core/contracts/experiment";

export async function GET() {
  try {
    const definitions = await listExperimentDefinitions();
    const results = await listExperimentResults();
    return NextResponse.json({
      experiments: definitions,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const definition = experimentDefinitionSchema.parse({
      ...body,
      created_at: body.created_at || new Date().toISOString(),
    });

    await saveExperimentDefinition(definition);
    return NextResponse.json({ experiment: definition }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
