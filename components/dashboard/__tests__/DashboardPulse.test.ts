import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(fileURLToPath(import.meta.url), "../../../../");
const source = readFileSync(path.join(root, "components/dashboard/DashboardPulse.tsx"), "utf8");

describe("DashboardPulse command-center UI", () => {
  it("renders status cards, integration health, activity, and failure modes", () => {
    expect(source).toContain("Connected integrations");
    expect(source).toContain("Integration health");
    expect(source).toContain("Recent activity");
    expect(source).toContain("Top failure modes");
  });

  it("has a useful empty state and blueprint/run drill-down links", () => {
    expect(source).toContain("No connected integrations yet");
    expect(source).toContain('href="/dashboard/integrations"');
    expect(source).toContain("View blueprint");
    expect(source).toContain("Latest run");
  });
});
