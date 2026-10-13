import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_SECURITY_INVENTORY, type HttpMethod } from "../routeInventory";

/**
 * Discovers all route.ts files under a root directory.
 */
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

/**
 * Derives route pattern from route file path.
 * e.g., "app/api/runs/[runId]/route.ts" -> "/api/runs/[runId]"
 */
function deriveRoutePattern(filePath: string, appApiRoot: string): string {
  const relative = path.relative(appApiRoot, filePath);
  const normalized = relative.replace(/\\/g, "/");
  const withoutFile = normalized.replace(/\/route\.ts$/, "");
  return `/api/${withoutFile}`;
}

/**
 * Extracts exported HTTP methods (GET, POST, PUT, PATCH, DELETE) from route file content.
 */
function extractExportedMethods(fileContent: string): HttpMethod[] {
  const methodRegex = /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
  const methods: HttpMethod[] = [];
  let match: RegExpExecArray | null;

  while ((match = methodRegex.exec(fileContent)) !== null) {
    methods.push(match[1] as HttpMethod);
  }

  return methods;
}

const DOCUMENTED_PUBLIC_ROUTES = new Set([
  "/api/health",
  "/api/auth/session",
  "/api/auth/unlock",
  "/api/auth/lock",
  "/api/auth/validate",
]);

describe("Route Inventory Completeness (Sprint Item 3)", () => {
  const apiRoot = path.resolve(process.cwd(), "app/api");
  const routeFiles = findRouteFiles(apiRoot);

  it("discovers all API route files", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  it("ensures every route/method combination is declared in ROUTE_SECURITY_INVENTORY", () => {
    const missingDeclarations: Array<{ pattern: string; method: HttpMethod; file: string }> = [];

    for (const file of routeFiles) {
      const pattern = deriveRoutePattern(file, apiRoot);
      const content = fs.readFileSync(file, "utf8");
      const methods = extractExportedMethods(content);

      for (const method of methods) {
        const found = ROUTE_SECURITY_INVENTORY.some(
          (decl) => decl.pathPattern === pattern && decl.methods.includes(method)
        );

        if (!found) {
          missingDeclarations.push({ pattern, method, file });
        }
      }
    }

    if (missingDeclarations.length > 0) {
      const report = missingDeclarations
        .map((m) => `  - ${m.method} ${m.pattern} (${m.file})`)
        .join("\n");
      expect.fail(
        `Found ${missingDeclarations.length} undocumented route/method combinations in app/api:\n${report}\n` +
          `Every API route must have an entry in ROUTE_SECURITY_INVENTORY.`
      );
    }

    expect(missingDeclarations).toEqual([]);
  });

  it("allows explicit public exceptions only for documented public routes", () => {
    const publicDeclarations = ROUTE_SECURITY_INVENTORY.filter(
      (decl) => decl.capability === "HEALTH_PUBLIC"
    );

    const unexpectedPublicRoutes = publicDeclarations
      .map((d) => d.pathPattern)
      .filter((pattern) => !DOCUMENTED_PUBLIC_ROUTES.has(pattern));

    expect(
      unexpectedPublicRoutes,
      `Unexpected public routes with HEALTH_PUBLIC capability: ${unexpectedPublicRoutes.join(", ")}`
    ).toEqual([]);
  });

  it("verifies mutating capabilities (DASHBOARD_WRITE, ADMIN) are declared as isWrite=true", () => {
    for (const decl of ROUTE_SECURITY_INVENTORY) {
      if (
        decl.capability === "DASHBOARD_WRITE" ||
        (decl.capability === "ADMIN" &&
          decl.methods.some((m) => ["POST", "PUT", "PATCH", "DELETE"].includes(m)))
      ) {
        expect(
          decl.isWrite,
          `Route ${decl.pathPattern} with capability ${decl.capability} must have isWrite=true`
        ).toBe(true);
      }
    }
  });

  it("verifies all ingest routes require projectScope='required'", () => {
    const ingestRoutes = ROUTE_SECURITY_INVENTORY.filter((d) => d.capability === "INGEST");
    expect(ingestRoutes.length).toBeGreaterThan(0);

    for (const route of ingestRoutes) {
      expect(
        route.projectScope,
        `Ingest route ${route.pathPattern} must have projectScope='required'`
      ).toBe("required");
    }
  });
});
