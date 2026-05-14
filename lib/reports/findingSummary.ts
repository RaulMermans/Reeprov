import type { Finding, Severity } from "@/lib/scanner/types";

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

export interface SeveritySummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface CategorySummary {
  category: string;
  count: number;
}

// Secret findings carry file context labels in the summary field. Extract
// context bucket from the summary text or evidence.
export type SecretContext = "production" | "ci" | "test" | "documentation" | "placeholder" | "other";

export interface SecretContextSummary {
  context: SecretContext;
  label: string;
  count: number;
}

export interface FindingSummary {
  total: number;
  bySeverity: SeveritySummary;
  byCategory: CategorySummary[];
  secretContexts: SecretContextSummary[];
}

export function buildFindingSummary(findings: Finding[]): FindingSummary {
  const bySeverity: SeveritySummary = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

  for (const f of findings) {
    bySeverity[f.severity] += 1;
  }

  const categoryMap = new Map<string, number>();
  for (const f of findings) {
    categoryMap.set(f.category, (categoryMap.get(f.category) ?? 0) + 1);
  }

  const byCategory: CategorySummary[] = [...categoryMap.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  const secretFindings = findings.filter((f) => f.category === "security" && f.title.toLowerCase().includes("secret"));
  const secretContexts = buildSecretContextSummary(secretFindings);

  return {
    total: findings.length,
    bySeverity,
    byCategory,
    secretContexts,
  };
}

function buildSecretContextSummary(findings: Finding[]): SecretContextSummary[] {
  const contextMap = new Map<SecretContext, number>();

  for (const f of findings) {
    const ctx = extractSecretContext(f);
    contextMap.set(ctx, (contextMap.get(ctx) ?? 0) + 1);
  }

  const order: SecretContext[] = ["production", "ci", "test", "documentation", "placeholder", "other"];
  const labels: Record<SecretContext, string> = {
    production: "Production/config",
    ci: "CI configuration",
    test: "Tests",
    documentation: "Documentation/examples",
    placeholder: "Placeholder/local",
    other: "Other",
  };

  return order
    .filter((ctx) => contextMap.has(ctx))
    .map((ctx) => ({ context: ctx, label: labels[ctx], count: contextMap.get(ctx) ?? 0 }));
}

function extractSecretContext(finding: Finding): SecretContext {
  const summary = finding.summary.toLowerCase();
  const rec = finding.recommendation.toLowerCase();

  if (rec.includes("placeholder") || summary.includes("placeholder")) return "placeholder";
  if (summary.includes("(ci configuration)") || summary.includes("ci configuration")) return "ci";
  if (summary.includes("(test file)") || summary.includes("(migration file)")) return "test";
  if (summary.includes("(documentation)") || summary.includes("(example/fixture)")) return "documentation";
  if (finding.severity === "info") return "placeholder";
  return "production";
}

export function formatSeverityLabel(severity: Severity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

export function categoryLabel(category: string): string {
  switch (category) {
    case "architecture": return "Architecture";
    case "promptQuality": return "Prompt quality";
    case "toolGovernance": return "Tool governance";
    case "evalCoverage": return "Eval coverage";
    case "security": return "Security";
    case "documentation": return "Documentation";
    case "ingestion": return "Ingestion";
    default: return category;
  }
}
