import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REQUIRED_DOCS = [
  "docs/product/personal-local-mode.md",
  "docs/product/self-hosted-mode.md",
  "docs/product/first-run.md",
  "docs/product/connect-agent.md",
  "docs/product/studio-navigation.md",
  "docs/product/privacy.md",
  "docs/architecture/deployment-modes.md",
  "docs/architecture/access-control.md",
  "docs/architecture/project-model.md",
  "docs/architecture/local-data-layout.md",
  "docs/architecture/studio-core-boundary.md",
  "docs/testing/personal-studio-proof.md",
];

describe("Sprint 10 Documentation Presence (Sprint Item 34)", () => {
  const rootDir = process.cwd();

  for (const docRelPath of REQUIRED_DOCS) {
    it(`verifies existence and content of ${docRelPath}`, () => {
      const fullPath = path.resolve(rootDir, docRelPath);
      expect(
        fs.existsSync(fullPath),
        `Required documentation file missing: ${docRelPath}`
      ).toBe(true);

      const content = fs.readFileSync(fullPath, "utf8");
      expect(content.trim().length, `Documentation file is empty: ${docRelPath}`).toBeGreaterThan(50);
      expect(content, `Documentation file must start with a markdown heading: ${docRelPath}`).toMatch(/^#\s+/m);
    });
  }

  it("verifies all 12 required documentation files exist as a batch", () => {
    const missingDocs = REQUIRED_DOCS.filter(
      (rel) => !fs.existsSync(path.resolve(rootDir, rel))
    );
    expect(missingDocs, `Missing documentation files: ${missingDocs.join(", ")}`).toEqual([]);
    expect(REQUIRED_DOCS.length).toBe(12);
  });
});
