import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { fileReportStore } from "@/lib/reports/reportStore";

/**
 * GET /api/reports
 * Lists saved scan report summaries. Supports optional query params:
 *   ?projectId=proj_owner__repo  — filter by project
 *   ?limit=20                    — max results
 */
export async function GET(request: Request) {
  try {
    requireAccessKey(request);

    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") ?? undefined;
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.max(1, Math.min(200, parseInt(limitParam, 10))) : 50;

    const reports = await fileReportStore.listReports({ projectId, limit });
    return NextResponse.json({ reports, count: reports.length });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
