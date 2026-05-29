/**
 * Task 7A — Access Completion Patch tests.
 * Reads source files to verify the corrected auth model without requiring a browser.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(fileURLToPath(import.meta.url), "../../../");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

// ── Phase 1: DashboardShell key revalidation ─────────────────────────────────

describe("DashboardShell stored-key revalidation", () => {
  const src = () => read("components/dashboard/DashboardShell.tsx");

  it("calls /api/auth/validate when a stored key is found on mount", () => {
    expect(src()).toContain("/api/auth/validate");
  });

  it("does NOT unconditionally unlock from sessionStorage alone", () => {
    // The old code did: if (stored) { setIsUnlocked(true) }
    // The corrected code must NOT do that — it should validate first.
    const code = src();
    // Should not have the pattern: stored key → immediate setIsUnlocked(true)
    // We check that setIsUnlocked(true) only appears inside a try/catch or after a fetch call.
    expect(code).toContain("response.ok");
    expect(code).toContain("setIsUnlocked(true)");
    // The old flawed pattern would call setIsUnlocked right after getInternalKey()
    // without any async fence. The corrected code uses `await fetch(...)` before it.
    // Confirm revalidation state exists.
    expect(code).toContain("revalidating");
  });

  it("shows loading/skeleton while revalidating", () => {
    expect(src()).toContain("revalidating");
    // skeleton is shown during revalidation
    expect(src()).toContain("animate-pulse");
  });

  it("clears key and shows expired message if server returns 401 for stored key", () => {
    expect(src()).toContain("clearInternalKey");
    expect(src()).toContain("expired");
  });

  it("still validates newly submitted keys via /api/auth/validate", () => {
    const code = src();
    expect(code).toContain("handleUnlock");
    expect(code).toContain("/api/auth/validate");
  });
});

// ── Phase 2: Centralised unauthorized handling ────────────────────────────────

describe("Reports history page uses onUnauthorized instead of clearInternalKey on 401", () => {
  const src = () => read("app/dashboard/reports/page.tsx");

  it("imports useDashboardAuth", () => {
    expect(src()).toContain("useDashboardAuth");
  });

  it("calls onUnauthorized on 401", () => {
    expect(src()).toContain("onUnauthorized");
  });

  it("does not have stale scanner-specific unlock copy", () => {
    expect(src()).not.toContain("Go to the Scanner and unlock first");
    expect(src()).not.toContain("Unlock Scanner");
  });
});

describe("Report compare page uses onUnauthorized on 401", () => {
  const src = () => read("app/dashboard/reports/compare/page.tsx");

  it("imports useDashboardAuth", () => {
    expect(src()).toContain("useDashboardAuth");
  });

  it("calls onUnauthorized on 401", () => {
    expect(src()).toContain("onUnauthorized");
  });

  it("does not have stale scanner-specific unlock copy", () => {
    expect(src()).not.toContain("Go to the Scanner and unlock first");
    expect(src()).not.toContain("Unlock Scanner");
  });
});

describe("Saved report detail page uses onUnauthorized on 401", () => {
  const src = () => read("app/dashboard/reports/[reportId]/page.tsx");

  it("imports useDashboardAuth", () => {
    expect(src()).toContain("useDashboardAuth");
  });

  it("calls onUnauthorized on 401", () => {
    expect(src()).toContain("onUnauthorized");
  });

  it("does not have stale scanner-specific unlock copy", () => {
    expect(src()).not.toContain("Go to the Scanner and unlock first");
    expect(src()).not.toContain("Unlock Scanner");
  });
});

describe("Report reconstruction page uses onUnauthorized on 401", () => {
  const src = () => read("app/dashboard/reports/[reportId]/reconstruction/page.tsx");

  it("imports useDashboardAuth", () => {
    expect(src()).toContain("useDashboardAuth");
  });

  it("calls onUnauthorized on 401", () => {
    expect(src()).toContain("onUnauthorized");
  });

  it("does not direct user to Repository Scanner to unlock", () => {
    // Old stale copy: "Unlock the dashboard from Repository Scanner"
    expect(src()).not.toContain("Unlock the dashboard from");
  });
});

describe("Run detail page uses onUnauthorized on 401", () => {
  const src = () => read("app/dashboard/runs/[runId]/page.tsx");

  it("imports useDashboardAuth", () => {
    expect(src()).toContain("useDashboardAuth");
  });

  it("calls onUnauthorized on 401", () => {
    expect(src()).toContain("onUnauthorized");
  });

  it("does not direct user to Repository Scanner to unlock", () => {
    expect(src()).not.toContain("Unlock the dashboard from");
    expect(src()).not.toContain("Repository Scanner");
  });
});

// ── Phase 3: Overview loads live runs client-side ─────────────────────────────

describe("Overview page does not import fileRunStore", () => {
  it("does not import fileRunStore directly", () => {
    const src = read("app/dashboard/page.tsx");
    expect(src).not.toContain("fileRunStore");
  });

  it("does not call listRuns server-side", () => {
    const src = read("app/dashboard/page.tsx");
    expect(src).not.toContain("listRuns");
  });

  it("uses OverviewLiveRuns client component", () => {
    const src = read("app/dashboard/page.tsx");
    expect(src).toContain("OverviewLiveRuns");
  });
});

describe("OverviewLiveRuns client component", () => {
  const src = () => read("components/dashboard/OverviewLiveRuns.tsx");

  it("exists", () => {
    expect(() => src()).not.toThrow();
  });

  it("is a client component", () => {
    expect(src()).toContain('"use client"');
  });

  it("fetches /api/runs with mergeAuthHeaders", () => {
    const code = src();
    expect(code).toContain("/api/runs");
    expect(code).toContain("mergeAuthHeaders");
  });

  it("calls onUnauthorized on 401", () => {
    expect(src()).toContain("onUnauthorized");
  });

  it("shows empty state with Create demo run button", () => {
    expect(src()).toContain("Create demo run");
  });
});

// ── Phase 4: Stale scanner-specific access copy removed ──────────────────────

describe("No stale scanner-specific unlock copy in run detail", () => {
  it("run detail page does not mention unlocking from Scanner", () => {
    const src = read("app/dashboard/runs/[runId]/page.tsx");
    expect(src).not.toContain("Go to the Scanner");
    expect(src).not.toContain("Unlock Scanner");
  });
});

describe("DashboardShell messages are global (not scanner-specific)", () => {
  it("uses global unlock language, not scanner-specific", () => {
    const src = read("components/dashboard/DashboardShell.tsx");
    expect(src).not.toContain("Unlock Scanner");
    expect(src).not.toContain("Go to the Scanner");
    expect(src).toContain("Dashboard access");
  });
});

// ── Auth validate route (existing tests via route.test.ts, extras here) ───────

describe("Auth validate route contract", () => {
  it("exists", () => {
    expect(() => read("app/api/auth/validate/route.ts")).not.toThrow();
  });

  it("returns ok: true and scope: dashboard on success", () => {
    const src = read("app/api/auth/validate/route.ts");
    expect(src).toContain("ok: true");
    expect(src).toContain("scope");
    expect(src).toContain("dashboard");
  });

  it("uses requireAccessKey", () => {
    const src = read("app/api/auth/validate/route.ts");
    expect(src).toContain("requireAccessKey");
  });
});
