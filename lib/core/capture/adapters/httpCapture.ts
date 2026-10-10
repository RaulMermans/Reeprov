/**
 * HTTP Boundary Capture Adapter.
 *
 * Captures external HTTP requests, sanitizes authorization headers, cookies,
 * query credentials, and body payloads, and produces ExecutionBoundary records.
 */

import { normalizeBoundary } from "../normalizeBoundary";
import { resolvePolicy } from "../policy";
import type { HttpCaptureInput, HttpCaptureResult, CapturePolicy } from "../types";

/**
 * Normalizes and sanitizes a target URL.
 * Strips basic auth passwords and secret query parameters.
 */
export function sanitizeUrl(rawUrl: string): { sanitizedUrl: string; host: string } {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.host;
    if (parsed.password) {
      parsed.password = "[REDACTED]";
    }
    const sensitiveQueryParams = [
      "api_key",
      "apikey",
      "token",
      "access_token",
      "secret",
      "key",
      "password",
      "sig",
      "signature",
    ];
    for (const param of sensitiveQueryParams) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, "[REDACTED]");
      }
    }
    return { sanitizedUrl: parsed.toString(), host };
  } catch {
    // If not a full URL or relative, return as-is
    return { sanitizedUrl: rawUrl, host: "unknown" };
  }
}

/**
 * Captures an external HTTP request and produces an ExecutionBoundary record.
 */
export async function captureHttpCall(
  input: HttpCaptureInput,
  policyOverrides?: Partial<CapturePolicy>
): Promise<HttpCaptureResult> {
  const policy = resolvePolicy(policyOverrides);
  const startedAt = input.startedAt;
  const completedAt = input.completedAt || new Date().toISOString();
  const durationMs =
    input.durationMs ??
    Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());

  const { sanitizedUrl, host } = sanitizeUrl(input.url);
  const method = (input.method || "GET").toUpperCase();

  // Redact request headers
  const sanitizedHeaders: Record<string, string> = {};
  if (input.headers) {
    for (const [k, v] of Object.entries(input.headers)) {
      const lower = k.toLowerCase();
      if (
        lower === "authorization" ||
        lower === "cookie" ||
        lower === "set-cookie" ||
        lower.includes("key") ||
        lower.includes("secret") ||
        lower.includes("token")
      ) {
        sanitizedHeaders[k] = "[REDACTED_HEADER]";
      } else {
        sanitizedHeaders[k] = v;
      }
    }
  }

  // Redact response headers
  const sanitizedResponseHeaders: Record<string, string> = {};
  if (input.responseHeaders) {
    for (const [k, v] of Object.entries(input.responseHeaders)) {
      const lower = k.toLowerCase();
      if (lower === "set-cookie" || lower === "authorization") {
        sanitizedResponseHeaders[k] = "[REDACTED_HEADER]";
      } else {
        sanitizedResponseHeaders[k] = v;
      }
    }
  }

  const boundary = await normalizeBoundary(
    {
      runId: input.runId,
      stepId: input.stepId,
      nodeId: input.nodeId,
      boundaryType: "external_http",
      name: `${method} ${sanitizedUrl}`,
      startedAt,
      completedAt,
      durationMs,
      input: {
        method,
        url: sanitizedUrl,
        headers: sanitizedHeaders,
        body: input.body,
      },
      output: {
        status: input.status,
        headers: sanitizedResponseHeaders,
        body: input.responseBody,
      },
      error: input.error,
      dependencyIdentity: `http:${host}`,
      metadata: {
        method,
        host,
        status: input.status,
        retry_attempt: input.retryAttempt,
      },
    },
    policy
  );

  return { boundary };
}
