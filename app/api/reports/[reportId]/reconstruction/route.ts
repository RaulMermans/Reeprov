/**
 * GET /api/reports/[reportId]/reconstruction
 *
 * Generates a StaticProofReconstruction from a saved ScanReport.
 * No code is executed; reconstruction is purely from static scan evidence.
 *
 * Auth: x-agentpulse-key (AGENTPULSE_ACCESS_KEY)
 *
 * Response: StaticProofReconstruction (validated against schema)
 *
 * To reconstruct from an inline ScanReport body, use POST /api/reconstruct
 * with { report } instead.
 */

import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { getReportStore } from "@/lib/db/getStores";
import { reconstructFromScanReport } from "@/lib/reconstruction/reconstructWorkflowSpec";
import { staticProofReconstructionSchema } from "@/lib/reconstruction/schema";

interface RouteParams {
  params: Promise<{ reportId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    requireAccessKey(request);

    const { reportId } = await params;
    const report = await getReportStore().getReport(reportId);

    if (!report) {
      return NextResponse.json(
        { message: `Report ${reportId} not found.` },
        { status: 404 },
      );
    }

    const reconstruction = reconstructFromScanReport(report);
    const validated = staticProofReconstructionSchema.parse(reconstruction);
    return NextResponse.json(validated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
