/**
 * Capture Policy Configuration & Defaults.
 *
 * Controls telemetry minimization, inline payload thresholds, redaction strictness,
 * and content storage modes.
 */

import type { CapturePolicy } from "./types";

export const DEFAULT_CAPTURE_POLICY: CapturePolicy = {
  contentMode: "SAFE_CONTENT",
  maxInlineBytes: 4096,      // 4 KB inline threshold before referencing content blob
  maxPayloadBytes: 524288,   // 512 KB hard limit on individual payload capture
  redaction: {
    enabled: true,
    sensitiveFieldNames: [
      "password",
      "secret",
      "token",
      "apikey",
      "api_key",
      "access_token",
      "refresh_token",
      "authorization",
      "auth_token",
      "private_key",
      "secret_key",
      "credentials",
      "cookie",
      "set-cookie",
      "proxy-authorization",
    ],
    sensitiveHeaders: [
      "authorization",
      "cookie",
      "set-cookie",
      "x-api-key",
      "x-reeprov-key",
      "x-agentpulse-key",
      "api-key",
      "proxy-authorization",
    ],
    redactEnvironmentVariables: true,
  },
  hashAlgorithm: "sha256",
  failClosedOnUnknown: true,
  retention: {
    retentionDays: 30,
    allowRawPrompts: false,
  },
};

/**
 * Resolves a complete CapturePolicy by merging user overrides with defaults.
 */
export function resolvePolicy(overrides?: Partial<CapturePolicy>): CapturePolicy {
  if (!overrides) return { ...DEFAULT_CAPTURE_POLICY };

  return {
    ...DEFAULT_CAPTURE_POLICY,
    ...overrides,
    redaction: {
      ...DEFAULT_CAPTURE_POLICY.redaction,
      ...(overrides.redaction ?? {}),
      sensitiveFieldNames: [
        ...(DEFAULT_CAPTURE_POLICY.redaction.sensitiveFieldNames ?? []),
        ...(overrides.redaction?.sensitiveFieldNames ?? []),
      ],
      sensitiveHeaders: [
        ...(DEFAULT_CAPTURE_POLICY.redaction.sensitiveHeaders ?? []),
        ...(overrides.redaction?.sensitiveHeaders ?? []),
      ],
      additionalSecretPatterns: [
        ...(DEFAULT_CAPTURE_POLICY.redaction.additionalSecretPatterns ?? []),
        ...(overrides.redaction?.additionalSecretPatterns ?? []),
      ],
    },
    retention: {
      ...DEFAULT_CAPTURE_POLICY.retention,
      ...(overrides.retention ?? {}),
    },
  };
}
