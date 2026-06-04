import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { ensureSchema } from "@/lib/db/migrate";
import { getStorageHealth } from "@/lib/db/storageHealth";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    requireAccessKey(request);
    await ensureSchema();
    const health = await getStorageHealth();
    return NextResponse.json({ ok: true, ...health });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
