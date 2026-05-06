import type { Finding, Scores } from "./types";

const weights = {
  architecture: 0.2,
  promptQuality: 0.2,
  toolGovernance: 0.2,
  evalCoverage: 0.15,
  security: 0.15,
  documentation: 0.1,
};

const penalties = {
  info: 1,
  low: 4,
  medium: 10,
  high: 18,
  critical: 30,
};

export function scoreScan(findings: Finding[]): Scores {
  const base = {
    architecture: 82,
    promptQuality: 82,
    toolGovernance: 82,
    evalCoverage: 82,
    security: 88,
    documentation: 82,
  };

  for (const finding of findings) {
    const penalty = penalties[finding.severity];
    if (finding.category in base) {
      const key = finding.category as keyof typeof base;
      base[key] = Math.max(0, base[key] - penalty);
    }
  }

  const overall = Math.round(
    base.architecture * weights.architecture +
      base.promptQuality * weights.promptQuality +
      base.toolGovernance * weights.toolGovernance +
      base.evalCoverage * weights.evalCoverage +
      base.security * weights.security +
      base.documentation * weights.documentation,
  );

  return {
    ...base,
    overall,
  };
}
