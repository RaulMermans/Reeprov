import { NextRequest, NextResponse } from "next/server";
import { getRunComparison } from "@/lib/core/comparison";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ comparisonId: string }> }
) {
  try {
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
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
