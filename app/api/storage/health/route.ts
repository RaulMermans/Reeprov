import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { getStorageHealth } from "@/lib/db/storageHealth";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    requireAccessKey(request);
    const health = await getStorageHealth();
    return NextResponse.json(health);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
