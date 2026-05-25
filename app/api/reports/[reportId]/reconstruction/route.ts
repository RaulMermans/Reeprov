/**
 * GET /api/reports/[reportId]/reconstruction
 *
 * Generates a StaticProofReconstruction from a saved ScanReport.
 * No code is executed; reconstruction is purely from static scan evidence.
 *
 * Auth: x-agentpulse-key (AGENTPULSE_ACCESS_KEY)
 *
 * Response: StaticProofReconstruction
 */

import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { fileReportStore } from "@/lib/reports/reportStore";
import { reconstructFromScanReport } from "@/lib/reconstruction/reconstructWorkflowSpec";

interface RouteParams {
  params: Promise<{ reportId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    requireAccessKey(request);

    const { reportId } = await params;
    const report = await fileReportStore.getReport(reportId);

    if (!report) {
      return NextResponse.json(
        { message: `Report ${reportId} not found.` },
        { status: 404 },
      );
    }

    const reconstruction = reconstructFromScanReport(report);

    return NextResponse.json(reconstruction);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * POST /api/reports/[reportId]/reconstruction
 *
 * Alternative: accepts a ScanReport body directly (without persisting it first).
 * Useful for testing reconstruction against unsaved reports.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    requireAccessKey(request);

    const { reportId } = await params;

    // If a body is provided, use it as the report.
    let report;
    try {
      const body = await request.json() as Record<string, unknown>;
      if (body && typeof body === "object" && "reportId" in body) {
        // Body looks like a ScanReport — use it directly.
        report = body;
      }
    } catch {
      // No body or invalid JSON — fall through to store lookup.
    }

    if (!report) {
      report = await fileReportStore.getReport(reportId);
    }

    if (!report) {
      return NextResponse.json(
        { message: `Report ${reportId} not found.` },
        { status: 404 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reconstruction = reconstructFromScanReport(report as any);
    return NextResponse.json(reconstruction);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
