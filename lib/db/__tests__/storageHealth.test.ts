import { afterEach, describe, expect, it } from "vitest";
import { getAppVersion, getDeploymentEnvironment, getStorageHealth } from "@/lib/db/storageHealth";

const savedVercelEnv = process.env["VERCEL_ENV"];
const savedNodeEnv = process.env["NODE_ENV"];
const savedCommitSha = process.env["VERCEL_GIT_COMMIT_SHA"];
const savedDatabaseUrl = process.env["DATABASE_URL"];

afterEach(() => {
  if (savedVercelEnv === undefined) delete process.env["VERCEL_ENV"];
  else process.env["VERCEL_ENV"] = savedVercelEnv;
  if (savedNodeEnv === undefined) delete process.env["NODE_ENV"];
  else process.env["NODE_ENV"] = savedNodeEnv;
  if (savedCommitSha === undefined) delete process.env["VERCEL_GIT_COMMIT_SHA"];
  else process.env["VERCEL_GIT_COMMIT_SHA"] = savedCommitSha;
  if (savedDatabaseUrl === undefined) delete process.env["DATABASE_URL"];
  else process.env["DATABASE_URL"] = savedDatabaseUrl;
});

describe("getDeploymentEnvironment", () => {
  it("uses VERCEL_ENV when set to a known value", () => {
    process.env["VERCEL_ENV"] = "preview";
    expect(getDeploymentEnvironment()).toBe("preview");
  });

  it("falls back to NODE_ENV=production when VERCEL_ENV is unset", () => {
    delete process.env["VERCEL_ENV"];
    process.env["NODE_ENV"] = "production";
    expect(getDeploymentEnvironment()).toBe("production");
  });

  it("falls back to development when neither is production", () => {
    delete process.env["VERCEL_ENV"];
    process.env["NODE_ENV"] = "test";
    expect(getDeploymentEnvironment()).toBe("development");
  });
});

describe("getAppVersion", () => {
  it("uses a short VERCEL_GIT_COMMIT_SHA when present", () => {
    process.env["VERCEL_GIT_COMMIT_SHA"] = "abcdef1234567890";
    expect(getAppVersion()).toBe("abcdef1");
  });

  it("falls back to the package.json version when no commit SHA is set", () => {
    delete process.env["VERCEL_GIT_COMMIT_SHA"];
    expect(getAppVersion()).toMatch(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/);
  });
});

describe("getStorageHealth — file driver (no DATABASE_URL)", () => {
  it("reports driver=file with empty table lists and a run count", async () => {
    delete process.env["DATABASE_URL"];
    const health = await getStorageHealth();
    expect(health.driver).toBe("file");
    expect(health.databaseUrlPresent).toBe(false);
    expect(health.tablesPresent).toEqual([]);
    expect(health.missingTables.length).toBeGreaterThan(0);
    expect(typeof health.runCount).toBe("number");
    expect(["production", "preview", "development"]).toContain(health.environment);
    expect(typeof health.version).toBe("string");
  });
});
