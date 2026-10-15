/**
 * Bounded HttpOnly Session Security for PRIVATE_SELF_HOSTED Mode.
 *
 * Provides cryptographic HMAC-signed session tokens in HttpOnly, SameSite cookies.
 * Does not expose raw access keys to browser JS or localStorage/sessionStorage.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { type ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";

export const SESSION_COOKIE_NAME = "agentpulse_session";
export const DEFAULT_SESSION_TTL_HOURS = 24;

interface SessionPayload {
  sessionId: string;
  scope: "dashboard";
  issuedAt: number;
  expiresAt: number;
}

// In-memory invalidation set for explicit locks/logouts during server lifetime
const revokedSessionIds = new Set<string>();

let runtimeSigningSecret: string | null = null;

function getSigningSecret(): string {
  if (process.env.AGENTPULSE_SESSION_SECRET) {
    return process.env.AGENTPULSE_SESSION_SECRET;
  }
  if (process.env.AGENTPULSE_ACCESS_KEY) {
    return createHmac("sha256", "agentpulse_session_salt")
      .update(process.env.AGENTPULSE_ACCESS_KEY)
      .digest("hex");
  }
  if (!runtimeSigningSecret) {
    runtimeSigningSecret = randomBytes(32).toString("hex");
  }
  return runtimeSigningSecret;
}

/**
 * Creates a signed session token with expiration.
 */
export function createSessionToken(ttlHours = DEFAULT_SESSION_TTL_HOURS): string {
  const ttlMs = ttlHours * 60 * 60 * 1000;
  const now = Date.now();
  const payload: SessionPayload = {
    sessionId: randomBytes(16).toString("hex"),
    scope: "dashboard",
    issuedAt: now,
    expiresAt: now + ttlMs,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", getSigningSecret())
    .update(payloadB64)
    .digest("base64url");

  return `${payloadB64}.${signature}`;
}

/**
 * Validates a session token. Returns the session payload if valid, or null.
 */
export function verifySessionToken(token: string | null | undefined): SessionPayload | null {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, providedSig] = parts;

  const expectedSig = createHmac("sha256", getSigningSecret())
    .update(payloadB64)
    .digest("base64url");

  const providedBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);

  if (providedBuf.length !== expectedBuf.length) {
    return null;
  }

  if (!timingSafeEqual(providedBuf, expectedBuf)) {
    return null;
  }

  try {
    const raw = Buffer.from(payloadB64, "base64url").toString("utf8");
    const payload = JSON.parse(raw) as SessionPayload;

    if (payload.scope !== "dashboard") return null;
    if (Date.now() > payload.expiresAt) return null;
    if (revokedSessionIds.has(payload.sessionId)) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Revokes a session token so it cannot be used again before natural expiry.
 */
export function revokeSessionToken(token: string | null | undefined): void {
  const payload = verifySessionToken(token);
  if (payload) {
    revokedSessionIds.add(payload.sessionId);
  }
}

/**
 * Determines whether an incoming HTTP request is over HTTPS, directly or via a trusted reverse proxy.
 */
export function isRequestHttps(request: Request): boolean {
  if (request.url.startsWith("https:")) return true;
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) {
    const proto = forwarded.split(",")[0].trim().toLowerCase();
    if (proto === "https") return true;
  }
  return false;
}

/**
 * Returns cookie options for setting the HttpOnly session cookie.
 */
export function getSessionCookieOptions(reqOrHttps: Request | boolean = false): Partial<ResponseCookie> {
  const isHttps = typeof reqOrHttps === "boolean" ? reqOrHttps : isRequestHttps(reqOrHttps);
  const forceSecure = process.env.AGENTPULSE_FORCE_SECURE_COOKIES === "true";
  const secure = forceSecure || isHttps;
  const maxAge = DEFAULT_SESSION_TTL_HOURS * 60 * 60; // seconds
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge,
  };
}

/**
 * Extracts the session cookie value from a request.
 */
export function extractSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));

  if (!match) return null;
  return match.slice(SESSION_COOKIE_NAME.length + 1);
}
