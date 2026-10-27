/**
 * Canonical JSON + SHA-256, byte-compatible with the Reeprov server
 * (lib/core/capture/hashing.ts). Used to send a checkpoint state hash that
 * the server verifies, so corruption in transit is detected.
 */

export function canonicalJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "null";
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value === "function" || typeof value === "symbol") return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === "object") {
    if (seen.has(value)) return JSON.stringify("[Circular]");
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        return `[${value
          .map((item) => (item === undefined || typeof item === "function" || typeof item === "symbol" ? "null" : canonicalJson(item, seen)))
          .join(",")}]`;
      }
      if (value instanceof Set) return canonicalJson(Array.from(value), seen);
      if (value instanceof Map) {
        const entries = Array.from(value.entries())
          .map(([k, v]) => [String(k), v] as const)
          .sort(([a], [b]) => a.localeCompare(b));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v, seen)}`).join(",")}}`;
      }
      const record = value as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of Object.keys(record).sort()) {
        const v = record[key];
        if (v === undefined || typeof v === "function" || typeof v === "symbol") continue;
        parts.push(`${JSON.stringify(key)}:${canonicalJson(v, seen)}`);
      }
      return `{${parts.join(",")}}`;
    } finally {
      seen.delete(value);
    }
  }
  return JSON.stringify(String(value));
}

export async function canonicalSha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}
