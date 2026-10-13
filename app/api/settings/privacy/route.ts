import { NextRequest, NextResponse } from "next/server";
import { getPrivacyPosture } from "@/lib/storage/dataPath";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { apiErrorResponse } from "@/lib/api/errors";

export async function GET(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const posture = getPrivacyPosture();
    return NextResponse.json(posture);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
