/**
 * Mandatory Server-Side Secret Sanitization & Telemetry Minimization Pipeline.
 *
 * Scans all boundary inputs, outputs, headers, and metadata to scrub secrets,
 * tokens, API keys, credentials, and sensitive headers before storage.
 *
 * Invariant: Never log raw secrets. Never persist unredacted secrets even in FULL_CONTENT mode.
 */

import { hashPayload } from "./hashing";
import type { CapturePolicy, RedactionResult, ContentCaptureMode } from "./types";
import { DEFAULT_CAPTURE_POLICY } from "./policy";
import type { RedactionStatus } from "../contracts/replay";

// ── Secret Patterns ─────────────────────────────────────────────────────────

export const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Anthropic API keys (must precede generic sk- pattern)
  { pattern: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/g, replacement: "[REDACTED_ANTHROPIC_KEY]" },
  // OpenAI standard & project keys
  { pattern: /\bsk-[a-zA-Z0-9_-]{20,}\b/g, replacement: "[REDACTED_OPENAI_KEY]" },
  // GitHub Personal Access Tokens (classic, fine-grained, app, oauth)
  {
    pattern: /\b(?:gh[pousr]_[a-zA-Z0-9]{36,}|github_pat_[a-zA-Z0-9_]{36,})\b/g,
    replacement: "[REDACTED_GITHUB_TOKEN]",
  },
  // AWS Access Key ID
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[REDACTED_AWS_KEY]" },
  // Bearer Token in strings
  { pattern: /\bBearer\s+[a-zA-Z0-9_.~+/-]{16,}=*/gi, replacement: "Bearer [REDACTED_BEARER_TOKEN]" },
  // Private Key blocks (PEM)
  {
    pattern: /-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+)?PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },
  // DB & service URLs with passwords: proto://user:password@host
  {
    pattern: /((?:https?|postgres|postgresql|mysql|mongodb|redis):\/\/[^:\s]+:)([^@\s]+)(@)/gi,
    replacement: "$1[REDACTED_CREDENTIALS]$3",
  },
  // URL secret query parameters: ?key=..., &token=...
  {
    pattern: /([?&](?:api_key|apikey|token|access_token|refresh_token|secret|password|sig|signature)=)([^&#\s]+)/gi,
    replacement: "$1[REDACTED_QUERY_PARAM]",
  },
];

// ── Environment variable value scrubber ────────────────────────────────────

function getSensitiveEnvValues(): string[] {
  const sensitiveEnvNames = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GITHUB_TOKEN",
    "REEPROV_INGEST_KEY",
    "REEPROV_ACCESS_KEY",
    "AGENTPULSE_INGEST_KEY",
    "AGENTPULSE_ACCESS_KEY",
    "DATABASE_URL",
    "AWS_SECRET_ACCESS_KEY",
    "STRIPE_API_KEY",
    "PINECONE_API_KEY",
  ];
  const values: string[] = [];
  for (const name of sensitiveEnvNames) {
    const val = process.env[name];
    if (val && typeof val === "string" && val.length >= 8) {
      values.push(val);
    }
  }
  return values;
}

/**
 * Sanitizes a raw string using regex secret patterns and optional env values.
 */
export function sanitizeString(
  text: string,
  additionalPatterns: RegExp[] = [],
  redactEnv = true
): { sanitized: string; redacted: boolean; matches: string[] } {
  if (!text || typeof text !== "string") {
    return { sanitized: text, redacted: false, matches: [] };
  }

  let result = text;
  let didRedact = false;
  const matches: string[] = [];

  for (const { pattern, replacement } of SECRET_PATTERNS) {
    // Reset regex index if global
    pattern.lastIndex = 0;
    if (pattern.test(result)) {
      didRedact = true;
      matches.push(replacement);
      result = result.replace(pattern, replacement);
    }
  }

  for (const customPattern of additionalPatterns) {
    customPattern.lastIndex = 0;
    if (customPattern.test(result)) {
      didRedact = true;
      matches.push("[REDACTED_CUSTOM]");
      result = result.replace(customPattern, "[REDACTED_CUSTOM]");
    }
  }

  if (redactEnv) {
    for (const secretVal of getSensitiveEnvValues()) {
      if (result.includes(secretVal)) {
        didRedact = true;
        matches.push("[REDACTED_ENV_SECRET]");
        result = result.split(secretVal).join("[REDACTED_ENV_SECRET]");
      }
    }
  }

  return { sanitized: result, redacted: didRedact, matches };
}

/**
 * Checks whether an object key name represents a sensitive field.
 */
export function isSensitiveKey(key: string, sensitiveList: string[]): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, "");
  return sensitiveList.some((sensitive) => {
    const normSensitive = sensitive.toLowerCase().replace(/[-_]/g, "");
    return normalized === normSensitive || normalized.includes(normSensitive);
  });
}

/**
 * Checks whether an HTTP header name represents a sensitive header.
 */
