/**
 * GET /api/runs/[runId]/memory-intelligence
 * Returns the derived MemoryIntelligenceReport for a given run.
 * Fetches precomputed report or computes on-the-fly from the canonical run evidence.
 *
 * Auth: x-agentpulse-key (AGENTPULSE_ACCESS_KEY or AGENTPULSE_INGEST_KEY)
 */

import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { getCanonicalRun } from "@/lib/core/capture/persistence";
import { analyzeRunMemory } from "@/lib/core/intelligence/memoryAnalyzer";
import {
  getMemoryIntelligenceReport,
  saveMemoryIntelligenceReport,
} from "@/lib/core/intelligence/persistence";

interface RouteParams {
  params: Promise<{ runId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    requireAccessKey(request);
    const { runId } = await params;

    // 1. Try to load existing report
    const existing = await getMemoryIntelligenceReport(runId);
    if (existing) {
      return NextResponse.json(existing);
    }

    // 2. Fetch canonical run artifact to compute report on the fly
    const canonical = await getCanonicalRun(runId);
    if (!canonical) {
      return NextResponse.json(
        { message: `Run "${runId}" not found.` },
        { status: 404 }
      );
    }

    // 3. Compute deterministic memory intelligence report
    const report = analyzeRunMemory(canonical);

    // 4. Persist for future fast lookup
    await saveMemoryIntelligenceReport(report);

    return NextResponse.json(report);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
