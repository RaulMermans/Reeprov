import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function findRouteFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findRouteFiles(fullPath));
    } else if (entry.isFile() && entry.name === "route.ts") {
      results.push(fullPath);
    }
  }

  return results;
}

function deriveRoutePattern(filePath: string, appApiRoot: string): string {
  const relative = path.relative(appApiRoot, filePath);
  const normalized = relative.replace(/\\/g, "/");
  const withoutFile = normalized.replace(/\/route\.ts$/, "");
  return `/api/${withoutFile}`;
}

const PUBLIC_ROUTES = new Set([
  "/api/health",
  "/api/auth/session",
  "/api/auth/unlock",
  "/api/auth/lock",
  "/api/auth/validate",
]);

const INGEST_ROUTES = new Set([
  "/api/runs/start",
  "/api/traces/events",
  "/api/traces/boundaries",
  "/api/runs/complete",
  "/api/runs/fail",
]);

describe("Route Auth Migration Verification", () => {
  const apiRoot = path.resolve(process.cwd(), "app/api");
  const routeFiles = findRouteFiles(apiRoot);

  it("scans all app/api/**/route.ts files", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  it("reports any routes still using legacy auth", () => {
    const legacyRoutes: Array<{ pattern: string; file: string }> = [];

    for (const file of routeFiles) {
      const content = fs.readFileSync(file, "utf8");
      const pattern = deriveRoutePattern(file, apiRoot);

      if (content.includes("lib/auth/requireAccessKey")) {
        legacyRoutes.push({ pattern, file });
      }
    }

    if (legacyRoutes.length > 0) {
      console.warn(
        `[MIGRATION IN PROGRESS] ${legacyRoutes.length} route files still import requireAccessKey:\n` +
          legacyRoutes.map((r) => `  - ${r.pattern} (${r.file})`).join("\n")
      );
    }

    // Reports legacy routes count and details
    expect(legacyRoutes).toBeDefined();
  });

  it("verifies NO route file imports from lib/auth/requireAccessKey directly (should be eliminated or use wrapper)", () => {
    const legacyImports: string[] = [];

    for (const file of routeFiles) {
      const content = fs.readFileSync(file, "utf8");
      const pattern = deriveRoutePattern(file, apiRoot);

      // Check for direct import from requireAccessKey
      if (
        content.includes('from "@/lib/auth/requireAccessKey"') ||
        content.includes("from '@/lib/auth/requireAccessKey'") ||
        content.includes('from "../requireAccessKey"') ||
        content.includes('from "./requireAccessKey"')
      ) {
        legacyImports.push(pattern);
      }
    }

    // Once auth migration lands, no route file should import requireAccessKey directly.
    // If migration is currently in progress, report the outstanding routes.
    expect(
      legacyImports,
      `Routes still importing requireAccessKey directly:\n${legacyImports.join("\n")}\n` +
        `All routes must be migrated to lib/auth/accessControl (authorizeRequest).`
    ).toEqual([]);
  });

  it("verifies all non-public, non-ingest routes import from lib/auth/accessControl", () => {
    const nonCompliantRoutes: string[] = [];

    for (const file of routeFiles) {
      const pattern = deriveRoutePattern(file, apiRoot);

      // Skip public routes and dedicated ingest routes
      if (PUBLIC_ROUTES.has(pattern) || INGEST_ROUTES.has(pattern)) {
        continue;
      }

      const content = fs.readFileSync(file, "utf8");
      const importsAccessControl =
        content.includes('from "@/lib/auth/accessControl"') ||
        content.includes("from '@/lib/auth/accessControl'");

      if (!importsAccessControl) {
        nonCompliantRoutes.push(pattern);
      }
    }

    expect(
      nonCompliantRoutes,
      `Non-public, non-ingest routes missing lib/auth/accessControl import:\n${nonCompliantRoutes.join("\n")}`
    ).toEqual([]);
  });
});
