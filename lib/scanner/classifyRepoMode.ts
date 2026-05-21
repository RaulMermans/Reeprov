import type { RepoFile, RepositoryMode, RepositoryModeResult, RepositoryModeScoringPolicy } from "./types";

// Path segments that indicate example/sample/demo content.
const EXAMPLE_SEGMENTS = [
  "/examples/", "/example/",
  "/samples/", "/sample/",
  "/demos/", "/demo/",
  "/tutorials/", "/tutorial/",
  "/templates/", "/template/",
  "/starters/", "/starter/",
  "/cookbook/", "/cookbooks/",
  "/notebooks/", "/notebook/",
  "/playground/",
];

// Path segments typical of a deployed application.
const APP_SEGMENTS = [
  "/app/", "/src/", "/backend/", "/frontend/",
  "/server/", "/api/", "/pages/", "/routes/",
  "/handlers/", "/services/", "/workers/",
];

// Filenames that indicate the repo is deployed / production-ready.
const DEPLOYMENT_FILENAMES = new Set([
  "vercel.json", "netlify.toml", "render.yaml", "render.yml",
  "railway.json", "railway.toml",
  "dockerfile", "docker-compose.yml", "docker-compose.yaml",
  "procfile", "app.yaml",
]);

// Package.json keywords that strongly suggest a library/SDK/framework pattern.
const LIBRARY_KEYWORDS = new Set([
  "library", "sdk", "framework", "plugin", "extension",
  "module", "toolkit", "middleware", "adapter", "connector",
]);

const NO_AI_POLICY: RepositoryModeScoringPolicy = {
  aiSystemHealthApplicable: false,
  generalHygieneApplicable: true,
  governanceApplicable: false,
  description: "Repository does not appear to contain an AI system. AI governance scoring is not applied.",
};

const FRAMEWORK_POLICY: RepositoryModeScoringPolicy = {
  aiSystemHealthApplicable: false,
  generalHygieneApplicable: true,
  governanceApplicable: false,
  description: "Scored as a library/framework. Example coverage and docs quality matter; app-level governance does not apply.",
};

const EXAMPLE_POLICY: RepositoryModeScoringPolicy = {
  aiSystemHealthApplicable: false,
  generalHygieneApplicable: true,
  governanceApplicable: false,
  description: "Scored as an example/template repository. Runnable samples, docs clarity, and fake-credential hygiene matter most.",
};

const APP_POLICY: RepositoryModeScoringPolicy = {
  aiSystemHealthApplicable: true,
  generalHygieneApplicable: true,
  governanceApplicable: true,
  description: "Fully scored as a deployed AI application. Manifests, mappings, evals, tools, safety, and observability all apply.",
};

const UNKNOWN_AI_POLICY: RepositoryModeScoringPolicy = {
  aiSystemHealthApplicable: true,
  generalHygieneApplicable: true,
  governanceApplicable: false,
  description: "AI signals detected but insufficient evidence to classify confidently. Limited governance scoring applies.",
};

export function classifyRepoMode(
  files: RepoFile[],
  hasAgentManifest: boolean,
  hasWorkflowManifest: boolean,
  hasAiSignals: boolean,
): RepositoryModeResult {
  const scanned = files.filter((f) => !f.ignored);

  // ── Non-AI ──────────────────────────────────────────────────────────────────
  if (!hasAiSignals && !hasAgentManifest && !hasWorkflowManifest) {
    return {
      mode: "non_ai",
      confidence: scanned.some((f) => f.classification === "source_code") ? "high" : "medium",
      reasons: ["No AI SDK imports, AI API environment variable names, AI function patterns, or AI-related filenames detected."],
      evidence: [],
      scoringPolicy: NO_AI_POLICY,
    };
  }

  // ── Framework / library signals ──────────────────────────────────────────────
  const frameworkSignals = detectFrameworkSignals(scanned);
  if (frameworkSignals.signals.length >= 2) {
    return {
      mode: "ai_framework_library",
      confidence: frameworkSignals.signals.length >= 3 ? "high" : "medium",
      reasons: frameworkSignals.signals,
      evidence: frameworkSignals.evidence,
      scoringPolicy: FRAMEWORK_POLICY,
    };
  }

  // ── Example / template heavy ─────────────────────────────────────────────────
  const { ratio: exampleRatio, examplePaths } = computeExampleStats(scanned);
  if (exampleRatio >= 0.5 && !hasAgentManifest && !hasWorkflowManifest) {
    return {
      mode: "example_template",
      confidence: exampleRatio >= 0.7 ? "high" : "medium",
      reasons: [
        `${Math.round(exampleRatio * 100)}% of repository files are in example/sample/demo directories.`,
        "No explicit agent or workflow manifest found to indicate a production AI system.",
      ],
      evidence: examplePaths.slice(0, 5),
      scoringPolicy: EXAMPLE_POLICY,
    };
  }

  // ── Deployed AI application ──────────────────────────────────────────────────
  const appSignals = detectApplicationSignals(scanned, hasAgentManifest, hasWorkflowManifest);
  if (appSignals.signals.length >= 1 || hasAgentManifest || hasWorkflowManifest) {
    const hasManifest = hasAgentManifest || hasWorkflowManifest;
    return {
      mode: "ai_application",
      confidence: hasManifest
        ? (appSignals.signals.length >= 2 ? "high" : "high")
        : appSignals.signals.length >= 3 ? "high" : "medium",
      reasons: [
        ...appSignals.signals,
        ...(hasManifest ? [] : []),
      ],
      evidence: appSignals.evidence,
      scoringPolicy: APP_POLICY,
    };
  }

  // ── Unknown AI (has AI signals but not enough to classify) ───────────────────
  return {
    mode: "unknown_ai",
    confidence: "low",
    reasons: ["AI signals detected (SDK imports, env variables, or AI function patterns) but insufficient evidence to classify the repository as an application, framework, or example collection."],
    evidence: [],
    scoringPolicy: UNKNOWN_AI_POLICY,
  };
}

