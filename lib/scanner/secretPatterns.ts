export type SecretConfidence = "low" | "medium" | "high";

export interface SecretPattern {
  name: string;
  regex: RegExp;
  confidence: SecretConfidence;
}

export interface SecretMatch {
  kind: string;
  confidence: SecretConfidence;
  reason: string;
  matchedPreview?: string;
}

// Patterns ordered from most specific (highest confidence) to least specific.
// The Anthropic key pattern must appear before the generic OpenAI key pattern
// because sk-ant- prefixes also match /sk-[A-Za-z0-9_-]{20,}/.
export const secretPatterns: SecretPattern[] = [
  {
    name: "Anthropic API key",
    regex: /sk-ant-[A-Za-z0-9_-]{20,}/g,
    confidence: "high",
  },
  {
    name: "OpenAI API key",
    regex: /sk-[A-Za-z0-9_-]{20,}/g,
    confidence: "high",
  },
  {
    name: "GitHub fine-grained token",
    regex: /github_pat_[A-Za-z0-9_]{40,}/g,
    confidence: "high",
  },
  {
    name: "GitHub token",
    regex: /ghp_[A-Za-z0-9_]{20,}/g,
    confidence: "high",
  },
  {
    name: "AWS access key",
    regex: /\bAKIA[A-Z0-9]{16}\b/g,
    confidence: "high",
  },
  {
    name: "Database URL",
    regex: /(postgres|postgresql|mysql|mongodb|redis):\/\/[^\s"'`]+/gi,
    confidence: "high",
  },
  {
    name: "Private key block",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    confidence: "high",
  },
  // Medium confidence: named variable assignments with long, high-entropy values.
  // These fire only when the assigned value is long enough to plausibly be a secret.
  {
    name: "API key assignment",
    regex: /\b[A-Z0-9_]*API[_-]?KEY\s*=\s*["']?([A-Za-z0-9+/=_\-]{20,})["']?/gi,
    confidence: "medium",
  },
  {
    name: "Secret assignment",
    regex: /\b[A-Z0-9_]*SECRET[A-Z0-9_]*\s*=\s*["']?([A-Za-z0-9+/=_\-]{20,})["']?/gi,
    confidence: "medium",
  },
  {
    name: "Password assignment",
    regex: /\b[A-Z0-9_]*PASSWORD[A-Z0-9_]*\s*=\s*["']?([A-Za-z0-9+/=_\-]{20,})["']?/gi,
    confidence: "medium",
  },
  // Token assignment: only match when the value looks like a credential, not
  // a loop variable, function parameter, or ordinary word.
  // Requires the value to be ≥ 20 chars of base64/hex-like characters.
  {
    name: "Token assignment",
    regex: /\b[A-Z_]*ACCESS[_-]?TOKEN[A-Z0-9_]*\s*=\s*["']?([A-Za-z0-9+/=_\-]{20,})["']?/gi,
    confidence: "medium",
  },
];

// Estimate Shannon entropy of a string (bits per character).
export function estimateEntropy(value: string): number {
  if (value.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const char of value) {
    freq.set(char, (freq.get(char) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// Returns true when a value looks like a real credential (long enough and
// sufficiently random). Used to gate medium-confidence patterns.
export function looksLikeCredentialValue(value: string): boolean {
  if (value.length < 16) return false;
  // Reject pure-alphabetic camelCase/PascalCase identifiers — these are function or
  // type names captured by the regex (e.g., buildFindingSummary, SecretContextSummary).
  // Real credentials always contain at least one digit or non-letter character.
  // The check: all letters only (no digits), and mixed-case (has uppercase after first char).
  if (/^[a-zA-Z]+$/.test(value) && /[A-Z]/.test(value.slice(1))) {
    return false;
  }
  const entropy = estimateEntropy(value);
  // Real secrets typically have entropy > 3.0 bits/char.
  return entropy > 3.0;
}

// Returns true when a matched preview string looks like a stub or placeholder
// value rather than a real credential. Used to downgrade finding severity.
export function looksLikePlaceholder(preview: string): boolean {
  const lower = preview.toLowerCase();
  return /\b(stub|placeholder|example|dummy|fake|changeme|replace.?me|your.?key|your.?secret|your.?token|insert.?key|xxxx+|ci.?stub|test.?secret|sample.?key|add.?your|fill.?in)\b/.test(
    lower,
  );
}

// Returns true when a database URL contains user:password credentials.
// Credential-free URLs (postgres://localhost/db) are low severity.
export function hasDbCredentials(url: string): boolean {
  // Matches scheme://user:password@host but not scheme://host/db
  return /(postgres|postgresql|mysql|mongodb|redis):\/\/[^@/]+:[^@/]+@/.test(url);
}

// Returns true when a database URL uses localhost or 127.0.0.1.
export function isLocalDbUrl(url: string): boolean {
  return /(localhost|127\.0\.0\.1)/.test(url);
}
