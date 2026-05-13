import { afterEach, describe, expect, it } from "vitest";
import { DIRECT_ZIP_UPLOAD_MAX_BYTES } from "@/lib/zip/limits";
import { POST } from "./route";

const originalAccessKey = process.env.AGENTPULSE_ACCESS_KEY;

afterEach(() => {
  process.env.AGENTPULSE_ACCESS_KEY = originalAccessKey;
});

describe("/api/scan-zip", () => {
  it("returns 401 without access key", async () => {
    process.env.AGENTPULSE_ACCESS_KEY = "test-key";
    const response = await POST(new Request("http://localhost/api/scan-zip", {
      method: "POST",
      body: new FormData(),
    }));

    expect(response.status).toBe(401);
  });

  it("returns 400 without file", async () => {
    process.env.AGENTPULSE_ACCESS_KEY = "test-key";
    const response = await POST(new Request("http://localhost/api/scan-zip", {
      method: "POST",
      headers: { "x-agentpulse-key": "test-key" },
      body: new FormData(),
    }));

    expect(response.status).toBe(400);
  });

  it("returns 400 for invalid file type", async () => {
    process.env.AGENTPULSE_ACCESS_KEY = "test-key";
    const form = new FormData();
    form.set("zip", new File(["not a zip"], "repo.txt", { type: "text/plain" }));

    const response = await POST(new Request("http://localhost/api/scan-zip", {
      method: "POST",
      headers: { "x-agentpulse-key": "test-key" },
      body: form,
    }));

    expect(response.status).toBe(400);
  });

  it("returns 400 for ZIP files over the direct Vercel upload limit", async () => {
    process.env.AGENTPULSE_ACCESS_KEY = "test-key";
    const form = new FormData();
    form.set("zip", new File([new Uint8Array(DIRECT_ZIP_UPLOAD_MAX_BYTES + 1)], "repo.zip", { type: "application/zip" }));

    const response = await POST(new Request("http://localhost/api/scan-zip", {
      method: "POST",
      headers: { "x-agentpulse-key": "test-key" },
      body: form,
    }));
    const body = await response.json() as { message?: string };

    expect(response.status).toBe(400);
    expect(body.message).toContain("4 MB");
    expect(body.message).toContain("GitHub repository scanning");
  });
});
