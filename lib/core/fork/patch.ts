/**
 * Structured Deterministic State Patching.
 *
 * Implements a safe, deterministic JSON Patch engine (RFC 6902 subset)
 * with dot-notation and JSON Pointer path resolution.
 *
 * Invariants:
 * - Input state is NEVER mutated in place (deep cloned before patch).
 * - Target path existence is strictly validated for "replace" and "remove".
 * - Internal Reeprov metadata and security keys are protected from mutation.
 */

export interface JsonPatchOperation {
  op: "replace" | "add" | "remove";
  path: string;
  value?: unknown;
}

export class StatePatchError extends Error {
  constructor(
    public readonly code: "MUTATION_TARGET_NOT_FOUND" | "SECURITY_VIOLATION" | "INVALID_PATCH",
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(`[StatePatchError: ${code}] ${message}`);
    this.name = "StatePatchError";
  }
}

const PROTECTED_PATH_PREFIXES = ["__reeprov", "__agentpulse", "schema_version", "__proto__", "prototype", "constructor"];

function parsePath(rawPath: string): string[] {
  let normalized = rawPath.trim();
  if (normalized.startsWith("/")) {
    normalized = normalized.slice(1);
  }
  if (!normalized) return [];

  // Support both '/' (JSON pointer) and '.' (dot notation)
  return normalized.includes("/")
    ? normalized.split("/").map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"))
    : normalized.split(".");
}

function isProtected(segments: string[]): boolean {
  if (segments.length === 0) return true;
  const first = segments[0]?.toLowerCase() ?? "";
  return PROTECTED_PATH_PREFIXES.some((prefix) => first === prefix.toLowerCase() || segments.includes("__proto__"));
}

export function applyStatePatch(
  baseState: Record<string, unknown>,
  patch: JsonPatchOperation | JsonPatchOperation[]
): Record<string, unknown> {
  const operations = Array.isArray(patch) ? patch : [patch];
  const target = structuredClone(baseState);

  for (const op of operations) {
    const segments = parsePath(op.path);

    if (segments.length === 0) {
      if (op.op === "replace" && op.value && typeof op.value === "object" && !Array.isArray(op.value)) {
        return structuredClone(op.value as Record<string, unknown>);
      }
      throw new StatePatchError("INVALID_PATCH", `Cannot apply operation '${op.op}' to root path.`);
    }

    if (isProtected(segments)) {
      throw new StatePatchError(
        "SECURITY_VIOLATION",
        `Mutation targeting protected internal path '${op.path}' is forbidden.`,
        { path: op.path }
      );
    }

    let current: any = target;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;
      if (current[seg] === undefined || current[seg] === null) {
        if (op.op === "add") {
          current[seg] = {};
        } else {
          throw new StatePatchError(
            "MUTATION_TARGET_NOT_FOUND",
            `Path segment '${seg}' in path '${op.path}' does not exist.`,
            { path: op.path, segment: seg }
          );
        }
      }
      current = current[seg];
    }

    const lastSeg = segments[segments.length - 1]!;

    switch (op.op) {
      case "replace": {
        if (!(lastSeg in current)) {
          throw new StatePatchError(
            "MUTATION_TARGET_NOT_FOUND",
            `Target property '${lastSeg}' in path '${op.path}' does not exist to replace.`,
            { path: op.path, property: lastSeg }
          );
        }
        current[lastSeg] = structuredClone(op.value);
        break;
      }
      case "add": {
        if (Array.isArray(current)) {
          const idx = lastSeg === "-" ? current.length : Number.parseInt(lastSeg, 10);
          if (Number.isNaN(idx)) {
            current.push(structuredClone(op.value));
          } else {
            current.splice(idx, 0, structuredClone(op.value));
          }
        } else {
          current[lastSeg] = structuredClone(op.value);
        }
        break;
      }
      case "remove": {
        if (!(lastSeg in current)) {
          throw new StatePatchError(
            "MUTATION_TARGET_NOT_FOUND",
            `Target property '${lastSeg}' in path '${op.path}' does not exist to remove.`,
            { path: op.path, property: lastSeg }
          );
        }
        if (Array.isArray(current)) {
          const idx = Number.parseInt(lastSeg, 10);
          if (!Number.isNaN(idx)) {
            current.splice(idx, 1);
          }
        } else {
          delete current[lastSeg];
        }
        break;
      }
      default:
        throw new StatePatchError("INVALID_PATCH", `Unsupported patch operation '${(op as any).op}'.`);
    }
  }

  return target;
}
