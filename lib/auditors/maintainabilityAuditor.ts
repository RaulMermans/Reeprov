import type { MaintainabilityMetrics, RepoFile } from "@/lib/scanner/types";
import type { Auditor } from "./types";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const LARGE_SOURCE_LINES = 500;
const HUGE_SOURCE_LINES = 800;
const NOTABLE_SOURCE_LINES = 300;
const LARGE_DASHBOARD_LINES = 300;

// Source extensions that matter for large-file and concentration checks.
const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb"]);

// TODO/FIXME/maintenance marker regex.
const TODO_RE = /\b(TODO|FIXME|HACK|XXX)\b/g;
const WORKAROUND_RE = /\b(temporary fix|workaround|temp fix|NOSONAR)\b/gi;

// ---------------------------------------------------------------------------
// Path classifiers
// ---------------------------------------------------------------------------

function isSourceFile(f: RepoFile): boolean {
  return SOURCE_EXTS.has(f.extension ?? "") && !isTestFile(f) && !isGeneratedFile(f);
}

function isTestFile(f: RepoFile): boolean {
  const n = `/${f.path.toLowerCase()}`;
  return (
    n.includes("/tests/") ||
    n.includes("/__tests__/") ||
    n.includes("/test/") ||
    n.includes("/fixtures/") ||
    n.includes("/__fixtures__/") ||
    n.includes("/mocks/") ||
    f.name.endsWith(".test.ts") ||
    f.name.endsWith(".test.tsx") ||
    f.name.endsWith(".spec.ts") ||
    f.name.endsWith(".test.py") ||
    f.name.endsWith(".test.js")
  );
}

function isGeneratedFile(f: RepoFile): boolean {
  const n = f.path.toLowerCase();
  return (
    n.includes("node_modules") ||
    n.endsWith(".lock") ||
    n.endsWith("-lock.json") ||
    n.includes("dist/") ||
    n.includes(".next/") ||
    n.includes("__pycache__") ||
    n.includes(".generated.")
  );
}

function isDashboardFile(f: RepoFile): boolean {
  const n = `/${f.path.toLowerCase()}`;
  return (
    n.includes("/dashboard/") ||
    n.includes("/components/") ||
    n.includes("/views/") ||
    n.includes("/pages/") ||
    (SOURCE_EXTS.has(f.extension ?? "") && (f.name.endsWith(".tsx") || f.name.endsWith(".jsx")))
  );
}

function isScannerConcentrationCandidate(f: RepoFile): boolean {
  const n = `/${f.path.toLowerCase()}`;
  return (
    n.includes("/scanner/") ||
    n.includes("/detect") ||
    n.includes("/classifier") ||
    n.includes("/classify") ||
    n.includes("/rules/") ||
    n.includes("/patterns") ||
    n.includes("/parser") ||
    n.includes("/routing") ||
    n.includes("/router") ||
    (n.includes("/reports/") && SOURCE_EXTS.has(f.extension ?? ""))
  );
}

function isDocFile(f: RepoFile): boolean {
  const n = f.path.toLowerCase();
  return n.endsWith(".md") || n.endsWith(".rst") || n.endsWith(".txt") || n.includes("/docs/");
}

function isSchemaFile(f: RepoFile): boolean {
  const n = f.name.toLowerCase();
  return (
    n.includes("schema") ||
    n.includes("types") ||
    n === "model.ts" ||
    n === "models.ts"
  );
}

function countLines(content: string | undefined): number {
  if (!content) return 0;
  return content.split("\n").length;
}

// ---------------------------------------------------------------------------
// Check A: Large source files
// ---------------------------------------------------------------------------

