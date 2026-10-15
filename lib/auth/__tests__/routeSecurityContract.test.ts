import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_SECURITY_INVENTORY, type HttpMethod, type AuthCapability, type ProjectScopePolicy } from "../routeInventory";

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

describe("Authoritative Route Security Contract Test (Sprint 10.2 Section 3)", () => {
  const apiRoot = path.resolve(process.cwd(), "app/api");
  const routeFiles = findRouteFiles(apiRoot);

  it("dynamically generates and validates exact route file count (66)", () => {
    expect(routeFiles.length).toBe(66);
  });

  it("dynamically generates and validates exact HTTP method handler count (88)", () => {
    let totalHandlers = 0;
    for (const file of routeFiles) {
      const content = fs.readFileSync(file, "utf8");
      totalHandlers += extractExportedMethods(content).length;
    }
    expect(totalHandlers).toBe(88);
  });

  it("validates that every inventory declaration corresponds to a real code handler (no stale declarations)", () => {
    const codeHandlers = new Set<string>();
    for (const file of routeFiles) {
      const pattern = deriveRoutePattern(file, apiRoot);
      const content = fs.readFileSync(file, "utf8");
      for (const method of extractExportedMethods(content)) {
        codeHandlers.add(`${method} ${pattern}`);
      }
    }

    const staleEntries: string[] = [];
    for (const decl of ROUTE_SECURITY_INVENTORY) {
      for (const method of decl.methods) {
        const key = `${method} ${decl.pathPattern}`;
        if (!codeHandlers.has(key)) {
          staleEntries.push(key);
        }
      }
    }

    expect(
      staleEntries,
      `Inventory contains stale declarations not found in code:\n${staleEntries.join("\n")}`
    ).toEqual([]);
  });

  it("validates that every code handler exists in the inventory (no undocumented handlers)", () => {
    const inventoryPairs = new Set<string>();
    for (const decl of ROUTE_SECURITY_INVENTORY) {
      for (const method of decl.methods) {
        inventoryPairs.add(`${method} ${decl.pathPattern}`);
      }
    }

    const undocumented: string[] = [];
    for (const file of routeFiles) {
      const pattern = deriveRoutePattern(file, apiRoot);
      const content = fs.readFileSync(file, "utf8");
      for (const method of extractExportedMethods(content)) {
        const key = `${method} ${pattern}`;
        if (!inventoryPairs.has(key)) {
          undocumented.push(key);
        }
      }
    }

    expect(
      undocumented,
      `Code contains handlers missing from ROUTE_SECURITY_INVENTORY:\n${undocumented.join("\n")}`
    ).toEqual([]);
  });

  it("validates runtime capability matches inventory capability deterministically", () => {
    const inventoryMap = new Map<string, AuthCapability>();
    for (const decl of ROUTE_SECURITY_INVENTORY) {
      for (const method of decl.methods) {
        inventoryMap.set(`${method} ${decl.pathPattern}`, decl.capability);
      }
    }

    const mismatches: Array<{ key: string; runtime: string; inventory: string }> = [];

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
        const declared = inventoryMap.get(key);

        if (runtimeCap !== declared) {
          mismatches.push({ key, runtime: runtimeCap, inventory: declared ?? "MISSING" });
        }
      }
    }

    expect(
      mismatches,
      `Runtime capability does not match inventory declaration:\n` +
        mismatches.map((m) => `  - ${m.key}: runtime '${m.runtime}' vs inventory '${m.inventory}'`).join("\n")
    ).toEqual([]);
  });

  it("validates write/read classification coherence across all handlers", () => {
    for (const decl of ROUTE_SECURITY_INVENTORY) {
      // 1. GET requests must NEVER be declared as isWrite=true
      if (decl.methods.includes("GET")) {
        expect(
          decl.isWrite,
          `GET route ${decl.pathPattern} must be isWrite=false`
        ).toBe(false);
      }

      // 2. DASHBOARD_WRITE and mutating ADMIN must be isWrite=true
      if (decl.capability === "DASHBOARD_WRITE" || (decl.capability === "ADMIN" && decl.methods.some((m) => m !== "GET"))) {
        expect(
          decl.isWrite,
          `Mutating route ${decl.pathPattern} (${decl.methods.join(",")}) must be isWrite=true`
        ).toBe(true);
      }

      // 3. INGEST routes are mutating trace ingestion pipelines
      if (decl.capability === "INGEST") {
        expect(
          decl.isWrite,
          `Ingest route ${decl.pathPattern} must be isWrite=true`
        ).toBe(true);
        expect(
          decl.projectScope,
          `Ingest route ${decl.pathPattern} must require projectScope='required'`
        ).toBe("required");
      }
    }
  });

  it("validates that public routes are strictly bounded to documented public exceptions", () => {
    const publicDeclarations = ROUTE_SECURITY_INVENTORY.filter(
      (decl) => decl.capability === "HEALTH_PUBLIC"
    );

    const unexpectedPublic = publicDeclarations
      .map((d) => d.pathPattern)
      .filter((pattern) => !DOCUMENTED_PUBLIC_ROUTES.has(pattern));

    expect(
      unexpectedPublic,
      `Unexpected public route detected: ${unexpectedPublic.join(", ")}`
    ).toEqual([]);

    // And verify that no documented public route is accidentally protected
    for (const pub of DOCUMENTED_PUBLIC_ROUTES) {
      const found = ROUTE_SECURITY_INVENTORY.find((d) => d.pathPattern === pub);
      expect(found).toBeDefined();
      expect(
        found?.capability,
        `Documented public route ${pub} must have HEALTH_PUBLIC capability`
      ).toBe("HEALTH_PUBLIC");
    }
  });
});
