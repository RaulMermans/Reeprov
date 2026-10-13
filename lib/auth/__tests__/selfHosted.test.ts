import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorizeRequest, AccessControlError } from "../accessControl";
import { createSessionToken, revokeSessionToken, SESSION_COOKIE_NAME } from "../session";

function createMockRequest(
  url: string,
  options?: { headers?: Record<string, string>; method?: string }
): Request {
  const headers = new Headers(options?.headers || {});
  if (!headers.has("host")) headers.set("host", "example.com:3000");
  return new Request(url, {
    method: options?.method || "GET",
    headers,
  });
}

describe("SELF_HOSTED Mode Access Control (Sprint Item 6)", () => {
  const originalEnv = { ...process.env };
  const TEST_ACCESS_KEY = "test-selfhosted-access-key-12345";

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.AGENTPULSE_MODE = "self_hosted";
    process.env.AGENTPULSE_ACCESS_KEY = TEST_ACCESS_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("1. self_hosted + no credentials → 401 unauthorized_session", async () => {
    const req = createMockRequest("http://example.com:3000/api/runs");

    await expect(authorizeRequest(req, { capability: "DASHBOARD_READ" }))
      .rejects.toThrow(AccessControlError);

    try {
      await authorizeRequest(req, { capability: "DASHBOARD_READ" });
    } catch (err) {
      const error = err as AccessControlError;
      expect(error.status).toBe(401);
      expect(error.code).toBe("unauthorized_session");
      expect(error.message).toContain("Authentication required");
    }
  });

  it("2. self_hosted + valid session cookie → authorized", async () => {
    const token = createSessionToken();
    const req = createMockRequest("http://example.com:3000/api/runs", {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });

    const result = await authorizeRequest(req, { capability: "DASHBOARD_READ" });
    expect(result.authorized).toBe(true);
    expect(result.mode).toBe("self_hosted");
    expect(result.capability).toBe("DASHBOARD_READ");
  });

  it("3. self_hosted + valid access key header → authorized", async () => {
    const req = createMockRequest("http://example.com:3000/api/runs", {
      headers: {
        "x-agentpulse-key": TEST_ACCESS_KEY,
      },
    });

    const result = await authorizeRequest(req, { capability: "DASHBOARD_WRITE" });
    expect(result.authorized).toBe(true);
    expect(result.mode).toBe("self_hosted");
    expect(result.capability).toBe("DASHBOARD_WRITE");
  });

  it("3b. self_hosted + valid access key via Authorization Bearer header → authorized", async () => {
    const req = createMockRequest("http://example.com:3000/api/runs", {
      headers: {
        authorization: `Bearer ${TEST_ACCESS_KEY}`,
      },
    });

    const result = await authorizeRequest(req, { capability: "DASHBOARD_READ" });
    expect(result.authorized).toBe(true);
    expect(result.mode).toBe("self_hosted");
  });

  it("4. self_hosted + invalid session → 401 unauthorized_session", async () => {
    const req = createMockRequest("http://example.com:3000/api/runs", {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=invalid.tampered.token`,
      },
    });

    await expect(authorizeRequest(req, { capability: "DASHBOARD_READ" }))
      .rejects.toThrow(AccessControlError);

    try {
      await authorizeRequest(req, { capability: "DASHBOARD_READ" });
    } catch (err) {
      const error = err as AccessControlError;
      expect(error.status).toBe(401);
      expect(error.code).toBe("unauthorized_session");
    }
  });

  it("4b. self_hosted + revoked session token → 401 unauthorized_session", async () => {
    const token = createSessionToken();
    revokeSessionToken(token);

    const req = createMockRequest("http://example.com:3000/api/runs", {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });

    await expect(authorizeRequest(req, { capability: "DASHBOARD_READ" }))
      .rejects.toThrow(AccessControlError);
  });

  it("5. self_hosted + ingest key on dashboard → 403 ingest_key_disallowed", async () => {
    const req = createMockRequest("http://example.com:3000/api/runs", {
      headers: {
        "x-agentpulse-key": "ap_live_deadbeef0123456789deadbeef012345",
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

  it("6. self_hosted + session works for compare, eval, regression APIs", async () => {
    const token = createSessionToken();
    const cookieHeader = { cookie: `${SESSION_COOKIE_NAME}=${token}` };

    // Compare API
    const compareReq = createMockRequest("http://example.com:3000/api/runs/compare", {
      headers: cookieHeader,
    });
    const compareResult = await authorizeRequest(compareReq, { capability: "DASHBOARD_READ" });
    expect(compareResult.authorized).toBe(true);

    // Eval API
    const evalReq = createMockRequest("http://example.com:3000/api/evals/suites", {
      headers: cookieHeader,
    });
    const evalResult = await authorizeRequest(evalReq, { capability: "DASHBOARD_READ" });
    expect(evalResult.authorized).toBe(true);

    // Regression Baselines API
    const baselineReq = createMockRequest("http://example.com:3000/api/baselines", {
      headers: cookieHeader,
      method: "POST",
    });
    const baselineResult = await authorizeRequest(baselineReq, { capability: "DASHBOARD_WRITE" });
    expect(baselineResult.authorized).toBe(true);

    // Regression Gate API
    const gateReq = createMockRequest("http://example.com:3000/api/regressions/gate", {
      headers: cookieHeader,
      method: "POST",
    });
    const gateResult = await authorizeRequest(gateReq, { capability: "DASHBOARD_WRITE" });
    expect(gateResult.authorized).toBe(true);

    // Experiments API
    const experimentReq = createMockRequest("http://example.com:3000/api/experiments/plan", {
      headers: cookieHeader,
      method: "POST",
    });
    const experimentResult = await authorizeRequest(experimentReq, { capability: "DASHBOARD_WRITE" });
    expect(experimentResult.authorized).toBe(true);
  });

  it("supports 'private_self_hosted' alias identically", async () => {
    process.env.AGENTPULSE_MODE = "private_self_hosted";
    const token = createSessionToken();

    const req = createMockRequest("http://example.com:3000/api/runs", {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });

    const result = await authorizeRequest(req, { capability: "DASHBOARD_READ" });
    expect(result.authorized).toBe(true);
    expect(result.mode).toBe("self_hosted");
  });
});
