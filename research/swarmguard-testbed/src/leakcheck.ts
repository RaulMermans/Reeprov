/**
 * Detector-safe isolation checks. This module has no ground-truth constructors
 * and no oracle types. Monitors may import it.
 */

import { GROUND_TRUTH_LEAK_KEYS, LEAK_SUBSTRINGS } from "./contracts";

export interface IsolationReport {
  isolated: boolean;
  leaks: string[];
}

function collectKeys(value: unknown, path: string, acc: string[]): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectKeys(entry, `${path}[${index}]`, acc));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      acc.push(`${path}.${key}`);
      collectKeys(child, `${path}.${key}`, acc);
    }
  }
}

export function findGroundTruthLeaks(detectorVisible: unknown): string[] {
  const leaks: string[] = [];
  const keys: string[] = [];
  collectKeys(detectorVisible, "$", keys);
  const forbidden = new Set<string>(GROUND_TRUTH_LEAK_KEYS);
  for (const path of keys) {
    const leaf = path.split(".").pop() ?? "";
    const bracketFree = leaf.replace(/\[\d+\]/g, "");
    if (forbidden.has(bracketFree)) {
      leaks.push(`forbidden key at ${path}`);
    }
  }
  const serialized = JSON.stringify(detectorVisible).toLowerCase();
  for (const token of LEAK_SUBSTRINGS) {
    if (serialized.includes(token)) {
      leaks.push(`forbidden substring "${token}" in detector-visible JSON`);
    }
  }
  return [...new Set(leaks)];
}

export function assertIsolated(detectorVisible: unknown): IsolationReport {
  const leaks = findGroundTruthLeaks(detectorVisible);
  return { isolated: leaks.length === 0, leaks };
}

export function detectorView<T>(artifact: T): T {
  return structuredClone(artifact);
}
