#!/usr/bin/env node
/**
 * Reeprov Brand Rename Audit Script.
 *
 * Deterministically scans the repository for occurrences of AgentPulse/agentpulse
 * and verifies that zero unapproved active product hits remain.
 *
 * Outputs rename-audit.json and exits 0 on success, 1 on failure.
 */
/* global console */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, relative, join, extname } from "node:path";
import process from "node:process";

const rootDir = process.cwd();

// Patterns to search for
const BRAND_TERMS = [
  "AgentPulse",
  "agentpulse",
  "AGENTPULSE",
  "Agent Pulse",
  "@agentpulse",
  "agentpulse-client",
  "agentpulse_client",
  "x-agentpulse",
  "ap_live_",
  ".agentpulse",
];

// Directories to ignore completely (build artifacts, VCS, dependencies, local storage)
const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "coverage",
  ".turbo",
  "__pycache__",
  ".venv",
  "venv",
  "build",
  ".pytest_cache",
  "egg-info",
  ".agentpulse",
  ".reeprov",
]);

// File extensions to scan
const SCANNED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".py",
  ".md",
  ".yml",
  ".yaml",
  ".dockerfile",
  ".env",
]);

// Approved legacy/historical documentation and fixtures
const APPROVED_LEGACY_FILES = new Set([
  "docs/migration/agentpulse-to-reeprov.md",
  "docs/architecture/agentpulse-north-star.md",
  "docs/architecture/reeprov-north-star.md",
  "docs/architecture/capability-history.md",
  "docs/architecture/north-star-reconciliation.md",
  "docs/architecture/release-evidence.md",
  "docs/architecture/access-control.md",
  "docs/ARCHITECTURE.md",
  "docs/DEPLOYMENT.md",
  "docs/INTEGRATION_GUIDE.md",
  "docs/product/personal-local-mode.md",
  "docs/product/self-hosted-mode.md",
  "docs/integrations/frameworks.md",
  "docs/dogfood/iris.md",
  "docs/dogfood/iris-dogfood-friction.md",
  "tests/fixtures/privacy/bad-paths-fixture.md",
  "rename-manifest.json",
  "rename-audit.json",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "PUBLICATION_READINESS_REPORT.md",
  "package-lock.json",
  "memory/MEMORY.md",
]);

