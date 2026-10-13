import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { authorizeRequest, AccessControlError } from "@/lib/auth/accessControl";
import { getReportStore } from "@/lib/db/getStores";

interface RouteParams {
  params: Promise<{ reportId: string }>;
}

/**
 * GET /api/reports/[reportId]
 * Returns the full saved report for the given ID.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const { reportId } = await params;
    const report = await getReportStore().getReport(reportId);

    if (!report) {
      return NextResponse.json(
        { message: `Report ${reportId} not found.` },
        { status: 404 },
      );
    }

    return NextResponse.json(report);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * DELETE /api/reports/[reportId]
 * Removes a saved report and its index entry.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_WRITE" });
    const { reportId } = await params;
    const deleted = await getReportStore().deleteReport(reportId);

    if (!deleted) {
      return NextResponse.json(
        { message: `Report ${reportId} not found or could not be deleted.` },
        { status: 404 },
      );
    }

    return NextResponse.json({ deleted: true, reportId });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
