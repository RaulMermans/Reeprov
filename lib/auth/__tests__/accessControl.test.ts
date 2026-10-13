import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorizeRequest, AccessControlError } from "../accessControl";
import { getOperatingMode, isLoopbackAddress, validateHostBinding } from "../operatingMode";
import { createSessionToken, verifySessionToken, revokeSessionToken, SESSION_COOKIE_NAME } from "../session";
import { fileIntegrationStore } from "@/lib/integrations/integrationStore";
import { hashIngestKey } from "@/lib/integrations/ingestKey";

describe("Operating Modes & Loopback Privacy Guarantee", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("defaults to personal_local mode when AGENTPULSE_MODE is unset", () => {
    delete process.env.AGENTPULSE_MODE;
    expect(getOperatingMode()).toBe("personal_local");
  });

  it("recognizes self_hosted mode variations", () => {
    process.env.AGENTPULSE_MODE = "self_hosted";
    expect(getOperatingMode()).toBe("self_hosted");

    process.env.AGENTPULSE_MODE = "private_self_hosted";
    expect(getOperatingMode()).toBe("self_hosted");
  });

  it("recognizes headless_ci mode", () => {
    process.env.AGENTPULSE_MODE = "headless_ci";
    expect(getOperatingMode()).toBe("headless_ci");
  });

  it("detects loopback addresses correctly", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("127.0.0.1:3000")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("localhost")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.50")).toBe(false);
    expect(isLoopbackAddress("0.0.0.0")).toBe(false);
    expect(isLoopbackAddress("example.com")).toBe(false);
  });

  it("rejects 0.0.0.0 binding in personal_local mode", () => {
    const res = validateHostBinding("0.0.0.0", "personal_local");
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("Loopback privacy guarantee");
  });

  it("allows 127.0.0.1 binding in personal_local mode", () => {
    const res = validateHostBinding("127.0.0.1", "personal_local");
    expect(res.valid).toBe(true);
  });
});

describe("Session Security (Bounded HttpOnly Sessions)", () => {
  it("creates and verifies valid session tokens", () => {
    const token = createSessionToken(1);
    const payload = verifySessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.scope).toBe("dashboard");
    expect(payload?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("rejects tampered session tokens", () => {
    const token = createSessionToken(1);
    const tampered = token.slice(0, -4) + "abcd";
    expect(verifySessionToken(tampered)).toBeNull();
  });

  it("revokes sessions on demand", () => {
    const token = createSessionToken(1);
    expect(verifySessionToken(token)).not.toBeNull();

    revokeSessionToken(token);
    expect(verifySessionToken(token)).toBeNull();
  });
});

describe("Centralized Access Control (authorizeRequest)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("allows HEALTH_PUBLIC without credentials in any mode", async () => {
    process.env.AGENTPULSE_MODE = "self_hosted";
    const req = new Request("http://example.com/api/health");
    const result = await authorizeRequest(req, { capability: "HEALTH_PUBLIC" });
    expect(result.authorized).toBe(true);
  });

  it("in PERSONAL_LOCAL mode, allows loopback request without credentials", async () => {
    delete process.env.AGENTPULSE_MODE; // defaults to personal_local
    delete process.env.AGENTPULSE_ACCESS_KEY;
    const req = new Request("http://127.0.0.1:3000/api/runs", {
      headers: { host: "127.0.0.1:3000" },
    });
    const result = await authorizeRequest(req, { capability: "DASHBOARD_READ" });
    expect(result.authorized).toBe(true);
    expect(result.mode).toBe("personal_local");
  });

  it("in PERSONAL_LOCAL mode, blocks remote non-loopback request", async () => {
    delete process.env.AGENTPULSE_MODE;
    const req = new Request("http://192.168.1.100:3000/api/runs", {
      headers: {
        host: "192.168.1.100:3000",
        "x-forwarded-for": "192.168.1.50",
      },
    });
    await expect(authorizeRequest(req, { capability: "DASHBOARD_READ" }))
      .rejects.toThrow(AccessControlError);
  });

  it("in PRIVATE_SELF_HOSTED mode, blocks unauthenticated request", async () => {
    process.env.AGENTPULSE_MODE = "self_hosted";
    process.env.AGENTPULSE_ACCESS_KEY = "super-secret-key";

    const req = new Request("http://example.com/api/runs", {
      headers: { host: "example.com" },
    });
    await expect(authorizeRequest(req, { capability: "DASHBOARD_READ" }))
      .rejects.toThrow(AccessControlError);
  });

  it("in PRIVATE_SELF_HOSTED mode, allows request with valid session cookie", async () => {
    process.env.AGENTPULSE_MODE = "self_hosted";
    process.env.AGENTPULSE_ACCESS_KEY = "super-secret-key";

    const token = createSessionToken();
    const req = new Request("http://example.com/api/runs", {
      headers: {
        host: "example.com",
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });
    const result = await authorizeRequest(req, { capability: "DASHBOARD_READ" });
    expect(result.authorized).toBe(true);
  });

  it("in PRIVATE_SELF_HOSTED mode, allows request with valid access key header", async () => {
    process.env.AGENTPULSE_MODE = "self_hosted";
    process.env.AGENTPULSE_ACCESS_KEY = "super-secret-key";

    const req = new Request("http://example.com/api/runs", {
      headers: {
        host: "example.com",
        "x-agentpulse-key": "super-secret-key",
      },
    });
    const result = await authorizeRequest(req, { capability: "DASHBOARD_WRITE" });
    expect(result.authorized).toBe(true);
  });

  it("strictly isolates ingest keys: ap_live_ keys cannot access DASHBOARD_READ", async () => {
    process.env.AGENTPULSE_MODE = "personal_local";
    const req = new Request("http://127.0.0.1:3000/api/runs", {
      headers: {
        host: "127.0.0.1:3000",
        "x-agentpulse-key": "ap_live_0123456789abcdef0123456789abcdef",
      },
    });
    await expect(authorizeRequest(req, { capability: "DASHBOARD_READ" }))
      .rejects.toThrow("Ingest keys cannot be used to access dashboard or management APIs.");
  });

  it("authorizes INGEST with scoped ingest key matching projectId", async () => {
    // create integration with ingest key
    const integ = await fileIntegrationStore.createIntegration({
      projectId: "test-auth-proj",
      projectName: "Test Auth Project",
    });
    const keyResult = await fileIntegrationStore.generateIngestKey(integ.integrationId);
    expect(keyResult).not.toBeNull();
    const rawKey = keyResult!.rawKey;

    const req = new Request("http://127.0.0.1:3000/api/traces/events", {
      headers: {
        "x-agentpulse-key": rawKey,
      },
    });

    const result = await authorizeRequest(req, {
      capability: "INGEST",
      projectId: "test-auth-proj",
    });
    expect(result.authorized).toBe(true);
    expect(result.projectId).toBe("test-auth-proj");
  });

  it("rejects INGEST if scoped key belongs to Project A but request is for Project B", async () => {
    const integA = await fileIntegrationStore.createIntegration({
      projectId: "proj-alpha",
      projectName: "Project Alpha",
    });
    const keyResult = await fileIntegrationStore.generateIngestKey(integA.integrationId);
    const rawKey = keyResult!.rawKey;

    const req = new Request("http://127.0.0.1:3000/api/traces/events", {
      headers: {
        "x-agentpulse-key": rawKey,
      },
    });

    await expect(authorizeRequest(req, {
      capability: "INGEST",
      projectId: "proj-beta",
    })).rejects.toThrow("cannot operate on project 'proj-beta'");
  });
});
