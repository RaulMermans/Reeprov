import { NextRequest, NextResponse } from "next/server";
import { experimentDefinitionSchema } from "@/lib/core/contracts/experiment";
import { ExperimentRunner } from "@/lib/core/experiment/runner";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const definition = experimentDefinitionSchema.parse({
      ...body,
      created_at: body.created_at || new Date().toISOString(),
    });

    const result = await ExperimentRunner.run(definition);
    return NextResponse.json({ result }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
