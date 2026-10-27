import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  semverToPep440,
  normalizeSemver,
  validateVersions,
} from "../../scripts/validate-release-version.mjs";

describe("Release Version Consistency & Deterministic Alignment", () => {
  const rootDir = process.cwd();
  const validatorScript = resolve(rootDir, "scripts/validate-release-version.mjs");

  describe("semverToPep440 conversion logic", () => {
    it("converts beta semver to PEP 440", () => {
      expect(semverToPep440("0.1.0-beta.1")).toBe("0.1.0b1");
      expect(semverToPep440("v0.1.0-beta.2")).toBe("0.1.0b2");
    });

    it("converts rc semver to PEP 440", () => {
      expect(semverToPep440("0.1.0-rc.1")).toBe("0.1.0rc1");
      expect(semverToPep440("v1.0.0-rc.3")).toBe("1.0.0rc3");
    });

    it("converts alpha semver to PEP 440", () => {
      expect(semverToPep440("0.2.0-alpha.1")).toBe("0.2.0a1");
    });

    it("handles final release semver without prerelease", () => {
      expect(semverToPep440("1.0.0")).toBe("1.0.0");
      expect(semverToPep440("v0.1.0")).toBe("0.1.0");
    });

    it("throws on invalid semver format", () => {
      expect(() => semverToPep440("invalid-version")).toThrow();
    });
  });

  describe("normalizeSemver", () => {
    it("strips leading v", () => {
      expect(normalizeSemver("v0.1.0-beta.1")).toBe("0.1.0-beta.1");
      expect(normalizeSemver("0.1.0-beta.1")).toBe("0.1.0-beta.1");
    });
  });

  describe("validateVersions on repository", () => {
    it("passes cleanly when all repo manifests match", () => {
      const result = validateVersions({ rootDir, inputVersion: "0.2.0-beta.1", gitTag: "v0.2.0-beta.1" });
      expect(result.valid).toBe(true);
      expect(result.canonicalSemver).toBe("0.2.0-beta.1");
      expect(result.expectedPep440).toBe("0.2.0b1");
      expect(result.checks.every((c) => c.valid)).toBe(true);
    });

    it("aborts when git tag does not match artifacts", () => {
      const result = validateVersions({ rootDir, inputVersion: "0.2.0-beta.1", gitTag: "v0.9.9" });
      expect(result.valid).toBe(false);
      const tagCheck = result.checks.find((c) => c.component === "Git Tag");
      expect(tagCheck?.valid).toBe(false);
      expect(tagCheck?.expected).toBe("0.2.0-beta.1");
      expect(tagCheck?.actual).toBe("0.9.9");
    });

    it("aborts when release input does not match repo version", () => {
      const result = validateVersions({ rootDir, inputVersion: "0.2.0" });
      expect(result.valid).toBe(false);
    });
  });

  describe("CLI execution of validate-release-version.mjs", () => {
    const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, "");

    it("exits 0 with matching versions", () => {
      const rawOut = execFileSync(
        "node",
        [validatorScript, "--version", "0.2.0-beta.1", "--tag", "v0.2.0-beta.1"],
        { cwd: rootDir, encoding: "utf8" }
      );
      const out = stripAnsi(rawOut);
      expect(out).toContain("[PASS] Root package.json");
      expect(out).toContain("[PASS] TypeScript SDK");
      expect(out).toContain("[PASS] Python SDK (pyproject.toml)");
      expect(out).toContain("[PASS] Python SDK (setup.py)");
      expect(out).toContain("[PASS] Python SDK (__init__.py)");
      expect(out).toContain("[PASS] Git Tag");
      expect(out).toContain("[OK] All package versions and release artifacts are deterministically aligned");
    });

    it("exits 1 with mismatched tag", () => {
      let failed = false;
      try {
        execFileSync(
          "node",
          [validatorScript, "--version", "0.2.0-beta.1", "--tag", "v0.9.0"],
          { cwd: rootDir, encoding: "utf8", stdio: "pipe" }
        );
      } catch (err: any) {
        failed = true;
        const out = stripAnsi((err.stdout?.toString() || "") + (err.stderr?.toString() || ""));
        expect(out).toContain("[FAIL] Git Tag");
        expect(out).toContain("[ABORT] Release version mismatch detected");
      }
      expect(failed).toBe(true);
    });
  });
});
