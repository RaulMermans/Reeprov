import type { Scores } from "@/lib/scanner/types";

export function formatScore(score: number) {
  return `${Math.round(score)}/100`;
}

export function statusForScore(score: number) {
  if (score >= 80) return "Healthy";
  if (score >= 60) return "Warning";
  return "Critical";
}

export function statusTone(score: number) {
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  return "danger";
}

export function scoreEntries(scores: Scores) {
  return [
    ["Architecture", scores.architecture],
    ["Prompt quality", scores.promptQuality],
    ["Tool governance", scores.toolGovernance],
    ["Eval coverage", scores.evalCoverage],
    ["Security", scores.security],
    ["Documentation", scores.documentation],
  ] as const;
}
