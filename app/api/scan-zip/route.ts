import { NextResponse } from "next/server";
import { apiErrorResponse, invalidRequest } from "@/lib/api/errors";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { runScanPipeline } from "@/lib/reports/runScanPipeline";
import { defaultZipExtractLimits } from "@/lib/zip/types";
import { safeExtractZip, ZipExtractionError } from "@/lib/zip/safeExtractZip";

export async function POST(request: Request) {
  try {
    requireAccessKey(request);

    const formData = await request.formData();
    const value = formData.get("zip");

    if (!(value instanceof File)) {
      throw invalidRequest('Upload a ZIP file in the multipart field named "zip".');
    }

    const filename = value.name || "upload.zip";
    if (!filename.toLowerCase().endsWith(".zip")) {
      throw invalidRequest("Uploaded file must have a .zip filename.");
    }

    if (value.size > defaultZipExtractLimits.maxZipBytes) {
      throw invalidRequest("Uploaded ZIP is too large. Maximum size is 15 MB.");
    }

    const extracted = await safeExtractZip(await value.arrayBuffer());
    const report = await runScanPipeline({
      repoName: filename,
      files: extracted.files,
      scanSource: {
        type: "zip",
        label: filename,
        filename,
      },
      allowLlmAuditors: true,
    });

    return NextResponse.json(report);
  } catch (error) {
    if (error instanceof ZipExtractionError) {
      return apiErrorResponse(invalidRequest(error.message));
    }

    return apiErrorResponse(error);
  }
}
