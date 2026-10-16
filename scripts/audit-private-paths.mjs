#!/usr/bin/env node
/**
 * Reeprov Private Path & Leak Scanner.
 *
 * Scans the repository for leaked absolute developer machine paths:
 *   - file:///Users/<username>/...
 *   - /Users/<username>/...
 *   - /home/<username>/... (excluding standard container user /home/nextjs)
 *
 * Distinguishes real machine leaks from documentation/tests describing forbidden path rules
 * (e.g., `/Users/...`, `/home/...`, `<username>`).
 */

/* global console */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, join, extname } from "node:path";
import process from "node:process";

const SCANNED_EXTENSIONS = new Set([
  ".md",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".py",
  ".yml",
  ".yaml",
]);

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "coverage",
  "scratch",
  "__pycache__",
  ".venv",
  ".turbo",
]);

const EXCLUDED_FILES = new Set([
  "package-lock.json",
  "scripts/audit-private-paths.mjs",
]);

// Known placeholders used in documentation and tests describing rules
const PLACEHOLDER_USERNAMES = new Set([
  "...",
  "<username>",
  "<user>",
  "<name>",
  "<path>",
  "username",
  "your-username",
  "nextjs", // Docker system user
  "$USER",
  "${USER}",
]);

/**
 * Checks if a matched username is a generic documentation placeholder.
 */
function isPlaceholderUsername(user) {
  if (!user) return true;
  const normalized = user.trim().toLowerCase();
  if (PLACEHOLDER_USERNAMES.has(normalized)) return true;
  if (normalized.startsWith("<") && normalized.endsWith(">")) return true;
  if (normalized.startsWith("$")) return true;
  if (normalized === "...") return true;
  if (normalized.includes("...")) return true;
  return false;
}

/**
 * Scans a single line for forbidden private absolute paths.
 * Returns the matched violation string if found, or null.
 */
export function checkLineForPrivatePath(line) {
  // If line contains an explicit audit-ignore directive
  if (line.includes("audit-ignore")) {
    return null;
  }

  // Check for file:///Users/<user> or file:///home/<user>
  const fileUriRegex = /file:\/\/\/(Users|home)\/([a-zA-Z0-9_.-]+)/g;
  let match;
  while ((match = fileUriRegex.exec(line)) !== null) {
    const [, , user] = match;
    if (!isPlaceholderUsername(user)) {
      return match[0];
    }
  }

  // Check for /Users/<user>/... or /home/<user>/...
  const absPathRegex = /(?:^|[\s"'`([<])\/(Users|home)\/([a-zA-Z0-9_.-]+)/g;
  while ((match = absPathRegex.exec(line)) !== null) {
    const [, , user] = match;
    if (!isPlaceholderUsername(user)) {
      return match[0].trim();
    }
  }

  return null;
}

/**
 * Recursively collects all files to audit.
 */
export function collectFiles(dir, options = {}) {
  const rootDir = options.rootDir || dir;
  const includeFixtures = options.includeFixtures ?? false;
  const results = [];

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const relPath = relative(rootDir, fullPath);

    if (EXCLUDED_FILES.has(relPath) || EXCLUDED_FILES.has(entry)) {
      continue;
    }

    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry)) {
        continue;
      }
      // Unless explicitly testing fixtures, skip deliberate bad-path fixture dir
      if (!includeFixtures && relPath.replace(/\\/g, "/").startsWith("tests/fixtures/privacy")) {
        continue;
      }
      results.push(...collectFiles(fullPath, { ...options, rootDir }));
    } else if (stat.isFile()) {
      const ext = extname(entry).toLowerCase();
      if (SCANNED_EXTENSIONS.has(ext) || entry === "Dockerfile") {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * Audits a file or directory for private paths.
 */
export function auditPaths(targetPath, options = {}) {
  const stat = statSync(targetPath);
  const files = stat.isFile() ? [targetPath] : collectFiles(targetPath, options);
  const violations = [];

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const violation = checkLineForPrivatePath(line);
      if (violation) {
        violations.push({
          file,
          relativeFile: relative(process.cwd(), file),
          line: i + 1,
          matched: violation,
          content: line.trim(),
        });
      }
    }
  }

  return {
    scannedFileCount: files.length,
    violations,
    clean: violations.length === 0,
  };
}

// Direct execution CLI entrypoint
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith("audit-private-paths.mjs") ||
    process.argv[1].endsWith("audit-private-paths"));

if (isDirectExecution) {
  const args = process.argv.slice(2);
  const includeFixtures = args.includes("--include-fixtures");
  const targetDir = args.find((a) => !a.startsWith("--")) || process.cwd();

  const result = auditPaths(resolve(targetDir), { includeFixtures });

  if (!result.clean) {
    console.error(
      `\x1b[31m[Audit Private Paths] FAILED: Found ${result.violations.length} forbidden private path leak(s):\x1b[0m\n`
    );
    for (const v of result.violations) {
      console.error(`  \x1b[33m${v.relativeFile}:${v.line}\x1b[0m -> ${v.matched}`);
      console.error(`    "${v.content}"\n`);
    }
    process.exit(1);
  } else {
    console.log(
      `\x1b[32m[Audit Private Paths] PASSED: Scanned ${result.scannedFileCount} files. Zero private developer paths detected.\x1b[0m`
    );
    process.exit(0);
  }
}
