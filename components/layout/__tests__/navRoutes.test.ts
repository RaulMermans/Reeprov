/**
 * Navigation routes smoke test.
 *
 * Verifies that the expected navigation routes are present without requiring
 * a browser/jsdom environment. Reads the NavBar source directly rather than
 * rendering because this project does not have @testing-library/react set up.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(fileURLToPath(import.meta.url), "../../../../");
const navBarSrc = readFileSync(path.join(root, "components/layout/NavBar.tsx"), "utf8");
const scannerPageSrc = readFileSync(path.join(root, "app/dashboard/scanner/page.tsx"), "utf8");
const dashboardPageSrc = readFileSync(path.join(root, "app/dashboard/page.tsx"), "utf8");
const runsPageSrc = readFileSync(path.join(root, "app/dashboard/runs/page.tsx"), "utf8");

describe("NavBar routes", () => {
  it("includes an Overview link to /dashboard", () => {
    expect(navBarSrc).toContain('href: "/dashboard"');
    expect(navBarSrc).toContain("Overview");
  });

  it("includes a Runs link to /dashboard/runs", () => {
    expect(navBarSrc).toContain('href: "/dashboard/runs"');
    expect(navBarSrc).toContain('"Runs"');
  });

  it("includes a Workflows link to /dashboard/workflows", () => {
    expect(navBarSrc).toContain('href: "/dashboard/workflows"');
    expect(navBarSrc).toContain("Workflows");
  });

  it("includes a Repository Scanner link to /dashboard/scanner", () => {
    expect(navBarSrc).toContain('href: "/dashboard/scanner"');
    expect(navBarSrc).toContain("Repository Scanner");
  });

  it("includes a Scan History link to /dashboard/reports", () => {
    expect(navBarSrc).toContain('href: "/dashboard/reports"');
    expect(navBarSrc).toContain("Scan History");
  });

  it("uses sticky positioning", () => {
    expect(navBarSrc).toContain("sticky");
  });
});

describe("scanner page", () => {
  it("imports DashboardClient", () => {
    expect(scannerPageSrc).toContain("DashboardClient");
  });

  it("renders DashboardClient with initialReport", () => {
    expect(scannerPageSrc).toContain("initialReport");
  });
});

describe("proof dashboard page", () => {
  it("renders the AgentPulse heading", () => {
    expect(dashboardPageSrc).toContain("AgentPulse");
  });

  it("links to /dashboard/workflows", () => {
    expect(dashboardPageSrc).toContain("/dashboard/workflows");
  });

  it("links to /dashboard/runs for proof runs", () => {
    expect(dashboardPageSrc).toContain("/dashboard/runs");
  });

  it("mentions live runs section", () => {
    expect(dashboardPageSrc).toContain("Live Runs");
  });
});

describe("runs list page", () => {
  it("renders a Proof Runs heading", () => {
    expect(runsPageSrc).toContain("Proof Runs");
  });

  it("links back to /dashboard", () => {
    expect(runsPageSrc).toContain("/dashboard");
  });

  it("mentions the seed script", () => {
    expect(runsPageSrc).toContain("seed:traces");
  });

  it("references the ingestion endpoints", () => {
    expect(runsPageSrc).toContain("/api/runs/start");
    expect(runsPageSrc).toContain("/api/traces/events");
  });
});
