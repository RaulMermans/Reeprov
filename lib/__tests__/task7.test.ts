/**
 * Task 7 — Global Dashboard Access smoke tests.
 * Reads source files directly to verify structure without requiring a browser.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(fileURLToPath(import.meta.url), "../../../");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("Dashboard auth validate route", () => {
  it("exists", () => {
    expect(() => read("app/api/auth/validate/route.ts")).not.toThrow();
  });

  it("uses requireAccessKey", () => {
    const src = read("app/api/auth/validate/route.ts");
    expect(src).toContain("requireAccessKey");
  });

  it("returns ok: true and scope: dashboard on success", () => {
    const src = read("app/api/auth/validate/route.ts");
    expect(src).toContain("scope");
    expect(src).toContain("dashboard");
  });
});

describe("DashboardShell component", () => {
  it("exists", () => {
    expect(() => read("components/dashboard/DashboardShell.tsx")).not.toThrow();
  });

  it("uses getInternalKey", () => {
    const src = read("components/dashboard/DashboardShell.tsx");
    expect(src).toContain("getInternalKey");
  });

  it("uses setInternalKey", () => {
    const src = read("components/dashboard/DashboardShell.tsx");
    expect(src).toContain("setInternalKey");
  });

  it("uses clearInternalKey", () => {
    const src = read("components/dashboard/DashboardShell.tsx");
    expect(src).toContain("clearInternalKey");
  });

  it("validates against api/auth/validate", () => {
    const src = read("components/dashboard/DashboardShell.tsx");
    expect(src).toContain("/api/auth/validate");
  });

  it("shows Unlock Dashboard button", () => {
    const src = read("components/dashboard/DashboardShell.tsx");
    expect(src).toContain("Unlock Dashboard");
  });
});

describe("Dashboard layout uses DashboardShell", () => {
  it("imports DashboardShell", () => {
    const src = read("app/dashboard/layout.tsx");
    expect(src).toContain("DashboardShell");
  });
});

describe("NavBar lock behavior", () => {
  it("accepts onLock prop", () => {
    const src = read("components/layout/NavBar.tsx");
    expect(src).toContain("onLock");
  });

  it("renders Lock dashboard button", () => {
    const src = read("components/layout/NavBar.tsx");
    expect(src).toContain("Lock dashboard");
  });
});

describe("DashboardClient no longer has isolated gate", () => {
  it("does not render its own access form", () => {
    const src = read("components/dashboard/DashboardClient.tsx");
    // Should not have the "Unlock Scanner" text (old isolated gate)
    expect(src).not.toContain("Unlock Scanner");
  });

  it("uses useDashboardAuth for 401 handling", () => {
    const src = read("components/dashboard/DashboardClient.tsx");
    expect(src).toContain("useDashboardAuth");
  });
});

describe("Overview page product modes", () => {
  it("mentions Live Proof Runs", () => {
    const src = read("app/dashboard/page.tsx");
    expect(src).toContain("Live Proof Runs");
  });

  it("mentions Static Repository Intelligence", () => {
    const src = read("app/dashboard/page.tsx");
    expect(src).toContain("Static Repository Intelligence");
  });

  it("mentions Workflow Registry", () => {
    const src = read("app/dashboard/page.tsx");
    expect(src).toContain("Workflow Registry");
  });

  it("mentions Saved Proof Reports", () => {
    const src = read("app/dashboard/page.tsx");
    expect(src).toContain("Saved Proof Reports");
  });

  it("has live runs empty state message in OverviewLiveRuns component", () => {
    // Empty state moved to OverviewLiveRuns client component (Task 7A Phase 3).
    const src = read("components/dashboard/OverviewLiveRuns.tsx");
    expect(src).toContain("No live proof runs yet");
  });
});
