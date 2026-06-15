import { normalizeScorePercent } from "@/lib/runs/runIntelligence";

/**
 * Renders a known cost. Pass `undefined` (not `0`) when no cost data exists —
 * a missing value should read "unknown", not a misleading "$0.0000".
 */
export function formatCurrency(value?: number): string {
  if (typeof value !== "number") {
    return "unknown";
  }
  return `$${value.toFixed(4)}`;
}

export function formatDuration(ms?: number): string {
  if (typeof ms !== "number" || ms <= 0) {
    return "Not recorded";
  }

  if (ms < 1000) {
    return `${ms} ms`;
  }

  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Normalizes scores that arrive as fractions (0.88) or as already-scaled
 * percentages (88) so both render as `88%`, never `8800%`.
 */
export function formatPercent(value: number): string {
  return `${normalizeScorePercent(value)}%`;
}

export function formatDateTime(value?: string): string {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}
