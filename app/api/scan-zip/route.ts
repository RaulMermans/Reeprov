import { NextResponse } from "next/server";
import { apiErrorResponse, invalidRequest } from "@/lib/api/errors";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { runScanPipeline } from "@/lib/reports/runScanPipeline";
import { DIRECT_ZIP_UPLOAD_MAX_BYTES, DIRECT_ZIP_UPLOAD_MAX_MB } from "@/lib/zip/limits";
import { safeExtractZip, ZipExtractionError } from "@/lib/zip/safeExtractZip";

export async function POST(request: Request) {
  try {
    requireAccessKey(request);

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      throw invalidRequest('Upload a ZIP file as multipart/form-data in the field named "zip".');
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw invalidRequest('Upload a ZIP file as multipart/form-data in the field named "zip".');
    }

    const value = formData.get("zip");

    if (!(value instanceof File)) {
      throw invalidRequest('Upload a ZIP file in the multipart field named "zip".');
    }

    const filename = value.name || "upload.zip";
    if (!filename.toLowerCase().endsWith(".zip")) {
      throw invalidRequest("Uploaded file must have a .zip filename.");
    }

    if (value.size > DIRECT_ZIP_UPLOAD_MAX_BYTES) {
      throw invalidRequest(
        `Uploaded ZIP is too large for direct Vercel upload. Maximum size is ${DIRECT_ZIP_UPLOAD_MAX_MB} MB. Use GitHub repository scanning for larger repositories.`,
      );
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
      zipStats: extracted.zipStats,
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
