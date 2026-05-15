import type { Finding, Scores } from "./types";

const weights = {
  architecture: 0.2,
  promptQuality: 0.2,
  toolGovernance: 0.2,
  evalCoverage: 0.15,
  security: 0.15,
  documentation: 0.1,
};

// Penalties per severity for non-security categories.
const penalties = {
  info: 1,
  low: 4,
  medium: 10,
  high: 18,
  critical: 30,
};

// Security-category penalties are confidence-aware. High-confidence secret
// findings (real keys, tokens) apply the full penalty. Medium-confidence
// (plausible but not definitive) apply a reduced penalty. Low-confidence
// heuristic observations barely move the score.
const securityPenalties = {
  critical: { high: 50, medium: 25, low: 5 },
  high: { high: 30, medium: 12, low: 3 },
  medium: { high: 12, medium: 6, low: 2 },
  low: { high: 5, medium: 3, low: 1 },
  info: { high: 1, medium: 1, low: 0 },
};

// Fixture/test/placeholder secrets (low-confidence findings, confidence < 0.7) should not
// crater the security score on their own. Cap their total accumulated penalty at 18 points
// so a repo with only fake test credentials can't score below 70 from those alone.
const LOW_CONF_SECURITY_PENALTY_CAP = 18;

export function scoreScan(findings: Finding[]): Scores {
  const base = {
    architecture: 82,
    promptQuality: 82,
    toolGovernance: 82,
    evalCoverage: 82,
    security: 88,
    documentation: 82,
  };

  let lowConfSecurityPenaltyTotal = 0;

  for (const f of findings) {
    if (f.category === "security") {
      // Determine the confidence of this security finding.
      // Findings set a `secretConfidence` hint via the finding confidence
      // field: >= 0.95 → high, 0.7–0.94 → medium, < 0.7 → low.
      const confidenceLevel =
        f.confidence >= 0.95 ? "high" : f.confidence >= 0.7 ? "medium" : "low";
      const penaltyTable = securityPenalties[f.severity as keyof typeof securityPenalties];
      const penalty = penaltyTable?.[confidenceLevel] ?? penalties[f.severity];

      if (confidenceLevel === "low") {
        // Cap total low-confidence penalties so fixture/test secrets alone
        // cannot drop security below 88 - 18 = 70.
        const available = Math.min(
          penalty,
          Math.max(0, LOW_CONF_SECURITY_PENALTY_CAP - lowConfSecurityPenaltyTotal),
        );
        lowConfSecurityPenaltyTotal += available;
        base.security = Math.max(0, base.security - available);
      } else {
        base.security = Math.max(0, base.security - penalty);
      }
    } else {
      const penalty = penalties[f.severity];
      if (f.category in base) {
        const key = f.category as keyof typeof base;
        base[key] = Math.max(0, base[key] - penalty);
      }
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