// Approved legacy code lines / patterns (backward-compatibility fallbacks)
function isApprovedCodeHit(relPath, line) {
  // All automated test files testing backward compatibility or fixtures
  if (relPath.includes("__tests__") || relPath.includes(".test.") || relPath.startsWith("tests/")) {
    return true;
  }

  // README migration section & env var fallback table
  if (relPath === "README.md" && (line.includes("AGENTPULSE_") || line.includes("AgentPulse") || line.includes("migrate-brand") || line.includes("agentpulse"))) {
    return true;
  }

  // Python legacy wrapper package and tests
  if (relPath.startsWith("packages/client-python/src/agentpulse_client/")) {
    return true;
  }
  if (relPath === "packages/client-python/tests/test_client.py") {
    return true;
  }

  // TypeScript legacy export aliases & fallbacks
  if (relPath === "packages/client-typescript/src/index.ts" && line.includes("AgentPulseClient")) {
    return true;
  }
  if (relPath === "packages/client-typescript/src/client.ts" && (line.includes("AgentPulseClient") || line.includes("AgentPulseError") || line.includes("agentpulse") || line.includes("AGENTPULSE_"))) {
    return true;
  }
  if (relPath === "packages/client-typescript/src/types.ts" && line.includes("AgentPulseClientOptions")) {
    return true;
  }

  // Python canonical package legacy aliases & fallbacks
  if (relPath === "packages/client-python/src/reeprov_client/__init__.py" && (line.includes("AgentPulseClient") || line.includes("AgentPulseError"))) {
    return true;
  }
  if (relPath === "packages/client-python/src/reeprov_client/client.py" && (line.includes("AgentPulseClient") || line.includes("AgentPulseError") || line.includes("agentpulse") || line.includes("AGENTPULSE_"))) {
    return true;
  }

  // Explicitly isolated legacy compatibility wrappers in examples
  if (
    relPath === "examples/integrations/campaign-sandbox/agentpulse-client.ts" ||
    relPath === "examples/integrations/python/agentpulse_client.py" ||
    relPath === "examples/integrations/typescript/agentpulseClient.ts" ||
    relPath === "examples/dogfood/python-support-agent/agentpulse_client.py" ||
    relPath === "examples/dogfood/typescript-support-agent/agentpulseClient.ts"
  ) {
    return true;
  }

  // CLI legacy delegating wrappers
  if (relPath === "bin/pulse.ts" || relPath === "bin/pulse.mjs" || relPath === "bin/start-agentpulse.mjs" || relPath === "scripts/pulse-cli.ts") {
    return true;
  }
  if (relPath === "scripts/start-agentpulse.ts") {
    return true;
  }
  if (relPath === "package.json" && (line.includes('"pulse":') || line.includes('"start-agentpulse":'))) {
    return true;
  }

  // Launcher environment fallback checks in scripts/start-reeprov.ts
  if (relPath === "scripts/start-reeprov.ts" && line.includes("AGENTPULSE_")) {
    return true;
  }

  // Central environment fallback layer in lib/config/env.ts
  if (relPath === "lib/config/env.ts") {
    return true;
  }

  // Operating mode & auth fallbacks for AGENTPULSE_* and x-agentpulse-key
  if (relPath === "lib/auth/operatingMode.ts" && line.includes("AGENTPULSE_")) {
    return true;
  }
  if (relPath === "lib/auth/accessControl.ts" && (line.includes("x-agentpulse-key") || line.includes("AGENTPULSE_ACCESS_KEY") || line.includes("ap_live_"))) {
    return true;
  }
  if (relPath === "lib/auth/requireIngestKey.ts" && (line.includes("AGENTPULSE_") || line.includes("x-agentpulse-key"))) {
    return true;
  }
  if (relPath === "lib/auth/internalKey.ts" && (line.includes("agentpulse_access_key") || line.includes("x-agentpulse-key"))) {
    return true;
  }
  if (relPath === "lib/auth/session.ts" && (line.includes("agentpulse_session") || line.includes("AGENTPULSE_"))) {
    return true;
  }
  if (relPath === "app/api/auth/unlock/route.ts" && (line.includes("AGENTPULSE_") || line.includes("x-agentpulse-key") || line.includes("agentpulse_session"))) {
    return true;
  }

  // Storage path & DB table prefixes (ap_* mandated by Section 23)
  if (relPath === "lib/storage/dataPath.ts" && (line.includes(".agentpulse") || line.includes("AGENTPULSE_") || line.includes("getAgentPulseHome") || line.includes("agentpulse.db"))) {
    return true;
  }
  if (relPath === "scripts/migrate-brand.ts" && (line.includes(".agentpulse") || line.includes("AgentPulse") || line.includes("AGENTPULSE_"))) {
    return true;
  }
  if (line.includes("ap_") && (relPath.startsWith("lib/db/") || relPath.includes("schema") || relPath.includes("migrate"))) {
    return true;
  }

  // Ingest key support for legacy ap_live_
  if (relPath === "lib/integrations/ingestKey.ts" && (line.includes("ap_live_") || line.includes("AGENTPULSE_"))) {
    return true;
  }
  if ((relPath === "lib/integrations/integrationTypes.ts" || relPath === "lib/projects/projectTypes.ts") && line.includes("ap_live_")) {
    return true;
  }

  // In-tree client legacy aliases
  if (relPath === "lib/proof-layer/client.ts") {
    return true;
  }

  // Dashboard pulse & DB health legacy export aliases
  if (relPath === "lib/dashboard/buildDashboardPulse.ts" && line.includes("AgentPulseDashboardPulse")) {
    return true;
  }
  if (relPath === "lib/db/storageHealth.ts" && (line.includes("AGENTPULSE_TABLES") || line.includes("AgentPulse"))) {
    return true;
  }

  // DashboardClient version fallback
  if (relPath === "components/dashboard/DashboardClient.tsx" && line.includes("NEXT_PUBLIC_AGENTPULSE_VERSION")) {
    return true;
  }

  // Core capture, contracts, and evaluation legacy aliases & fallbacks
  if (relPath === "lib/core/adapters/legacyRunAdapter.ts") {
    return true;
  }
  if (relPath === "lib/core/capture/sdk.ts" && (line.includes("AgentPulseCaptureService") || line.includes("agentpulse"))) {
    return true;
  }
  if ((relPath === "lib/core/capture/policy.ts" || relPath === "lib/core/capture/redaction.ts") && (line.includes("x-agentpulse-key") || line.includes("AGENTPULSE_"))) {
    return true;
  }
  if (relPath === "lib/core/fork/patch.ts" && line.includes("__agentpulse")) {
    return true;
  }
  if ((relPath === "lib/core/contracts/contextIntelligence.ts" || relPath === "lib/core/contracts/memoryIntelligence.ts") && line.includes("AgentPulse")) {
    return true;
  }

  // Version script checking legacy fallbacks
  if (relPath === "scripts/validate-release-version.mjs" && (line.includes("agentpulse_client") || line.includes("AgentPulse"))) {
    return true;
  }

  // Historical prompt specifications
  if (relPath.startsWith("prompts/")) {
    return true;
  }

  return false;
}

