import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { getStorageHealth } from "@/lib/db/storageHealth";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const health = await getStorageHealth();
    return NextResponse.json(health);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