// ── Framework detection ────────────────────────────────────────────────────────

interface DetectionResult {
  signals: string[];
  evidence: string[];
}

function detectFrameworkSignals(files: RepoFile[]): DetectionResult {
  const signals: string[] = [];
  const evidence: string[] = [];

  // 1. package.json library keywords or peerDependencies
  const pkgFile = files.find((f) => f.name === "package.json" && f.content);
  if (pkgFile?.content) {
    try {
      const pkg = JSON.parse(pkgFile.content) as Record<string, unknown>;
      const keywords = Array.isArray(pkg.keywords)
        ? (pkg.keywords as string[]).map((k) => String(k).toLowerCase())
        : [];
      const matchedKw = keywords.filter((k) => LIBRARY_KEYWORDS.has(k));
      if (matchedKw.length > 0) {
        signals.push(`package.json keywords include library/framework terms: ${matchedKw.join(", ")}`);
        evidence.push("package.json");
      }
      if (pkg.peerDependencies && typeof pkg.peerDependencies === "object") {
        signals.push("package.json declares peerDependencies (characteristic of libraries/frameworks)");
        evidence.push("package.json");
      }
      // Library pattern: has main/exports but no start/dev scripts
      const scripts = (pkg.scripts ?? {}) as Record<string, unknown>;
      if (!scripts.start && !scripts.dev && (pkg.main || pkg.exports)) {
        signals.push("package.json is library-style: exports an entry point but has no start/dev script");
        evidence.push("package.json");
      }
    } catch {
      // ignore parse errors
    }
  }

  // 2. High proportion of files in example/sample dirs
  const { ratio } = computeExampleStats(files);
  if (ratio >= 0.25) {
    signals.push(`${Math.round(ratio * 100)}% of repository files are in example/sample directories (common for framework repos)`);
  }

  // 3. Many example files in absolute count
  const exampleFiles = files.filter((f) => isExamplePath(f.path));
  if (exampleFiles.length >= 8) {
    signals.push(`${exampleFiles.length} files found in example/sample/demo directories`);
    if (exampleFiles.length > 0) evidence.push(...exampleFiles.slice(0, 3).map((f) => f.path));
  }

  // 4. No deployment config (frameworks don't deploy)
  const hasDeployConfig = files.some((f) => DEPLOYMENT_FILENAMES.has(f.name.toLowerCase()));
  if (!hasDeployConfig && signals.length >= 1) {
    signals.push("No deployment configuration found (Vercel, Docker, etc.) — consistent with a library, not a deployed app");
  }

  return { signals, evidence };
}

// ── Application detection ──────────────────────────────────────────────────────

function detectApplicationSignals(
  files: RepoFile[],
  hasAgentManifest: boolean,
  hasWorkflowManifest: boolean,
): DetectionResult {
  const signals: string[] = [];
  const evidence: string[] = [];

  if (hasAgentManifest) {
    signals.push("Explicit agent manifest (agents.yaml / agents.json) found");
    const manifestFile = files.find((f) => /^agents?\.(ya?ml|json)$/i.test(f.name));
    if (manifestFile) evidence.push(manifestFile.path);
  }
  if (hasWorkflowManifest) {
    signals.push("Explicit workflow manifest (workflow.yaml / workflow.json) found");
    const wf = files.find((f) => f.classification === "workflow_config");
    if (wf) evidence.push(wf.path);
  }

  // Deployment config
  const deployFiles = files.filter((f) => DEPLOYMENT_FILENAMES.has(f.name.toLowerCase()));
  if (deployFiles.length > 0) {
    signals.push(`Deployment configuration found: ${deployFiles.map((f) => f.name).join(", ")}`);
    evidence.push(...deployFiles.map((f) => f.path));
  }

  // App-like directory structure
  const hasAppDirs = files.some((f) => {
    const n = `/${f.path.toLowerCase()}`;
    return APP_SEGMENTS.some((seg) => n.includes(seg));
  });
  if (hasAppDirs) {
    signals.push("Application directory structure detected (/app/, /src/, /api/, etc.)");
  }

  return { signals, evidence };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isExamplePath(path: string): boolean {
  const n = `/${path.toLowerCase()}`;
  return EXAMPLE_SEGMENTS.some((seg) => n.includes(seg));
}

function computeExampleStats(files: RepoFile[]): { ratio: number; examplePaths: string[] } {
  if (files.length === 0) return { ratio: 0, examplePaths: [] };
  const exampleFiles = files.filter((f) => isExamplePath(f.path));
  return {
    ratio: exampleFiles.length / files.length,
    examplePaths: exampleFiles.map((f) => f.path),
  };
}