function detectLargeFiles(files: RepoFile[]): {
  findings: ReturnType<typeof makeFinding>[];
  largeFiles: MaintainabilityMetrics["largeFiles"];
} {
  const largeFiles: MaintainabilityMetrics["largeFiles"] = [];
  const findings: ReturnType<typeof makeFinding>[] = [];

  let hugePenalty = 0;
  let largePenalty = 0;

  for (const f of files) {
    if (!isSourceFile(f) || isDashboardFile(f)) continue;
    const lines = countLines(f.content);

    if (lines >= HUGE_SOURCE_LINES) {
      largeFiles.push({ path: f.path, lineCount: lines, reason: `${lines} lines — consider splitting` });
      if (hugePenalty < 30) {
        hugePenalty += 15;
        const extra = isScannerConcentrationCandidate(f) ? " Scanner rule concentration may make this harder to test independently." : "";
        findings.push(makeFinding(
          `large-file-${hashId(f.path)}`,
          "maintainability",
          "high",
          "Large mixed-responsibility file detected",
          `${f.path} has ${lines} lines, which may indicate mixed responsibilities.${extra}`,
          [f.path],
          "Split this file into focused modules so each can be tested and evolved independently.",
          0.7,
        ));
      }
    } else if (lines >= LARGE_SOURCE_LINES) {
      largeFiles.push({ path: f.path, lineCount: lines, reason: `${lines} lines — review for split` });
      if (largePenalty < 24) {
        largePenalty += 8;
        findings.push(makeFinding(
          `large-file-${hashId(f.path)}`,
          "maintainability",
          "medium",
          "Large source file detected",
          `${f.path} has ${lines} lines. Splitting into focused modules improves testability and readability.`,
          [f.path],
          "Extract focused sub-modules if this file mixes scanning, scoring, formatting, and UI/report logic.",
          0.6,
        ));
      }
    } else if (lines >= NOTABLE_SOURCE_LINES) {
      largeFiles.push({ path: f.path, lineCount: lines, reason: `${lines} lines — notable` });
      // Low severity for 300-500: just flag in metrics, no high-severity finding
      if (largePenalty < 24) {
        largePenalty += 3;
        findings.push(makeFinding(
          `notable-file-${hashId(f.path)}`,
          "maintainability",
          "low",
          "Notable file size",
          `${f.path} has ${lines} lines.`,
          [f.path],
          "Consider splitting if this file grows further.",
          0.4,
        ));
      }
    }
  }

  return { findings, largeFiles };
}

// ---------------------------------------------------------------------------
// Check B: Scanner/router concentration
// ---------------------------------------------------------------------------

