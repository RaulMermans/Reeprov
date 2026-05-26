/**
 * POST /api/reconstruct
 *
 * Accepts either a saved reportId or an inline ScanReport and returns a
 * StaticProofReconstruction.
 *
 * Auth: x-agentpulse-key (AGENTPULSE_ACCESS_KEY)
 *
 * Body (one of):
 *   { reportId: string }      — loads saved report by ID (404 if not found)
 *   { report: ScanReport }    — validates the report against scanReportSchema
 *
 * If both are omitted, returns 400. If `report` is malformed, returns 400 with
 * validation details. The reconstruction output is itself validated against
 * `staticProofReconstructionSchema` before being returned.
 */

import { NextResponse } from "next/server";
import { apiErrorResponse, invalidRequest } from "@/lib/api/errors";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { fileReportStore } from "@/lib/reports/reportStore";
import { reconstructFromScanReport } from "@/lib/reconstruction/reconstructWorkflowSpec";
import { staticProofReconstructionSchema } from "@/lib/reconstruction/schema";
import { scanReportSchema } from "@/lib/reports/reportSchema";
import type { ScanReport } from "@/lib/scanner/types";

export async function POST(request: Request) {
  try {
    requireAccessKey(request);

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw invalidRequest("Body must be valid JSON.");
    }

    if (!body || typeof body !== "object") {
      throw invalidRequest('Body must be an object with "reportId" or "report".');
    }

    const hasReportId = typeof body["reportId"] === "string" && (body["reportId"] as string).length > 0;
    const hasReport = typeof body["report"] === "object" && body["report"] !== null;

    if (!hasReportId && !hasReport) {
      throw invalidRequest('Provide either "reportId" (string) or "report" (ScanReport object).');
    }

    if (hasReportId && hasReport) {
      throw invalidRequest('Provide either "reportId" or "report", not both.');
    }

    let report: ScanReport;

    if (hasReportId) {
      const reportId = body["reportId"] as string;
      const saved = await fileReportStore.getReport(reportId);
      if (!saved) {
        return NextResponse.json(
          { message: `Report "${reportId}" not found.` },
          { status: 404 },
        );
      }
      report = saved;
    } else {
      const parseResult = scanReportSchema.safeParse(body["report"]);
      if (!parseResult.success) {
        return NextResponse.json(
          {
            error: "invalid_report",
            message: "The provided report does not match the ScanReport schema.",
            issues: parseResult.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
            recoverable: true,
          },
          { status: 400 },
        );
      }
      report = parseResult.data as ScanReport;
    }

    const reconstruction = reconstructFromScanReport(report);
    const validated = staticProofReconstructionSchema.parse(reconstruction);
    return NextResponse.json(validated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