export function isSensitiveHeader(headerName: string, sensitiveHeaders: string[]): boolean {
  const normalized = headerName.toLowerCase();
  return sensitiveHeaders.some((h) => h.toLowerCase() === normalized);
}

// ── Recursive Sanitizer ─────────────────────────────────────────────────────

function sanitizeValue(
  value: unknown,
  policy: CapturePolicy,
  fieldsRedacted: Set<string>,
  seen = new WeakSet<object>()
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    const { sanitized, redacted, matches } = sanitizeString(
      value,
      policy.redaction.additionalSecretPatterns ?? [],
      policy.redaction.redactEnvironmentVariables ?? true
    );
    if (redacted) {
      matches.forEach((m) => fieldsRedacted.add(m));
    }
    return sanitized;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);

    try {
      if (Array.isArray(value)) {
        return value.map((item) => sanitizeValue(item, policy, fieldsRedacted, seen));
      }

      const result: Record<string, unknown> = {};
      const obj = value as Record<string, unknown>;

      for (const [k, v] of Object.entries(obj)) {
        // If already redacted marker, preserve it
        if (typeof v === "string" && v.startsWith("[REDACTED_")) {
          result[k] = v;
          continue;
        }

        // 1. Check if key is sensitive header or field
        const isHeader = isSensitiveHeader(k, policy.redaction.sensitiveHeaders ?? []);
        const isField = isSensitiveKey(k, policy.redaction.sensitiveFieldNames ?? []);

        if (isHeader || isField) {
          fieldsRedacted.add(k);
          result[k] = "[REDACTED_SECRET]";
          continue;
        }

        // 2. Otherwise recurse
        result[k] = sanitizeValue(v, policy, fieldsRedacted, seen);
      }

      return result;
    } finally {
      seen.delete(value);
    }
  }

  return String(value);
}

// ── Structure-Only Reducer ──────────────────────────────────────────────────

function reduceToStructure(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[TruncatedDepth]";
  if (value === null) return { type: "null" };
  if (value === undefined) return { type: "undefined" };
  if (typeof value === "string") return { type: "string", length: value.length };
  if (typeof value === "number") return { type: "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      sample: value.length > 0 ? reduceToStructure(value[0], depth + 1) : undefined,
    };
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    const shape: Record<string, unknown> = {};
    for (const key of keys.slice(0, 20)) {
      shape[key] = reduceToStructure((value as Record<string, unknown>)[key], depth + 1);
    }
    return { type: "object", keys, shape };
  }
  return { type: typeof value };
}

// ── Public Pipeline ─────────────────────────────────────────────────────────

export interface SanitizeOptions {
  policy?: Partial<CapturePolicy>;
  modeOverride?: ContentCaptureMode;
}

/**
 * Sanitizes any payload according to the capture policy and content mode.
 */
export function sanitizePayload<T = unknown>(
  payload: T,
  options: SanitizeOptions = {}
): RedactionResult<T> {
  const policy: CapturePolicy = {
    ...DEFAULT_CAPTURE_POLICY,
    ...(options.policy ?? {}),
    redaction: {
      ...DEFAULT_CAPTURE_POLICY.redaction,
      ...(options.policy?.redaction ?? {}),
    },
  };

  const mode = options.modeOverride ?? policy.contentMode;
  const originalHash = hashPayload(payload, policy.hashAlgorithm);
  const fieldsRedacted = new Set<string>();

  // Mode: STRUCTURE_ONLY
  if (mode === "STRUCTURE_ONLY") {
    const structure = reduceToStructure(payload);
    const persistedHash = hashPayload(structure, policy.hashAlgorithm);
    return {
      redacted: true,
      fields_redacted: ["all_content_omitted_structure_only"],
      strategy: "omit",
      value: structure as unknown as T,
      original_hash: originalHash,
      persisted_hash: persistedHash,
      content_status: "fully_redacted",
    };
  }

  // If redaction is disabled (only possible in explicit test mocks or safe environments)
  if (!policy.redaction.enabled) {
    return {
      redacted: false,
      fields_redacted: [],
      strategy: "mask",
      value: payload,
      original_hash: originalHash,
      persisted_hash: originalHash,
      content_status: "none",
    };
  }

  // Mode: SAFE_CONTENT or FULL_CONTENT
  // Note: FULL_CONTENT still runs mandatory secret scrubbing!
  const sanitized = sanitizeValue(payload, policy, fieldsRedacted) as T;
  const persistedHash = hashPayload(sanitized, policy.hashAlgorithm);
  const didRedact = fieldsRedacted.size > 0 || originalHash !== persistedHash;

  let contentStatus: RedactionStatus = "none";
  if (didRedact) {
    contentStatus = "partially_redacted";
  }

  return {
    redacted: didRedact,
    fields_redacted: Array.from(fieldsRedacted),
    strategy: "mask",
    value: sanitized,
    original_hash: originalHash,
    persisted_hash: persistedHash,
    content_status: contentStatus,
  };
}
