#!/usr/bin/env node
/**
 * AgentPulse Release Version Consistency Validator.
 *
 * Enforces deterministic version alignment across all release artifacts:
 *   - Release input (CLI argument or env)
 *   - Root application manifest (package.json)
 *   - TypeScript SDK manifest (packages/client-typescript/package.json)
 *   - Python SDK pyproject.toml (PEP 440 equivalent)
 *   - Python SDK setup.py (PEP 440 equivalent)
 *   - Python SDK package __init__.py (PEP 440 equivalent)
 *   - Git tag (GITHUB_REF_NAME or --tag, if provided)
 *
 * Any mismatch aborts with exit code 1 before publication.
 */

/* global console */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

/**
 * Converts a standard SemVer string (e.g., 0.1.0-beta.1) into its canonical PEP 440 equivalent (e.g., 0.1.0b1).
 */
export function semverToPep440(semver) {
  if (!semver || typeof semver !== "string") {
    throw new Error(`Invalid version: ${semver}`);
  }
  const clean = semver.startsWith("v") ? semver.slice(1) : semver;
  const match = /^(\d+\.\d+\.\d+)(?:-([a-zA-Z0-9.]+))?$/.exec(clean);
  if (!match) {
    throw new Error(`Invalid SemVer format: ${semver}`);
  }

  const [, base, prerelease] = match;
  if (!prerelease) {
    return base;
  }

  const preMatch = /^(beta|b|alpha|a|rc|preview)\.?(\d+)?$/i.exec(prerelease);
  if (preMatch) {
    let type = preMatch[1].toLowerCase();
    if (type === "beta") type = "b";
    if (type === "alpha") type = "a";
    if (type === "preview") type = "rc";
    const num = preMatch[2] !== undefined ? preMatch[2] : "0";
    return `${base}${type}${num}`;
  }

  throw new Error(`Unsupported prerelease format for PEP 440 conversion: ${prerelease}`);
}

/**
 * Normalizes a git tag or version input to SemVer (stripping leading 'v').
 */
export function normalizeSemver(version) {
  if (!version) return "";
  return version.startsWith("v") ? version.slice(1) : version;
}

/**
 * Validates version consistency across repository manifests.
 */
