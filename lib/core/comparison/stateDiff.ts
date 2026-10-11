/**
 * Structured State Diff Engine.
 *
 * Implements deterministic JSON Pointer / JSON Patch-style path comparison
 * across StateSnapshots and structured runtime states.
 * Respects redaction policies and calculates component hashes.
 */

import { hashPayload } from "../capture/hashing";
import { sanitizePayload } from "../capture/redaction";
import type { StateSnapshot } from "../contracts/execution";
import type { StateChange, StateDiff } from "../contracts/comparison";

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function escapeJsonPointer(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Computes deep JSON Pointer changes between two states.
 */
export function diffJsonState(
  before: unknown,
  after: unknown,
  basePath = "",
  sanitize = true
): StateChange[] {
  const sanitizedBefore = sanitize ? ((sanitizePayload(before) as any)?.value ?? before) : before;
  const sanitizedAfter = sanitize ? ((sanitizePayload(after) as any)?.value ?? after) : after;

  const changes: StateChange[] = [];

  // Helper recursive walker
  function walk(b: unknown, a: unknown, currentPath: string) {
    if (b === a) return;

    // Both are objects
    if (isPlainObject(b) && isPlainObject(a)) {
      const allKeys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();
      for (const key of allKeys) {
        const nextPath = `${currentPath}/${escapeJsonPointer(key)}`;
        const hasBefore = Object.prototype.hasOwnProperty.call(b, key);
        const hasAfter = Object.prototype.hasOwnProperty.call(a, key);

        if (hasBefore && !hasAfter) {
          if (isPlainObject(b[key])) {
            walk(b[key], {}, nextPath);
          } else {
            changes.push({
              path: nextPath,
              operation: "remove",
              before: b[key],
              after: undefined,
              before_hash: hashPayload(b[key]),
              redacted: false,
            });
          }
        } else if (!hasBefore && hasAfter) {
          if (isPlainObject(a[key])) {
            walk({}, a[key], nextPath);
          } else {
            changes.push({
              path: nextPath,
              operation: "add",
              before: undefined,
              after: a[key],
              after_hash: hashPayload(a[key]),
              redacted: false,
            });
          }
        } else {
          walk(b[key], a[key], nextPath);
        }
      }
      return;
    }

    // Both are arrays
    if (Array.isArray(b) && Array.isArray(a)) {
      const maxLen = Math.max(b.length, a.length);
      for (let i = 0; i < maxLen; i++) {
        const nextPath = `${currentPath}/${i}`;
        if (i >= b.length) {
          changes.push({
            path: nextPath,
            operation: "add",
            before: undefined,
            after: a[i],
            after_hash: hashPayload(a[i]),
            redacted: false,
          });
        } else if (i >= a.length) {
          changes.push({
            path: nextPath,
            operation: "remove",
            before: b[i],
            after: undefined,
            before_hash: hashPayload(b[i]),
            redacted: false,
          });
        } else {
          walk(b[i], a[i], nextPath);
        }
      }
      return;
    }

    // Primitive values or type mismatch -> replace
    changes.push({
      path: currentPath || "/",
      operation: "replace",
      before: b,
      after: a,
      before_hash: hashPayload(b),
      after_hash: hashPayload(a),
      redacted: false,
    });
  }

  walk(sanitizedBefore, sanitizedAfter, basePath);
  return changes;
}

/**
 * Compares two StateSnapshots by ID or payload.
 */
export function diffStateSnapshots(
  before?: StateSnapshot,
  after?: StateSnapshot,
  stepId?: string,
  candidateStepId?: string
): StateDiff {
  if (!before && !after) {
    return { step_id: stepId, candidate_step_id: candidateStepId, changes: [] };
  }

  const beforeData = before?.state_data ?? (before as any)?.state ?? {};
  const afterData = after?.state_data ?? (after as any)?.state ?? {};

  const changes = diffJsonState(beforeData, afterData);
  return {
    step_id: stepId ?? before?.step_id,
    candidate_step_id: candidateStepId ?? after?.step_id,
    changes,
  };
}
