/**
 * POST /api/reconstruct
 *
 * Accepts either a reportId or a ScanReport body and returns a
 * StaticProofReconstruction.
 *
 * Auth: x-agentpulse-key (AGENTPULSE_ACCESS_KEY)
 *
 * Body:
 *   { reportId: string }                   — loads saved report by ID
 *   { report: ScanReport }                 — uses provided report directly
 *
 * Response: StaticProofReconstruction
 */

import { NextResponse } from "next/server";
import { apiErrorResponse, invalidRequest } from "@/lib/api/errors";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { fileReportStore } from "@/lib/reports/reportStore";
import { reconstructFromScanReport } from "@/lib/reconstruction/reconstructWorkflowSpec";
import type { ScanReport } from "@/lib/scanner/types";

export async function POST(request: Request) {
  try {
    requireAccessKey(request);

    const body = await request.json() as Record<string, unknown>;

    let report: ScanReport | null = null;

    if (typeof body["reportId"] === "string" && body["reportId"]) {
      // Load saved report by ID.
      const saved = await fileReportStore.getReport(body["reportId"]);
      if (!saved) {
        return NextResponse.json(
          { message: `Report "${body["reportId"]}" not found.` },
          { status: 404 },
        );
      }
      report = saved;
    } else if (typeof body["report"] === "object" && body["report"] !== null) {
      // Use the provided report body.
      report = body["report"] as ScanReport;
    } else {
      throw invalidRequest('Provide either "reportId" (string) or "report" (ScanReport object).');
    }

    const reconstruction = reconstructFromScanReport(report);
    return NextResponse.json(reconstruction);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
