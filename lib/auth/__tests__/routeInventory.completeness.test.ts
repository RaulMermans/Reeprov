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
  "/api/runs/examples/[runId]",
]);

describe("Route Inventory Completeness (Sprint Item 3)", () => {
  const apiRoot = path.resolve(process.cwd(), "app/api");
  const routeFiles = findRouteFiles(apiRoot);

  it("discovers all API route files", () => {
    expect(routeFiles.length).toBe(66);
  });

  it("ensures every route/method combination is declared in ROUTE_SECURITY_INVENTORY (code -> inventory)", () => {
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

  it("ensures every declaration in ROUTE_SECURITY_INVENTORY exists in code (inventory -> code)", () => {
    const codeHandlers = new Set<string>();

    for (const file of routeFiles) {
      const pattern = deriveRoutePattern(file, apiRoot);
      const content = fs.readFileSync(file, "utf8");
      const methods = extractExportedMethods(content);
      for (const method of methods) {
        codeHandlers.add(`${method} ${pattern}`);
      }
    }

    const staleDeclarations: string[] = [];

    for (const decl of ROUTE_SECURITY_INVENTORY) {
      for (const method of decl.methods) {
        const key = `${method} ${decl.pathPattern}`;
        if (!codeHandlers.has(key)) {
          staleDeclarations.push(key);
        }
      }
    }

    if (staleDeclarations.length > 0) {
      expect.fail(
        `Found ${staleDeclarations.length} stale declarations in ROUTE_SECURITY_INVENTORY with no matching code handler:\n` +
          staleDeclarations.map((d) => `  - ${d}`).join("\n")
      );
    }

    expect(staleDeclarations).toEqual([]);
    expect(codeHandlers.size).toBe(88);
  });

  it("verifies runtime capability matches inventory capability for every handler", () => {
    const inventoryMap = new Map<string, string>();
    for (const decl of ROUTE_SECURITY_INVENTORY) {
      for (const method of decl.methods) {
        inventoryMap.set(`${method} ${decl.pathPattern}`, decl.capability);
      }
    }

    const mismatches: Array<{ handler: string; code: string; inventory: string }> = [];

    for (const file of routeFiles) {
      const pattern = deriveRoutePattern(file, apiRoot);
      const content = fs.readFileSync(file, "utf8");
      const methods = extractExportedMethods(content);

      for (const method of methods) {
        const fnRegex = new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${method}\\b([\\s\\S]*?)(?=export\\s+(?:async\\s+)?(?:function|const)|$)`);
        const fnMatch = fnRegex.exec(content);
        const body = fnMatch ? fnMatch[1] : "";

        let runtimeCap = "UNKNOWN";
        const capMatch = /authorizeRequest\s*\(\s*[^,]+,\s*\{\s*capability:\s*["\x27]([^"\x27]+)["\x27]/.exec(body);
        if (capMatch) {
          runtimeCap = capMatch[1];
        } else if (body.includes("requireIngestAuth")) {
          runtimeCap = "INGEST";
        } else if (pattern === "/api/health" || (pattern.startsWith("/api/auth/") && pattern !== "/api/auth/validate")) {
          runtimeCap = "HEALTH_PUBLIC";
        } else if (pattern === "/api/auth/validate") {
          runtimeCap = "DASHBOARD_READ";
        }

        const key = `${method} ${pattern}`;
        const declaredCap = inventoryMap.get(key);

        if (runtimeCap !== declaredCap) {
          mismatches.push({ handler: key, code: runtimeCap, inventory: declaredCap ?? "NONE" });
        }
      }
    }

    if (mismatches.length > 0) {
      expect.fail(
        `Capability mismatch found between code and ROUTE_SECURITY_INVENTORY:\n` +
          mismatches.map((m) => `  - ${m.handler}: code enforced '${m.code}' vs inventory declared '${m.inventory}'`).join("\n")
      );
    }

    expect(mismatches).toEqual([]);
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
