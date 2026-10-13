import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorizeRequest, AccessControlError } from "../accessControl";

function createMockRequest(
  url: string,
  options?: { headers?: Record<string, string>; method?: string }
): Request {
  const headers = new Headers(options?.headers || {});
  if (!headers.has("host")) headers.set("host", "127.0.0.1:3000");
  return new Request(url, {
    method: options?.method || "GET",
    headers,
  });
}

describe("PERSONAL_LOCAL Mode Access Control (Sprint Item 5)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Explicitly test personal_local mode (both default and explicit)
    delete process.env.AGENTPULSE_MODE;
    delete process.env.AGENTPULSE_ACCESS_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("1. PERSONAL_LOCAL + loopback request → authorized without key for DASHBOARD_READ", async () => {
    const req = createMockRequest("http://127.0.0.1:3000/api/runs");
    const result = await authorizeRequest(req, { capability: "DASHBOARD_READ" });

    expect(result.authorized).toBe(true);
    expect(result.mode).toBe("personal_local");
    expect(result.capability).toBe("DASHBOARD_READ");
  });

  it("2. PERSONAL_LOCAL + loopback request → authorized without key for DASHBOARD_WRITE", async () => {
    const req = createMockRequest("http://127.0.0.1:3000/api/projects", { method: "POST" });
    const result = await authorizeRequest(req, { capability: "DASHBOARD_WRITE" });

    expect(result.authorized).toBe(true);
    expect(result.mode).toBe("personal_local");
    expect(result.capability).toBe("DASHBOARD_WRITE");
  });

  it("3. PERSONAL_LOCAL + loopback request → authorized without key for ADMIN", async () => {
    const req = createMockRequest("http://127.0.0.1:3000/api/admin/migrate", { method: "POST" });
    const result = await authorizeRequest(req, { capability: "ADMIN" });

    expect(result.authorized).toBe(true);
    expect(result.mode).toBe("personal_local");
    expect(result.capability).toBe("ADMIN");
  });

  it("4. PERSONAL_LOCAL + non-loopback request → 403 loopback_required", async () => {
    const req = createMockRequest("http://192.168.1.100:3000/api/runs", {
      headers: {
        host: "192.168.1.100:3000",
        "x-forwarded-for": "192.168.1.50",
      },
    });

    await expect(authorizeRequest(req, { capability: "DASHBOARD_READ" }))
      .rejects.toThrow(AccessControlError);

    try {
      await authorizeRequest(req, { capability: "DASHBOARD_READ" });
    } catch (err) {
      const error = err as AccessControlError;
      expect(error.status).toBe(403);
      expect(error.code).toBe("loopback_required");
      expect(error.message).toContain("Loopback privacy guarantee");
    }
  });

  it("5. PERSONAL_LOCAL + ingest key for DASHBOARD_READ → 403 ingest_key_disallowed", async () => {
    const req = createMockRequest("http://127.0.0.1:3000/api/runs", {
      headers: {
        "x-agentpulse-key": "ap_live_0123456789abcdef0123456789abcdef",
      },
    });

    await expect(authorizeRequest(req, { capability: "DASHBOARD_READ" }))
      .rejects.toThrow(AccessControlError);

    try {
      await authorizeRequest(req, { capability: "DASHBOARD_READ" });
    } catch (err) {
      const error = err as AccessControlError;
      expect(error.status).toBe(403);
      expect(error.code).toBe("ingest_key_disallowed");
      expect(error.message).toContain("Ingest keys cannot be used to access dashboard or management APIs.");
    }
  });

  it("supports loopback host localhost and [::1]", async () => {
    const reqLocalhost = createMockRequest("http://localhost:3000/api/runs", {
      headers: { host: "localhost:3000" },
    });
    const result1 = await authorizeRequest(reqLocalhost, { capability: "DASHBOARD_READ" });
    expect(result1.authorized).toBe(true);

    const reqIpv6 = createMockRequest("http://[::1]:3000/api/runs", {
      headers: { host: "[::1]:3000" },
    });
    const result2 = await authorizeRequest(reqIpv6, { capability: "DASHBOARD_READ" });
    expect(result2.authorized).toBe(true);
  });

  it("rejects spoofed Host header when x-forwarded-for is non-loopback", async () => {
    const req = createMockRequest("http://127.0.0.1:3000/api/runs", {
      headers: {
        host: "127.0.0.1:3000",
        "x-forwarded-for": "10.0.0.5",
      },
    });

    await expect(authorizeRequest(req, { capability: "DASHBOARD_READ" }))
      .rejects.toThrow(AccessControlError);

    try {
      await authorizeRequest(req, { capability: "DASHBOARD_READ" });
    } catch (err) {
      const error = err as AccessControlError;
      expect(error.status).toBe(403);
      expect(error.code).toBe("loopback_required");
    }
  });

  it("rejects spoofed Host header when x-real-ip is non-loopback", async () => {
    const req = createMockRequest("http://127.0.0.1:3000/api/runs", {
      headers: {
        host: "127.0.0.1:3000",
        "x-real-ip": "172.16.0.10",
      },
    });

    await expect(authorizeRequest(req, { capability: "DASHBOARD_READ" }))
      .rejects.toThrow(AccessControlError);

    try {
      await authorizeRequest(req, { capability: "DASHBOARD_READ" });
    } catch (err) {
      const error = err as AccessControlError;
      expect(error.status).toBe(403);
      expect(error.code).toBe("loopback_required");
    }
  });

  it("applies loopback guarantee when AGENTPULSE_MODE='personal_local' explicitly set", async () => {
    process.env.AGENTPULSE_MODE = "personal_local";
    const req = createMockRequest("http://127.0.0.1:3000/api/runs");
    const result = await authorizeRequest(req, { capability: "DASHBOARD_READ" });
    expect(result.authorized).toBe(true);
    expect(result.mode).toBe("personal_local");
  });
});
