import { NextResponse } from "next/server";
import { getAppVersion, getDeploymentEnvironment } from "@/lib/db/storageHealth";

/**
 * Unauthenticated liveness check. Does not touch the database or any
 * protected resource — safe for uptime monitors and load balancers.
 * For storage/dependency health, see GET /api/storage/health.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    environment: getDeploymentEnvironment(),
    version: getAppVersion(),
    time: new Date().toISOString(),
  });
}
