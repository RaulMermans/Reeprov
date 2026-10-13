import { NextRequest, NextResponse } from "next/server";
import {
  listRegressionReports,
  getRegressionReport,
} from "@/lib/core/regression/persistence";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const reportId = searchParams.get("id");
    const baselineId = searchParams.get("baseline_id");

    if (reportId) {
      const report = await getRegressionReport(reportId);
      if (!report) {
        return NextResponse.json({ error: `Regression report '${reportId}' not found.` }, { status: 404 });
      }
      return NextResponse.json({ report });
    }

    let reports = await listRegressionReports();
    if (baselineId) {
      reports = reports.filter((r) => r.baseline.baseline_id === baselineId);
    }

    return NextResponse.json({ reports });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
