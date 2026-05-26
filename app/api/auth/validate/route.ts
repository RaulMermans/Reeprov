import { NextResponse } from "next/server";
import { AccessKeyError, requireAccessKey } from "@/lib/auth/requireAccessKey";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    requireAccessKey(request);
  } catch (error) {
    if (error instanceof AccessKeyError) {
      return NextResponse.json({ ok: false, error: "Invalid access key." }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: "Invalid access key." }, { status: 401 });
  }

  return NextResponse.json({ ok: true, scope: "dashboard" }, { status: 200 });
}