function detectScannerConcentration(files: RepoFile[]): ReturnType<typeof makeFinding>[] {
  const findings: ReturnType<typeof makeFinding>[] = [];
  let totalPenalty = 0;

  for (const f of files) {
    if (!isSourceFile(f) || !isScannerConcentrationCandidate(f)) continue;
    const lines = countLines(f.content);
    if (lines < LARGE_SOURCE_LINES) continue; // Already caught by large-file check for huge files

    const exportCount = (f.content?.match(/^export\s+(function|const|class|type|interface)/gm) ?? []).length;
    const signals: string[] = [];
    if (lines >= HUGE_SOURCE_LINES) signals.push(`${lines} lines`);
    if (exportCount > 15) signals.push(`${exportCount} exports`);

    if (signals.length > 0 && totalPenalty < 20) {
      totalPenalty += 8;
      findings.push(makeFinding(
        `scanner-concentration-${hashId(f.path)}`,
        "maintainability",
        lines >= HUGE_SOURCE_LINES ? "medium" : "low",
        "Scanner rule concentration detected",
        `${f.path} concentrates ${signals.join(" and ")} of detection logic in one file.`,
        [f.path],
        "Extract rule groups into focused detectors so new scanner behavior can be tested independently.",
        0.65,
      ));
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Check C: TODO/FIXME markers
// ---------------------------------------------------------------------------

function detectTodoMarkers(files: RepoFile[]): {
  findings: ReturnType<typeof makeFinding>[];
  markers: MaintainabilityMetrics["todoMarkers"];
} {
  const markers: MaintainabilityMetrics["todoMarkers"] = [];
  let total = 0;

  for (const f of files) {
    if (!f.content || isDocFile(f) || isGeneratedFile(f)) continue;
    const todoMatches = (f.content.match(TODO_RE) ?? []).length;
    const workaroundMatches = (f.content.match(WORKAROUND_RE) ?? []).length;
    const count = todoMatches + workaroundMatches;
    if (count > 0) {
      markers.push({ path: f.path, count });
      total += count;
    }
  }

  const findings: ReturnType<typeof makeFinding>[] = [];
  if (total > 0) {
    const severity = total > 10 ? "medium" : total > 3 ? "low" : "info";
    findings.push(makeFinding(
      "todo-fixme-markers",
      "maintainability",
      severity,
      "Maintenance markers detected",
      `${total} TODO/FIXME/HACK marker(s) found across ${markers.length} file(s). These indicate deferred work or workarounds.`,
      markers.slice(0, 5).map((m) => m.path),
      "Address or document deferred items so they can be tracked in issues rather than source comments.",
      0.75,
    ));
  }

  return { findings, markers };
}

// ---------------------------------------------------------------------------
// Check D: Schema version / optional field sprawl
// ---------------------------------------------------------------------------

function detectSchemaVersion(files: RepoFile[]): ReturnType<typeof makeFinding>[] {
  const findings: ReturnType<typeof makeFinding>[] = [];

  // Check if any file defines reportVersion.
  const hasVersion = files.some(
    (f) => f.content && /reportVersion|report_version|schemaVersion|schema_version/.test(f.content),
  );

  // Check for schema files with many optional fields.
  const schemaFiles = files.filter(isSchemaFile);
  const schemaWithManyOptionals = schemaFiles.filter((f) => {
    const optionalCount = (f.content?.match(/\?:|\.optional\(\)/g) ?? []).length;
    return optionalCount > 20;
  });

  if (!hasVersion && schemaFiles.length > 0) {
    findings.push(makeFinding(
      "schema-version-missing",
      "maintainability",
      "medium",
      "Report schema version missing",
      "No reportVersion field found in schema or type files. Adding a version is necessary before persisting scan history.",
      schemaFiles.map((f) => f.path).slice(0, 3),
      "Add the current reportVersion to exported reports before implementing scan history or report persistence.",
      0.8,
    ));
  }

  if (schemaWithManyOptionals.length > 0) {
    findings.push(makeFinding(
      "schema-optional-sprawl",
      "maintainability",
      "low",
      "Report schema optional field growth",
      `${schemaWithManyOptionals.length} schema file(s) have more than 20 optional fields, which may indicate accumulated schema debt.`,
      schemaWithManyOptionals.map((f) => f.path),
      "Review optional fields; deprecate unused ones and consider a reportVersion bump before persisting history.",
      0.55,
    ));
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Check E: Dashboard component complexity
// ---------------------------------------------------------------------------

function detectDashboardComplexity(files: RepoFile[]): ReturnType<typeof makeFinding>[] {
  const findings: ReturnType<typeof makeFinding>[] = [];
  let penalty = 0;

  for (const f of files) {
    if (!isDashboardFile(f) || isTestFile(f) || isGeneratedFile(f)) continue;
    const lines = countLines(f.content);
    if (lines < LARGE_DASHBOARD_LINES) continue;

    const severity = lines >= 500 ? "medium" : "low";
    if (penalty < 15) {
      penalty += 5;
      findings.push(makeFinding(
        `dashboard-complexity-${hashId(f.path)}`,
        "maintainability",
        severity,
        "Dashboard component complexity detected",
        `${f.path} has ${lines} lines. Large UI components are harder to extend with scan history or diff views.`,
        [f.path],
        "Extract smaller presentational sub-components before adding scan history or diff views.",
        0.6,
      ));
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Check F: Duplicate recommendation / report wording
// ---------------------------------------------------------------------------

function detectDuplicateWording(files: RepoFile[]): ReturnType<typeof makeFinding>[] {
  const recFiles = files.filter((f) => {
    const n = f.path.toLowerCase();
    return (
      n.includes("recommendation") ||
      n.includes("finding") ||
      n.includes("report") ||
      n.includes("auditor")
    ) && SOURCE_EXTS.has(f.extension ?? "") && !isTestFile(f);
  });

  if (recFiles.length < 2) return [];

  // Extract quoted recommendation strings (> 30 chars) from each file.
  const phraseMap = new Map<string, string[]>();
  for (const f of recFiles) {
    if (!f.content) continue;
    for (const m of f.content.matchAll(/"([^"]{30,120})"/g)) {
      const phrase = m[1].trim().toLowerCase();
      if (!phraseMap.has(phrase)) phraseMap.set(phrase, []);
      phraseMap.get(phrase)!.push(f.path);
    }
  }

  const duplicates = [...phraseMap.entries()].filter(([, paths]) => {
    const unique = new Set(paths);
    return unique.size >= 2;
  });

  if (duplicates.length >= 3) {
    return [makeFinding(
      "duplicate-recommendation-wording",
      "maintainability",
      "low",
      "Duplicated recommendation wording detected",
      `${duplicates.length} recommendation phrase(s) appear in multiple source files, which may cause dashboard and exports to diverge.`,
      recFiles.map((f) => f.path).slice(0, 4),
      "Centralize recommendation templates so dashboard and exports stay consistent.",
      0.55,
    )];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Check G: Tests and golden fixtures
// ---------------------------------------------------------------------------

function detectGoldenFixtures(
  report: { detectedTests: string[]; detectedEvals: string[] },
  files: RepoFile[],
): ReturnType<typeof makeFinding>[] {
  const hasTests = report.detectedTests.length > 0;
  if (!hasTests) return [];

  // Golden report fixtures: JSON files in fixture dirs that look like scan reports.
  const hasGoldenFixtures = files.some((f) => {
    const n = f.path.toLowerCase();
    return (
      (n.includes("fixture") || n.includes("__fixtures__") || n.includes("golden") || n.includes("snapshot")) &&
      (n.endsWith(".json") || n.endsWith(".ts")) &&
      f.content && (f.content.includes("repoName") || f.content.includes("findings") || f.content.includes("detectedAgents"))
    );
  });

  if (!hasGoldenFixtures) {
    return [makeFinding(
      "missing-golden-fixtures",
      "maintainability",
      "low",
      "Golden report fixtures missing",
      "Software tests exist but no golden report fixtures were detected. Semantic regressions in report output may go undetected.",
      [],
      "Add stable golden report fixtures for known sample repos to catch semantic regressions.",
      0.65,
    )];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Check H: Documentation drift
// ---------------------------------------------------------------------------

function detectDocumentationDrift(
  report: { detectedAgents: unknown[]; projectType: string },
  files: RepoFile[],
): ReturnType<typeof makeFinding>[] {
  const docFiles = files.filter(isDocFile);
  if (docFiles.length === 0) return [];

  const docContent = docFiles.map((f) => f.content ?? "").join(" ").toLowerCase();

  // Key AI-system concepts that should appear in docs if the project uses them.
  const expectedConcepts: Array<{ term: string; condition: boolean }> = [
    { term: "ai_application", condition: report.projectType === "ai_application" },
    { term: "assistant tooling", condition: true },
    { term: "filecontext", condition: true },
    { term: "maintainability", condition: false }, // new — likely missing in most repos
    { term: "detectedciciworkflow", condition: false },
  ];

  const missing = expectedConcepts
    .filter(({ term, condition }) => condition && !docContent.includes(term.toLowerCase()))
    .map(({ term }) => term);

  if (missing.length >= 2) {
    return [makeFinding(
      "documentation-drift",
      "maintainability",
      "info",
      "Documentation may lag implementation",
      `Docs appear to be missing references to: ${missing.slice(0, 4).join(", ")}.`,
      docFiles.map((f) => f.path).slice(0, 3),
      "Update architecture/data-model docs when report schema or scanner categories change.",
      0.45,
    )];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Score calculation
// ---------------------------------------------------------------------------

function calculateMaintainabilityScore(
  findings: ReturnType<typeof makeFinding>[],
  files: RepoFile[],
  report: { detectedTests: string[]; detectedEvals: string[]; detectedAgents: unknown[] },
): number {
  let score = 100;

  // Penalties from findings.
  for (const f of findings) {
    if (f.category !== "maintainability") continue;
    switch (f.severity) {
      case "high": score -= 15; break;
      case "medium": score -= 8; break;
      case "low": score -= 5; break;
      case "info": score -= 2; break;
    }
  }

  // Positive signals: each reduces effective penalty.
  if (report.detectedTests.length > 0) score += 3;
  if (report.detectedEvals.length > 0) score += 3;
  const hasDocFiles = files.some(isDocFile);
  if (hasDocFiles) score += 2;
  const hasManifest = files.some((f) => /^agents?\.(ya?ml|json)$/i.test(f.name) || /^workflow(s)?\.ya?ml$/i.test(f.name));
  if (hasManifest) score += 2;

  return Math.max(20, Math.min(100, Math.round(score)));
}

// ---------------------------------------------------------------------------
// Build hotspots summary
// ---------------------------------------------------------------------------

function buildHotspots(files: RepoFile[], largeFiles: MaintainabilityMetrics["largeFiles"]): MaintainabilityMetrics["hotspots"] {
  const hotspotMap = new Map<string, string[]>();

  for (const lf of largeFiles) {
    if (!hotspotMap.has(lf.path)) hotspotMap.set(lf.path, []);
    hotspotMap.get(lf.path)!.push(lf.reason);
  }

  for (const f of files) {
    if (!isScannerConcentrationCandidate(f) || !f.content) continue;
    const exports = (f.content.match(/^export\s+(function|const|class|type|interface)/gm) ?? []).length;
    if (exports > 10) {
      if (!hotspotMap.has(f.path)) hotspotMap.set(f.path, []);
      hotspotMap.get(f.path)!.push(`${exports} exports`);
    }
  }

  return [...hotspotMap.entries()]
    .map(([path, signals]) => ({ path, signals }))
    .slice(0, 10);
}

// ---------------------------------------------------------------------------
// Main auditor export
// ---------------------------------------------------------------------------

export const maintainabilityAuditor: Auditor = ({ report, files }) => {
  const scanned = files.filter((f) => !f.ignored);

  const largeFileResult = detectLargeFiles(scanned);
  const scannerFindings = detectScannerConcentration(scanned);
  const todoResult = detectTodoMarkers(scanned);
  const schemaFindings = detectSchemaVersion(scanned);
  const dashboardFindings = detectDashboardComplexity(scanned);
  const wordingFindings = detectDuplicateWording(scanned);
  const fixtureFindings = detectGoldenFixtures(report, scanned);
  const driftFindings = detectDocumentationDrift(report, scanned);

  const findings = [
    ...largeFileResult.findings,
    ...scannerFindings,
    ...todoResult.findings,
    ...schemaFindings,
    ...dashboardFindings,
    ...wordingFindings,
    ...fixtureFindings,
    ...driftFindings,
  ];

  const score = calculateMaintainabilityScore(findings, scanned, report);
  const hotspots = buildHotspots(scanned, largeFileResult.largeFiles);

  const positives: string[] = [];
  if (report.detectedTests.length > 0) positives.push("tests");
  if (report.detectedEvals.length > 0) positives.push("evals");
  if (scanned.some(isDocFile)) positives.push("docs");

  const summary = buildSummary(score, findings, positives, largeFileResult.largeFiles, todoResult.markers);

  const metrics: MaintainabilityMetrics = {
    largeFiles: largeFileResult.largeFiles,
    todoMarkers: todoResult.markers,
    hotspots,
    summary,
    score,
  };

  return {
    auditor: "maintainability",
    findings,
    maintainabilityScore: score,
    maintainabilityMetrics: metrics,
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSummary(
  score: number,
  findings: ReturnType<typeof makeFinding>[],
  positives: string[],
  largeFiles: MaintainabilityMetrics["largeFiles"],
  todoMarkers: MaintainabilityMetrics["todoMarkers"],
): string {
  const parts: string[] = [];
  if (score >= 85) {
    parts.push("Codebase is clean and modular.");
  } else if (score >= 65) {
    parts.push("Codebase is generally maintainable with a few concentration points.");
  } else {
    parts.push("Codebase shows significant structural debt that may slow AI-system evolution.");
  }

  if (largeFiles.length > 0) {
    parts.push(`${largeFiles.length} large file(s) detected.`);
  }
  const totalTodo = todoMarkers.reduce((s, m) => s + m.count, 0);
  if (totalTodo > 0) {
    parts.push(`${totalTodo} TODO/FIXME marker(s).`);
  }
  if (positives.length > 0) {
    parts.push(`Positive signals: ${positives.join(", ")}.`);
  }

  return parts.join(" ");
}

function makeFinding(
  id: string,
  category: string,
  severity: "info" | "low" | "medium" | "high",
  title: string,
  summary: string,
  evidencePaths: string[],
  recommendation: string,
  confidence: number,
) {
  return { id, category, severity, title, summary, evidencePaths, recommendation, confidence };
}

function hashId(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
