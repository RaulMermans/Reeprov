import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  verifySessionToken,
  revokeSessionToken,
  getSessionCookieOptions,
  extractSessionToken,
  isRequestHttps,
  SESSION_COOKIE_NAME,
  DEFAULT_SESSION_TTL_HOURS,
} from "../session";

describe("Session Security & Cryptographic Integrity (Sprint Items 14, 31)", () => {
  it("1. creates and verifies a valid session token", () => {
    const token = createSessionToken();
    expect(typeof token).toBe("string");
    expect(token).toContain(".");

    const parts = token.split(".");
    expect(parts.length).toBe(2);

    const payload = verifySessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.scope).toBe("dashboard");
    expect(payload?.sessionId).toBeDefined();
    expect(typeof payload?.issuedAt).toBe("number");
    expect(typeof payload?.expiresAt).toBe("number");
    expect(payload!.expiresAt).toBeGreaterThan(payload!.issuedAt);
  });

  it("2. rejects expired session tokens", () => {
    // Generate a token with negative TTL (-1 hour)
    const expiredToken = createSessionToken(-1);
    const result = verifySessionToken(expiredToken);
    expect(result).toBeNull();
  });

  it("3. rejects tampered payload", () => {
    const token = createSessionToken();
    const [payloadB64, sig] = token.split(".");

    // Tamper with base64 payload
    const raw = Buffer.from(payloadB64, "base64url").toString("utf8");
    const json = JSON.parse(raw);
    json.scope = "admin_super";
    const tamperedPayloadB64 = Buffer.from(JSON.stringify(json)).toString("base64url");
    const tamperedToken = `${tamperedPayloadB64}.${sig}`;

    const result = verifySessionToken(tamperedToken);
    expect(result).toBeNull();
  });

  it("4. rejects tampered signature", () => {
    const token = createSessionToken();
    const [payloadB64, sig] = token.split(".");

    // Flip last character of signature
    const corruptChar = sig.endsWith("a") ? "b" : "a";
    const corruptedSig = sig.slice(0, -1) + corruptChar;
    const tamperedToken = `${payloadB64}.${corruptedSig}`;

    const result = verifySessionToken(tamperedToken);
    expect(result).toBeNull();
  });

  it("5. rejects malformed tokens", () => {
    expect(verifySessionToken(null)).toBeNull();
    expect(verifySessionToken(undefined)).toBeNull();
    expect(verifySessionToken("")).toBeNull();
    expect(verifySessionToken("not-a-token")).toBeNull();
    expect(verifySessionToken("one.two.three")).toBeNull();
  });

  it("6. tracks session revocation (logout / lock invalidation)", () => {
    const token = createSessionToken();
    expect(verifySessionToken(token)).not.toBeNull();

    // Revoke
    revokeSessionToken(token);

    // Verify revoked
    expect(verifySessionToken(token)).toBeNull();
  });

  it("7. getSessionCookieOptions configures HttpOnly, SameSite, and TTL correctly", () => {
    const opts = getSessionCookieOptions(false);
    expect(opts.name).toBe(SESSION_COOKIE_NAME);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
    expect(opts.maxAge).toBe(DEFAULT_SESSION_TTL_HOURS * 3600);
  });

  it("8. getSessionCookieOptions enables secure flag in HTTPS / production", () => {
    const secureOpts = getSessionCookieOptions(true);
    expect(secureOpts.secure).toBe(true);
  });

  it("9. extractSessionToken parses cookie header accurately", () => {
    const token = createSessionToken();
    const reqWithCookie = new Request("http://localhost:3000/api/auth/session", {
      headers: {
        cookie: `other=foo; ${SESSION_COOKIE_NAME}=${token}; test=bar`,
      },
    });

    const extracted = extractSessionToken(reqWithCookie);
    expect(extracted).toBe(token);

    const reqWithoutCookie = new Request("http://localhost:3000/api/auth/session");
    expect(extractSessionToken(reqWithoutCookie)).toBeNull();
  });

  it("10. isRequestHttps detects direct HTTPS and reverse proxy X-Forwarded-Proto header", () => {
    const directHttps = new Request("https://agentpulse.example.com/api/auth/session");
    expect(isRequestHttps(directHttps)).toBe(true);

    const directHttp = new Request("http://localhost:3000/api/auth/session");
    expect(isRequestHttps(directHttp)).toBe(false);

    const proxyHttps = new Request("http://127.0.0.1:3000/api/auth/session", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(isRequestHttps(proxyHttps)).toBe(true);

    const proxyMultiProto = new Request("http://127.0.0.1:3000/api/auth/session", {
      headers: { "x-forwarded-proto": "https, http" },
    });
    expect(isRequestHttps(proxyMultiProto)).toBe(true);

    const proxyHttp = new Request("http://127.0.0.1:3000/api/auth/session", {
      headers: { "x-forwarded-proto": "http" },
    });
    expect(isRequestHttps(proxyHttp)).toBe(false);
  });

  it("11. getSessionCookieOptions prevents silent cookie drops on direct HTTP but enables secure over reverse-proxy HTTPS", () => {
    const httpReq = new Request("http://127.0.0.1:3000/api/auth/unlock");
    const httpOpts = getSessionCookieOptions(httpReq);
    expect(httpOpts.secure).toBe(false);

    const proxyHttpsReq = new Request("http://127.0.0.1:3000/api/auth/unlock", {
      headers: { "x-forwarded-proto": "https" },
    });
    const proxyOpts = getSessionCookieOptions(proxyHttpsReq);
    expect(proxyOpts.secure).toBe(true);
  });
});
