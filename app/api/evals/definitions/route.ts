import { NextRequest, NextResponse } from "next/server";
import {
  listEvalDefinitions,
  saveEvalDefinition,
} from "@/lib/core/evals/persistence";
import {
  evalDefinitionSchema,
  computeEvalDefinitionHash,
} from "@/lib/core/contracts/evalDefinitions";

export async function GET() {
  try {
    const definitions = await listEvalDefinitions();
    return NextResponse.json({ definitions });
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
    const hash = body.content_hash || computeEvalDefinitionHash(body);
    const definition = evalDefinitionSchema.parse({
      ...body,
      content_hash: hash,
      created_at: body.created_at || new Date().toISOString(),
    });

    await saveEvalDefinition(definition);
    return NextResponse.json({ definition }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
