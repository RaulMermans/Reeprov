/**
 * Deterministic Content Hashing & Stable JSON Canonicalization.
 *
 * Guarantees that equivalent inputs produce identical hashes regardless of
 * object property ordering, whitespace, or platform differences.
 */

import { createHash } from "node:crypto";

/**
 * Deterministically serialize any JavaScript value to a canonical JSON string.
 *
 * Invariants:
 * 1. Object keys are sorted lexicographically at every depth.
 * 2. Primitives and arrays preserve ordering.
 * 3. Dates serialize to ISO strings.
 * 4. NaN / Infinity normalize to null.
 * 5. Undefined, functions, and symbols are omitted in objects and replaced with null in arrays.
 * 6. Circular structures are safely handled by outputting "[Circular]".
 */
export function canonicalJsonStringify(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "null";
    // -0 normalizes to 0
    return Object.is(value, -0) ? "0" : String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "bigint") {
    return JSON.stringify(value.toString());
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return "null";
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return JSON.stringify("[Circular]");
    }
    seen.add(value);

    try {
      if (Array.isArray(value)) {
        const items = value.map((item) => {
          if (item === undefined || typeof item === "function" || typeof item === "symbol") {
            return "null";
          }
          return canonicalJsonStringify(item, seen);
        });
        return `[${items.join(",")}]`;
      }

      if (value instanceof Set) {
        const arrayFromSet = Array.from(value);
        return canonicalJsonStringify(arrayFromSet, seen);
      }

      if (value instanceof Map) {
        const sortedEntries = Array.from(value.entries())
          .map(([k, v]) => [String(k), v] as const)
          .sort(([a], [b]) => a.localeCompare(b));
        const entriesStr = sortedEntries.map(
          ([k, v]) => `${JSON.stringify(k)}:${canonicalJsonStringify(v, seen)}`
        );
        return `{${entriesStr.join(",")}}`;
      }

      // Plain or custom object: sort keys lexicographically
      const keys = Object.keys(value as Record<string, unknown>).sort();
      const entries: string[] = [];

      for (const key of keys) {
        const val = (value as Record<string, unknown>)[key];
        if (val === undefined || typeof val === "function" || typeof val === "symbol") {
          continue; // omit undefined/function properties from objects
        }
        entries.push(`${JSON.stringify(key)}:${canonicalJsonStringify(val, seen)}`);
      }

      return `{${entries.join(",")}}`;
    } finally {
      seen.delete(value);
    }
  }

  return JSON.stringify(String(value));
}

/**
 * Computes a prefixed SHA-256 hex digest for a string or Buffer.
 * e.g. "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
 */
export function computeSha256(data: string | Buffer | Uint8Array): string {
  const hash = createHash("sha256");
  hash.update(data);
  return `sha256:${hash.digest("hex")}`;
}

/**
 * Computes a prefixed SHA-512 hex digest for a string or Buffer.
 */
export function computeSha512(data: string | Buffer | Uint8Array): string {
  const hash = createHash("sha512");
  hash.update(data);
  return `sha512:${hash.digest("hex")}`;
}

/**
 * Computes a deterministic content hash for any JavaScript payload.
 */
export function hashPayload(payload: unknown, algorithm: "sha256" | "sha512" = "sha256"): string {
  const serialized = canonicalJsonStringify(payload);
  return algorithm === "sha512" ? computeSha512(serialized) : computeSha256(serialized);
}

/**
 * Verifies that a payload's canonical hash matches an expected hash.
 */
export function verifyPayloadHash(expectedHash: string, payload: unknown): boolean {
  if (!expectedHash) return false;
  const is512 = expectedHash.startsWith("sha512:");
  const actual = hashPayload(payload, is512 ? "sha512" : "sha256");
  return expectedHash.toLowerCase() === actual.toLowerCase();
}
