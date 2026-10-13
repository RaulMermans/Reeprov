import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, AccessControlError } from "@/lib/auth/accessControl";
import { getRunComparison } from "@/lib/core/comparison";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ comparisonId: string }> }
) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const { comparisonId } = await params;
    const comparison = await getRunComparison(comparisonId);

    if (!comparison) {
      return NextResponse.json(
        { error: `RunComparison '${comparisonId}' not found.` },
        { status: 404 }
      );
    }

    return NextResponse.json({ comparison });
  } catch (error) {
    if (error instanceof AccessControlError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
