/**
 * Store selector tests (lib/db/getStores.ts)
 *
 * These tests verify the selection logic that chooses between Postgres and
 * file-backed stores depending on DATABASE_URL and NODE_ENV.
 *
 * No real database connection is made. All store getters check environment
 * variables at call time (not at module load time), so we can flip env vars
 * in beforeEach/afterEach without needing vi.resetModules().
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { hasDatabaseUrl } from "@/lib/db/client";
import { getIntegrationStore, getRunStore, getReportStore, getWorkflowStore } from "@/lib/db/getStores";
import { fileIntegrationStore } from "@/lib/integrations/integrationStore";
import { pgIntegrationStore } from "@/lib/integrations/pgIntegrationStore";
import { fileRunStore } from "@/lib/runs/runStore";
import { pgRunStore } from "@/lib/runs/pgRunStore";
import { fileReportStore } from "@/lib/reports/reportStore";
import { pgReportStore } from "@/lib/reports/pgReportStore";
import { fileWorkflowStore } from "@/lib/workflows/workflowStore";
import { pgWorkflowStore } from "@/lib/workflows/pgWorkflowStore";

// ── hasDatabaseUrl ─────────────────────────────────────────────────────────────

describe("hasDatabaseUrl", () => {
  const saved = process.env["DATABASE_URL"];

  afterEach(() => {
    if (saved === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = saved;
  });

  it("returns true when DATABASE_URL is a non-empty string", () => {
    process.env["DATABASE_URL"] = "postgresql://localhost/test";
    expect(hasDatabaseUrl()).toBe(true);
  });

  it("returns false when DATABASE_URL is not set", () => {
    delete process.env["DATABASE_URL"];
    expect(hasDatabaseUrl()).toBe(false);
  });

  it("returns false for empty string DATABASE_URL", () => {
    process.env["DATABASE_URL"] = "";
    expect(hasDatabaseUrl()).toBe(false);
  });
});

// ── Store selection without DATABASE_URL (dev / test environment) ──────────────

describe("getStores — without DATABASE_URL", () => {
  const savedUrl = process.env["DATABASE_URL"];
  const savedEnv = process.env["NODE_ENV"];

  beforeEach(() => {
    delete process.env["DATABASE_URL"];
    // Tests run under NODE_ENV=test — not production — so file stores are used.
    process.env["NODE_ENV"] = "test";
  });

  afterEach(() => {
    if (savedUrl === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = savedUrl;
    if (savedEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = savedEnv;
  });

  it("getIntegrationStore() returns fileIntegrationStore", () => {
    expect(getIntegrationStore()).toBe(fileIntegrationStore);
  });

  it("getRunStore() returns fileRunStore", () => {
    expect(getRunStore()).toBe(fileRunStore);
  });

  it("getReportStore() returns fileReportStore", () => {
    expect(getReportStore()).toBe(fileReportStore);
  });

  it("getWorkflowStore() returns fileWorkflowStore", () => {
    expect(getWorkflowStore()).toBe(fileWorkflowStore);
  });
});

// ── Store selection with DATABASE_URL ─────────────────────────────────────────

describe("getStores — with DATABASE_URL set", () => {
  const savedUrl = process.env["DATABASE_URL"];

  beforeEach(() => {
    process.env["DATABASE_URL"] = "postgresql://localhost/agentpulse_test";
  });

  afterEach(() => {
    if (savedUrl === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = savedUrl;
  });

  it("getIntegrationStore() returns pgIntegrationStore", () => {
    expect(getIntegrationStore()).toBe(pgIntegrationStore);
  });

  it("getRunStore() returns pgRunStore", () => {
    expect(getRunStore()).toBe(pgRunStore);
  });

  it("getReportStore() returns pgReportStore", () => {
    expect(getReportStore()).toBe(pgReportStore);
  });

  it("getWorkflowStore() returns pgWorkflowStore", () => {
    expect(getWorkflowStore()).toBe(pgWorkflowStore);
  });
});

// ── Production without DATABASE_URL must throw ────────────────────────────────

describe("getStores — production without DATABASE_URL", () => {
  const savedUrl = process.env["DATABASE_URL"];
  const savedEnv = process.env["NODE_ENV"];

  beforeEach(() => {
    delete process.env["DATABASE_URL"];
    process.env["NODE_ENV"] = "production";
  });

  afterEach(() => {
    if (savedUrl === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = savedUrl;
    if (savedEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = savedEnv;
  });

  it("getIntegrationStore() throws a clear error in production without DATABASE_URL", () => {
    expect(() => getIntegrationStore()).toThrow("DATABASE_URL is required in production");
  });

  it("getRunStore() throws a clear error in production without DATABASE_URL", () => {
    expect(() => getRunStore()).toThrow("DATABASE_URL is required in production");
  });

  it("getReportStore() throws a clear error in production without DATABASE_URL", () => {
    expect(() => getReportStore()).toThrow("DATABASE_URL is required in production");
  });

  it("getWorkflowStore() throws a clear error in production without DATABASE_URL", () => {
    expect(() => getWorkflowStore()).toThrow("DATABASE_URL is required in production");
  });

  it("error message mentions AGENTPULSE_STORE_DIR is local-only", () => {
    expect(() => getIntegrationStore()).toThrow(/file-backed storage are only supported in development/);
  });
});

// ── touchIntegrationForProject (non-fatal, file-backed) ───────────────────────

describe("touchIntegrationForProject via getStores", () => {
  let tmpDir: string;
  const savedUrl = process.env["DATABASE_URL"];

  beforeEach(async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    tmpDir = await mkdtemp(join(tmpdir(), "agentpulse-touch-test-"));
    process.env["AGENTPULSE_STORE_DIR"] = tmpDir;
    delete process.env["DATABASE_URL"];
  });

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    delete process.env["AGENTPULSE_STORE_DIR"];
    if (savedUrl === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = savedUrl;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("auto-creates an integration and never throws", async () => {
    const { touchIntegrationForProject } = await import("@/lib/db/getStores");
    await expect(
      touchIntegrationForProject("auto-touch-project", { runId: "run_001" }),
    ).resolves.toBeUndefined();
  });

  it("is non-fatal even for repeated calls with the same runId", async () => {
    const { touchIntegrationForProject } = await import("@/lib/db/getStores");
    await touchIntegrationForProject("idempotent-project", { runId: "run_a" });
    await touchIntegrationForProject("idempotent-project", { runId: "run_a" });
    await expect(
      touchIntegrationForProject("idempotent-project", { runId: "run_b" }),
    ).resolves.toBeUndefined();
  });

  it("increments runCount for new runIds", async () => {
    const { touchIntegrationForProject } = await import("@/lib/db/getStores");
    await touchIntegrationForProject("count-test-project", { runId: "run_1" });
    await touchIntegrationForProject("count-test-project", { runId: "run_2" });
    const integration = await fileIntegrationStore.getIntegrationByProjectId("count-test-project");
    expect(integration).not.toBeNull();
    expect(integration!.runCount).toBe(2);
    expect(integration!.status).toBe("receiving_events");
  });
});

// ── Store interface compatibility ─────────────────────────────────────────────

describe("Pg stores implement the same interface as file stores", () => {
  it("pgIntegrationStore has all required IntegrationStore methods", () => {
    expect(typeof pgIntegrationStore.createIntegration).toBe("function");
    expect(typeof pgIntegrationStore.listIntegrations).toBe("function");
    expect(typeof pgIntegrationStore.getIntegration).toBe("function");
    expect(typeof pgIntegrationStore.getIntegrationByProjectId).toBe("function");
    expect(typeof pgIntegrationStore.updateIntegration).toBe("function");
    expect(typeof pgIntegrationStore.deleteIntegration).toBe("function");
    expect(typeof pgIntegrationStore.recordEventSeen).toBe("function");
  });

  it("pgRunStore has all required RunStore methods", () => {
    expect(typeof pgRunStore.createRun).toBe("function");
    expect(typeof pgRunStore.appendTraceEvent).toBe("function");
    expect(typeof pgRunStore.appendToolCallRecord).toBe("function");
    expect(typeof pgRunStore.appendEvalResult).toBe("function");
    expect(typeof pgRunStore.completeRun).toBe("function");
    expect(typeof pgRunStore.failRun).toBe("function");
    expect(typeof pgRunStore.getRun).toBe("function");
    expect(typeof pgRunStore.listRuns).toBe("function");
    expect(typeof pgRunStore.deleteRun).toBe("function");
  });

  it("pgReportStore has all required ReportStore methods", () => {
    expect(typeof pgReportStore.saveReport).toBe("function");
    expect(typeof pgReportStore.listReports).toBe("function");
    expect(typeof pgReportStore.getReport).toBe("function");
    expect(typeof pgReportStore.deleteReport).toBe("function");
  });

  it("pgWorkflowStore has all required WorkflowStore methods", () => {
    expect(typeof pgWorkflowStore.saveWorkflow).toBe("function");
    expect(typeof pgWorkflowStore.listWorkflows).toBe("function");
    expect(typeof pgWorkflowStore.getWorkflow).toBe("function");
    expect(typeof pgWorkflowStore.getWorkflowByWorkflowId).toBe("function");
    expect(typeof pgWorkflowStore.updateWorkflowStatus).toBe("function");
    expect(typeof pgWorkflowStore.deleteWorkflow).toBe("function");
  });
});
