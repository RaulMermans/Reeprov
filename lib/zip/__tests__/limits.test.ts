import { describe, expect, it } from "vitest";
import { defaultZipExtractLimits } from "../types";
import {
  DIRECT_ZIP_UPLOAD_MAX_BYTES,
  MAX_UNCOMPRESSED_ZIP_BYTES,
  MAX_ZIP_FILES,
} from "../limits";

describe("ZIP limit constants", () => {
  it("keeps direct ZIP uploads aligned with Vercel request body limits", () => {
    expect(DIRECT_ZIP_UPLOAD_MAX_BYTES).toBe(4 * 1024 * 1024);
  });

  it("keeps default safe extraction limits unchanged", () => {
    expect(defaultZipExtractLimits.maxUncompressedBytes).toBe(MAX_UNCOMPRESSED_ZIP_BYTES);
    expect(defaultZipExtractLimits.maxFiles).toBe(MAX_ZIP_FILES);
  });
});