function scanDir(dir, results) {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        scanDir(fullPath, results);
      }
      continue;
    }

    const ext = extname(entry.name).toLowerCase();
    const basename = entry.name.toLowerCase();

    const isExtensionlessPublicFile =
      ext === "" && (
        basename === "license" ||
        basename.startsWith("license.") ||
        basename.startsWith("license-") ||
        basename === "notice" ||
        basename.startsWith("notice.") ||
        basename.startsWith("notice-") ||
        basename === "dockerfile" ||
        basename.startsWith("dockerfile.")
      );

    if (
      !SCANNED_EXTENSIONS.has(ext) &&
      !basename.startsWith("dockerfile") &&
      !basename.startsWith(".env") &&
      !isExtensionlessPublicFile
    ) {
      continue;
    }

    if (relPath === "rename-audit.json" || relPath === "scripts/audit-rename.mjs") {
      continue;
    }

    let content;
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const term of BRAND_TERMS) {
        if (line.includes(term)) {
          const isApproved = APPROVED_LEGACY_FILES.has(relPath) || isApprovedCodeHit(relPath, line);
          results.push({
            file: relPath,
            line: i + 1,
            term,
            matchedText: line.trim(),
            status: isApproved ? "approved_legacy" : "unapproved_active",
          });
          break; // Avoid multi-matching the same line with overlapping terms
        }
      }
    }
  }
}

function runAudit() {
  const results = [];
  scanDir(rootDir, results);

  const approvedHits = results.filter((r) => r.status === "approved_legacy");
  const unapprovedHits = results.filter((r) => r.status === "unapproved_active");

  const summary = {
    timestamp: new Date().toISOString(),
    total_scanned_hits: results.length,
    approved_legacy_hits: approvedHits.length,
    unapproved_active_hits: unapprovedHits.length,
    status: unapprovedHits.length === 0 ? "PASSED" : "FAILED",
    unapproved_items: unapprovedHits,
  };

  const auditPath = resolve(rootDir, "rename-audit.json");
  writeFileSync(auditPath, JSON.stringify(summary, null, 2), "utf-8");

  console.log("=================================================");
  console.log(" Reeprov Brand Rename Audit Report");
  console.log("=================================================");
  console.log(`Total Hits Found:       ${results.length}`);
  console.log(`Approved Legacy Hits:   ${approvedHits.length}`);
  console.log(`Unapproved Active Hits: ${unapprovedHits.length}`);
  console.log(`Audit Result:           ${summary.status}`);
  console.log("=================================================");

  if (unapprovedHits.length > 0) {
    console.error(`\nFound ${unapprovedHits.length} unapproved active product hits:`);
    for (const hit of unapprovedHits.slice(0, 20)) {
      console.error(`  - ${hit.file}:${hit.line} [${hit.term}]: ${hit.matchedText}`);
    }
    if (unapprovedHits.length > 20) {
      console.error(`  ... and ${unapprovedHits.length - 20} more.`);
    }
    process.exit(1);
  } else {
    console.log("\nSuccess: Zero unapproved active brand hits remaining.");
    process.exit(0);
  }
}

runAudit();
