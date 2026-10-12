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

export async function GET(request: NextRequest) {
  try {
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
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
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
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