export function validateVersions(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const inputVersion = options.inputVersion ? normalizeSemver(options.inputVersion) : null;
  const gitTag = options.gitTag ? normalizeSemver(options.gitTag) : null;

  const checks = [];
  let hasFailure = false;

  // 1. Root package.json
  const rootPkgPath = resolve(rootDir, "package.json");
  if (!existsSync(rootPkgPath)) {
    throw new Error(`Root package.json not found at ${rootPkgPath}`);
  }
  const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
  const rootVersion = rootPkg.version;
  const canonicalSemver = inputVersion || rootVersion;
  const expectedPep440 = semverToPep440(canonicalSemver);

  if (rootVersion !== canonicalSemver) {
    checks.push({
      component: "Root package.json",
      expected: canonicalSemver,
      actual: rootVersion,
      valid: false,
    });
    hasFailure = true;
  } else {
    checks.push({
      component: "Root package.json",
      expected: canonicalSemver,
      actual: rootVersion,
      valid: true,
    });
  }

  // 2. TypeScript SDK package.json
  const tsPkgPath = resolve(rootDir, "packages/client-typescript/package.json");
  if (!existsSync(tsPkgPath)) {
    throw new Error(`TypeScript SDK package.json not found at ${tsPkgPath}`);
  }
  const tsPkg = JSON.parse(readFileSync(tsPkgPath, "utf8"));
  const tsVersion = tsPkg.version;
  const tsValid = tsVersion === canonicalSemver;
  if (!tsValid) hasFailure = true;
  checks.push({
    component: "TypeScript SDK (@agentpulse/client)",
    expected: canonicalSemver,
    actual: tsVersion,
    valid: tsValid,
  });

  // 3. Python SDK pyproject.toml
  const pyprojectPath = resolve(rootDir, "packages/client-python/pyproject.toml");
  if (!existsSync(pyprojectPath)) {
    throw new Error(`Python SDK pyproject.toml not found at ${pyprojectPath}`);
  }
  const pyprojectContent = readFileSync(pyprojectPath, "utf8");
  const pyprojectMatch = /version\s*=\s*["']([^"']+)["']/.exec(pyprojectContent);
  const pyprojectVersion = pyprojectMatch ? pyprojectMatch[1] : "UNKNOWN";
  const pyprojectValid = pyprojectVersion === expectedPep440;
  if (!pyprojectValid) hasFailure = true;
  checks.push({
    component: "Python SDK (pyproject.toml)",
    expected: expectedPep440,
    actual: pyprojectVersion,
    valid: pyprojectValid,
  });

  // 4. Python SDK setup.py
  const setupPyPath = resolve(rootDir, "packages/client-python/setup.py");
  if (!existsSync(setupPyPath)) {
    throw new Error(`Python SDK setup.py not found at ${setupPyPath}`);
  }
  const setupPyContent = readFileSync(setupPyPath, "utf8");
  const setupPyMatch = /version\s*=\s*["']([^"']+)["']/.exec(setupPyContent);
  const setupPyVersion = setupPyMatch ? setupPyMatch[1] : "UNKNOWN";
  const setupPyValid = setupPyVersion === expectedPep440;
  if (!setupPyValid) hasFailure = true;
  checks.push({
    component: "Python SDK (setup.py)",
    expected: expectedPep440,
    actual: setupPyVersion,
    valid: setupPyValid,
  });

  // 5. Python SDK __init__.py
  const pyInitPath = resolve(rootDir, "packages/client-python/src/agentpulse_client/__init__.py");
  if (!existsSync(pyInitPath)) {
    throw new Error(`Python SDK __init__.py not found at ${pyInitPath}`);
  }
  const pyInitContent = readFileSync(pyInitPath, "utf8");
  const pyInitMatch = /__version__\s*=\s*["']([^"']+)["']/.exec(pyInitContent);
  const pyInitVersion = pyInitMatch ? pyInitMatch[1] : "UNKNOWN";
  const pyInitValid = pyInitVersion === expectedPep440;
  if (!pyInitValid) hasFailure = true;
  checks.push({
    component: "Python SDK (__init__.py)",
    expected: expectedPep440,
    actual: pyInitVersion,
    valid: pyInitValid,
  });

  // 6. Git Tag check (if provided or present in CI environment)
  if (gitTag) {
    const tagValid = gitTag === canonicalSemver;
    if (!tagValid) hasFailure = true;
    checks.push({
      component: "Git Tag",
      expected: canonicalSemver,
      actual: gitTag,
      valid: tagValid,
    });
  }

  return {
    canonicalSemver,
    expectedPep440,
    checks,
    valid: !hasFailure,
  };
}

// Direct CLI entrypoint
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith("validate-release-version.mjs") ||
    process.argv[1].endsWith("validate-release-version"));

if (isDirectExecution) {
  const args = process.argv.slice(2);
  let inputVersion = null;
  let gitTag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--version" && args[i + 1]) {
      inputVersion = args[i + 1];
      i++;
    } else if (args[i] === "--tag" && args[i + 1]) {
      gitTag = args[i + 1];
      i++;
    } else if (!args[i].startsWith("--") && !inputVersion) {
      inputVersion = args[i];
    }
  }

  const result = validateVersions({ inputVersion, gitTag });

  console.log("\n========================================================");
  console.log(" AgentPulse Release Version Consistency Check");
  console.log("========================================================");
  console.log(`Target SemVer:     ${result.canonicalSemver}`);
  console.log(`Target PEP 440:    ${result.expectedPep440}`);
  console.log("--------------------------------------------------------");

  for (const check of result.checks) {
    const status = check.valid ? "\x1b[32m[PASS]\x1b[0m" : "\x1b[31m[FAIL]\x1b[0m";
    console.log(
      `${status} ${check.component.padEnd(38)} Expected: ${check.expected.padEnd(16)} Actual: ${check.actual}`
    );
  }
  console.log("========================================================\n");

  if (!result.valid) {
    console.error(
      "\x1b[31m[ABORT] Release version mismatch detected across artifacts or tags. Publication halted.\x1b[0m\n"
    );
    process.exit(1);
  } else {
    console.log(
      "\x1b[32m[OK] All package versions and release artifacts are deterministically aligned.\x1b[0m\n"
    );
    process.exit(0);
  }
}
