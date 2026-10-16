import { describe, expect, it } from "vitest";
import {
  constantTimeEqualHash,
  generateRawIngestKey,
  hashIngestKey,
  previewIngestKey,
} from "@/lib/integrations/ingestKey";

describe("ingestKey helpers", () => {
  it("generates keys with the ree_live_ prefix and sufficient entropy", () => {
    const a = generateRawIngestKey();
    const b = generateRawIngestKey();
    expect(a).toMatch(/^ree_live_[0-9a-f]{48}$/);
    expect(a).not.toBe(b);
  });

  it("hashes deterministically for the same input", () => {
    const key = generateRawIngestKey();
    expect(hashIngestKey(key)).toBe(hashIngestKey(key));
  });

  it("produces different hashes for different keys", () => {
    expect(hashIngestKey(generateRawIngestKey())).not.toBe(hashIngestKey(generateRawIngestKey()));
  });

  it("preview never contains the full raw key", () => {
    const key = generateRawIngestKey();
    const preview = previewIngestKey(key);
    expect(preview).not.toBe(key);
    expect(preview.startsWith("ree_live_...")).toBe(true);
    expect(preview.length).toBeLessThan(key.length);

    // Also supports legacy ap_live_ keys
    const legacyKey = "ap_live_123456789012345678901234567890123456789012345678";
    const legacyPreview = previewIngestKey(legacyKey);
    expect(legacyPreview.startsWith("ap_live_...")).toBe(true);
  });

  it("constantTimeEqualHash matches identical hashes and rejects different ones", () => {
    const hashA = hashIngestKey("key-a");
    const hashB = hashIngestKey("key-b");
    expect(constantTimeEqualHash(hashA, hashA)).toBe(true);
    expect(constantTimeEqualHash(hashA, hashB)).toBe(false);
  });
});
