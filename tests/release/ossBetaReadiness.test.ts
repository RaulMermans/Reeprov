import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

describe("Sprint 11: Open-Source Beta Release Readiness & Supply Chain Audit", () => {
  const rootDir = process.cwd();

  it("Item 1 & 2: root LICENSE exists with Apache-2.0 and valid copyright notice", () => {
    const licensePath = resolve(rootDir, "LICENSE");
    expect(existsSync(licensePath)).toBe(true);
    const content = readFileSync(licensePath, "utf8");
    expect(content).toContain("Apache License");
    expect(content).toContain("Version 2.0");
    expect(content).toContain("Copyright 2024-present AgentPulse Contributors");
  });

  it("Item 3: root package.json has intentional private posture, Apache-2.0, bin mapping, and direct jiti dependency", () => {
    const pkgPath = resolve(rootDir, "package.json");
    expect(existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

    expect(pkg.license).toBe("Apache-2.0");
    expect(pkg.version).toBe("0.1.0-beta.1");
    expect(pkg.private).toBe(true);
    expect(pkg.author).toBe("AgentPulse Contributors");
    expect(pkg.engines?.node).toBeDefined();
    expect(pkg.bin?.pulse).toBe("./bin/pulse.mjs");
    expect(pkg.dependencies?.jiti).toBeDefined();
  });

  it("Item 4 & 5: TypeScript SDK package (@agentpulse/client) is standalone and correctly structured", () => {
    const tsPkgDir = resolve(rootDir, "packages/client-typescript");
    expect(existsSync(resolve(tsPkgDir, "package.json"))).toBe(true);
    expect(existsSync(resolve(tsPkgDir, "tsconfig.json"))).toBe(true);
    expect(existsSync(resolve(tsPkgDir, "README.md"))).toBe(true);
    expect(existsSync(resolve(tsPkgDir, "LICENSE"))).toBe(true);
    expect(existsSync(resolve(tsPkgDir, "src/index.ts"))).toBe(true);
    expect(existsSync(resolve(tsPkgDir, "src/client.ts"))).toBe(true);
    expect(existsSync(resolve(tsPkgDir, "src/types.ts"))).toBe(true);

    const tsPkg = JSON.parse(readFileSync(resolve(tsPkgDir, "package.json"), "utf8"));
    expect(tsPkg.name).toBe("@agentpulse/client");
    expect(tsPkg.version).toBe("0.1.0-beta.1");
    expect(tsPkg.license).toBe("Apache-2.0");
    expect(tsPkg.main).toBe("dist/index.js");
    expect(tsPkg.types).toBe("dist/index.d.ts");
    expect(tsPkg.private).toBeUndefined(); // publishable SDK
  });

  it("Item 7 & 8: Python SDK package (agentpulse-client) is standalone and correctly structured", () => {
    const pyPkgDir = resolve(rootDir, "packages/client-python");
    expect(existsSync(resolve(pyPkgDir, "pyproject.toml"))).toBe(true);
    expect(existsSync(resolve(pyPkgDir, "setup.py"))).toBe(true);
    expect(existsSync(resolve(pyPkgDir, "README.md"))).toBe(true);
    expect(existsSync(resolve(pyPkgDir, "LICENSE"))).toBe(true);
    expect(existsSync(resolve(pyPkgDir, "src/agentpulse_client/__init__.py"))).toBe(true);
    expect(existsSync(resolve(pyPkgDir, "src/agentpulse_client/client.py"))).toBe(true);

    const pyProject = readFileSync(resolve(pyPkgDir, "pyproject.toml"), "utf8");
    expect(pyProject).toContain('name = "agentpulse-client"');
    expect(pyProject).toContain('version = "0.1.0b1"');
    expect(pyProject).toContain('license = {text = "Apache-2.0"}');
  });

  it("Item 11, 13 & 46: CLI binary executes and responds to --version and --help without repo assumptions", () => {
    const cliPath = resolve(rootDir, "bin/pulse.mjs");
    expect(existsSync(cliPath)).toBe(true);

    const versionOut = execFileSync("node", [cliPath, "--version"], { encoding: "utf8" }).trim();
    expect(versionOut).toContain("AgentPulse v0.1.0-beta.1 (beta)");

    const helpOut = execFileSync("node", [cliPath, "--help"], { encoding: "utf8" }).trim();
    expect(helpOut).toContain("AgentPulse CLI");
    expect(helpOut).toContain("pulse --version");
    expect(helpOut).toContain("pulse data-path");
    expect(helpOut).toContain("pulse replay");
  });

  it("Item 17 & 18: Docker self-host configuration exists and enforces non-root and mandatory secrets", () => {
    const dockerfilePath = resolve(rootDir, "Dockerfile");
    const composePath = resolve(rootDir, "docker-compose.yml");
    const ignorePath = resolve(rootDir, ".dockerignore");

    expect(existsSync(dockerfilePath)).toBe(true);
    expect(existsSync(composePath)).toBe(true);
    expect(existsSync(ignorePath)).toBe(true);

    const dockerfile = readFileSync(dockerfilePath, "utf8");
    expect(dockerfile).toContain("USER nextjs");
    expect(dockerfile).toContain("HEALTHCHECK");

    const compose = readFileSync(composePath, "utf8");
    expect(compose).toContain("127.0.0.1:3000:3000"); // Secure loopback default
    expect(compose).toContain("AGENTPULSE_ACCESS_KEY");
  });

  it("Item 22 & 23: Zero private developer absolute paths exist in documentation or code", () => {
    const checkGrep = (term: string) => {
      try {
        const out = execFileSync(
          "grep",
          [
            "-rn",
            term,
            "--include=*.md",
            "--include=*.ts",
            "--include=*.js",
            "--include=*.json",
            "--include=*.py",
            ".",
            "--exclude-dir=node_modules",
            "--exclude-dir=.next",
            "--exclude-dir=.git",
            "--exclude=package-lock.json",
          ],
          { cwd: rootDir, encoding: "utf8" }
        );
        // Exclude self, documentation rules in CONTRIBUTING/PR template, and AGENTS.md / CLAUDE.md
        const validHits = out
          .split("\n")
          .filter((line) => line.trim())
          .filter(
            (line) =>
              !line.includes("ossBetaReadiness.test.ts") &&
              !line.includes("CONTRIBUTING.md") &&
              !line.includes("PULL_REQUEST_TEMPLATE.md") &&
              !line.includes("PUBLICATION_READINESS_REPORT.md") &&
              !line.includes("AGENTS.md") &&
              !line.includes("CLAUDE.md")
          );
        return validHits;
      } catch {
        return [];
      }
    };

    expect(checkGrep("file:///Users/")).toEqual([]);
    expect(checkGrep("/Users/raulm")).toEqual([]);
  });

  it("Item 24 & 25: Root SECURITY.md exists with supported versions and responsible disclosure", () => {
    const secPath = resolve(rootDir, "SECURITY.md");
    expect(existsSync(secPath)).toBe(true);
    const content = readFileSync(secPath, "utf8");
    expect(content).toContain("Supported Versions");
    expect(content).toContain("Reporting a Vulnerability");
    expect(content).toContain("Sensitive Trace Data");
  });

  it("Item 26: Root CONTRIBUTING.md exists with clear setup, quality gates, and architecture", () => {
    const contribPath = resolve(rootDir, "CONTRIBUTING.md");
    expect(existsSync(contribPath)).toBe(true);
    const content = readFileSync(contribPath, "utf8");
    expect(content).toContain("npm run ci");
    expect(content).toContain("No Network-Dependent Tests");
  });

  it("Item 27: Root CODE_OF_CONDUCT.md exists using Contributor Covenant v2.1", () => {
    const cocPath = resolve(rootDir, "CODE_OF_CONDUCT.md");
    expect(existsSync(cocPath)).toBe(true);
    const content = readFileSync(cocPath, "utf8");
    expect(content).toContain("Contributor Covenant");
  });

  it("Item 28 & 29: GitHub issue templates and PR template exist with security warnings", () => {
    expect(existsSync(resolve(rootDir, ".github/ISSUE_TEMPLATE/bug_report.yml"))).toBe(true);
    expect(existsSync(resolve(rootDir, ".github/ISSUE_TEMPLATE/feature_request.yml"))).toBe(true);
    expect(existsSync(resolve(rootDir, ".github/ISSUE_TEMPLATE/integration_request.yml"))).toBe(true);
    expect(existsSync(resolve(rootDir, ".github/PULL_REQUEST_TEMPLATE.md"))).toBe(true);

    const bugReport = readFileSync(resolve(rootDir, ".github/ISSUE_TEMPLATE/bug_report.yml"), "utf8");
    expect(bugReport).toContain("Do NOT upload trace payloads");
  });

  it("Item 30 & 31: CHANGELOG.md exists and documents 0.1.0-beta.1 capabilities", () => {
    const changelogPath = resolve(rootDir, "CHANGELOG.md");
    expect(existsSync(changelogPath)).toBe(true);
    const content = readFileSync(changelogPath, "utf8");
    expect(content).toContain("[0.1.0-beta.1]");
    expect(content).toContain("Capture");
    expect(content).toContain("Offline Replay");
    expect(content).toContain("Fork");
    expect(content).toContain("Studio");
  });

  it("Item 33: Documentation index (docs/README.md) comprehensively indexes all architecture and product guides", () => {
    const docsIdx = resolve(rootDir, "docs/README.md");
    expect(existsSync(docsIdx)).toBe(true);
    const content = readFileSync(docsIdx, "utf8");
    expect(content).toContain("Getting Started");
    expect(content).toContain("Product Guides");
    expect(content).toContain("Architecture Specifications");
    expect(content).toContain("Security");
  });

  it("Item 34: .env.example accurately reflects deployment modes without stale assumptions", () => {
    const envPath = resolve(rootDir, ".env.example");
    expect(existsSync(envPath)).toBe(true);
    const content = readFileSync(envPath, "utf8");
    expect(content).toContain("AGENTPULSE_MODE=personal_local");
    expect(content).toContain("AGENTPULSE_ACCESS_KEY");
    expect(content).toContain("DATABASE_URL");
  });

  it("Item 61 & 63: Release workflow is manual/approval-gated and never publishes automatically from PRs", () => {
    const releaseWorkflow = resolve(rootDir, ".github/workflows/release.yml");
    expect(existsSync(releaseWorkflow)).toBe(true);
    const content = readFileSync(releaseWorkflow, "utf8");
    expect(content).toContain("workflow_dispatch:");
    expect(content).not.toContain("push:");
    expect(content).not.toContain("pull_request:");
    expect(content).toContain("environment: production");
  });
});
