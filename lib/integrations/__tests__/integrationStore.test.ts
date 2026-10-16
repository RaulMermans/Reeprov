/**
 * Task 11 — Integration Registry store tests.
 *
 * Uses a real temp directory per test run to verify actual I/O behavior.
 * Overrides AGENTPULSE_STORE_DIR so tests do not pollute .agentpulse/integrations.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileIntegrationStore } from "@/lib/integrations/integrationStore";
import type { CreateIntegrationInput } from "@/lib/integrations/integrationTypes";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "agentpulse-integrations-test-"));
  process.env["AGENTPULSE_STORE_DIR"] = tmpDir;
});

afterEach(async () => {
  delete process.env["AGENTPULSE_STORE_DIR"];
  await rm(tmpDir, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<CreateIntegrationInput> = {}): CreateIntegrationInput {
  return {
    projectId: "blog-agent",
    projectName: "Blog Agent",
    description: "Multi-agent blog content pipeline",
    defaultWorkflowId: "blog-agent-v1",
    language: "python",
    mode: "trace_sdk",
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("fileIntegrationStore", () => {

  describe("createIntegration", () => {
    it("creates an integration with an integrationId matching integ_ prefix", async () => {
      const integration = await fileIntegrationStore.createIntegration(makeInput());
      expect(integration.integrationId).toMatch(/^integ_/);
    });

    it("creates with correct fields from input", async () => {
      const integration = await fileIntegrationStore.createIntegration(makeInput());
      expect(integration.projectId).toBe("blog-agent");
      expect(integration.projectName).toBe("Blog Agent");
      expect(integration.description).toBe("Multi-agent blog content pipeline");
      expect(integration.defaultWorkflowId).toBe("blog-agent-v1");
      expect(integration.language).toBe("python");
      expect(integration.mode).toBe("trace_sdk");
    });

    it("starts with status waiting_for_first_event", async () => {
      const integration = await fileIntegrationStore.createIntegration(makeInput());
      expect(integration.status).toBe("waiting_for_first_event");
    });

    it("starts with runCount 0", async () => {
      const integration = await fileIntegrationStore.createIntegration(makeInput());
      expect(integration.runCount).toBe(0);
    });

    it("sets createdAt and updatedAt", async () => {
      const before = new Date().toISOString();
      const integration = await fileIntegrationStore.createIntegration(makeInput());
      expect(integration.createdAt >= before).toBe(true);
      expect(integration.updatedAt >= before).toBe(true);
    });

    it("defaults mode to trace_sdk when not specified", async () => {
      const integration = await fileIntegrationStore.createIntegration({
        projectId: "my-project",
        projectName: "My Project",
      });
      expect(integration.mode).toBe("trace_sdk");
    });
  });

  describe("listIntegrations", () => {
    it("returns all integrations newest first", async () => {
      await fileIntegrationStore.createIntegration(makeInput({ projectId: "proj-a", projectName: "A" }));
      await fileIntegrationStore.createIntegration(makeInput({ projectId: "proj-b", projectName: "B" }));
      const list = await fileIntegrationStore.listIntegrations();
      expect(list).toHaveLength(2);
      expect(list[0]!.projectId).toBe("proj-b");
      expect(list[1]!.projectId).toBe("proj-a");
    });

    it("filters by projectId", async () => {
      await fileIntegrationStore.createIntegration(makeInput({ projectId: "proj-x" }));
      await fileIntegrationStore.createIntegration(makeInput({ projectId: "proj-y" }));
      const found = await fileIntegrationStore.listIntegrations({ projectId: "proj-x" });
      expect(found).toHaveLength(1);
      expect(found[0]!.projectId).toBe("proj-x");
    });

    it("filters by language", async () => {
      await fileIntegrationStore.createIntegration(makeInput({ projectId: "ts-project", language: "typescript" }));
      await fileIntegrationStore.createIntegration(makeInput({ projectId: "py-project", language: "python" }));
      const ts = await fileIntegrationStore.listIntegrations({ language: "typescript" });
      expect(ts).toHaveLength(1);
      expect(ts[0]!.language).toBe("typescript");
    });

    it("respects limit", async () => {
      for (let i = 0; i < 5; i++) {
        await fileIntegrationStore.createIntegration(makeInput({ projectId: `proj-${i}` }));
      }
      const limited = await fileIntegrationStore.listIntegrations({ limit: 3 });
      expect(limited).toHaveLength(3);
    });

    it("returns empty array when store is empty", async () => {
      const list = await fileIntegrationStore.listIntegrations();
      expect(list).toEqual([]);
    });
  });

  describe("getIntegration", () => {
    it("returns the full integration by integrationId", async () => {
      const created = await fileIntegrationStore.createIntegration(makeInput());
      const fetched = await fileIntegrationStore.getIntegration(created.integrationId);
      expect(fetched).not.toBeNull();
      expect(fetched!.integrationId).toBe(created.integrationId);
      expect(fetched!.projectId).toBe("blog-agent");
    });

    it("returns null for unknown integrationId", async () => {
      const result = await fileIntegrationStore.getIntegration("integ_does_not_exist");
      expect(result).toBeNull();
    });
  });

  describe("getIntegrationByProjectId", () => {
    it("returns the integration matching projectId", async () => {
      await fileIntegrationStore.createIntegration(makeInput({ projectId: "find-me" }));
      const found = await fileIntegrationStore.getIntegrationByProjectId("find-me");
      expect(found).not.toBeNull();
      expect(found!.projectId).toBe("find-me");
    });

    it("returns null when projectId not registered", async () => {
      const found = await fileIntegrationStore.getIntegrationByProjectId("does-not-exist");
      expect(found).toBeNull();
    });
  });

  describe("updateIntegration", () => {
    it("updates specified fields and bumps updatedAt", async () => {
      const created = await fileIntegrationStore.createIntegration(makeInput());
      const before = created.updatedAt;

      await new Promise((r) => setTimeout(r, 5));
      const updated = await fileIntegrationStore.updateIntegration(created.integrationId, {
        projectName: "Blog Agent V2",
        description: "Updated description",
      });

      expect(updated).not.toBeNull();
      expect(updated!.projectName).toBe("Blog Agent V2");
      expect(updated!.description).toBe("Updated description");
      expect(updated!.updatedAt > before).toBe(true);
    });

    it("does not overwrite fields not in patch", async () => {
      const created = await fileIntegrationStore.createIntegration(makeInput());
      await fileIntegrationStore.updateIntegration(created.integrationId, { projectName: "New Name" });
      const fetched = await fileIntegrationStore.getIntegration(created.integrationId);
      expect(fetched!.projectId).toBe("blog-agent");
      expect(fetched!.language).toBe("python");
    });

    it("returns null for unknown integrationId", async () => {
      const result = await fileIntegrationStore.updateIntegration("integ_ghost", { projectName: "X" });
      expect(result).toBeNull();
    });

    it("updates status field", async () => {
      const created = await fileIntegrationStore.createIntegration(makeInput());
      const updated = await fileIntegrationStore.updateIntegration(created.integrationId, { status: "error" });
      expect(updated!.status).toBe("error");
    });
  });

  describe("deleteIntegration", () => {
    it("removes from store and index", async () => {
      const created = await fileIntegrationStore.createIntegration(makeInput());
      const deleted = await fileIntegrationStore.deleteIntegration(created.integrationId);
      expect(deleted).toBe(true);

      const list = await fileIntegrationStore.listIntegrations();
      expect(list).toHaveLength(0);

      const fetched = await fileIntegrationStore.getIntegration(created.integrationId);
      expect(fetched).toBeNull();
    });

    it("returns false for unknown integrationId", async () => {
      const result = await fileIntegrationStore.deleteIntegration("integ_ghost");
      expect(result).toBe(false);
    });
  });

  describe("recordEventSeen", () => {
    it("creates a new integration when projectId does not exist", async () => {
      const result = await fileIntegrationStore.recordEventSeen("new-project", {
        runId: "run_abc",
        runStatus: "running",
      });
      expect(result).not.toBeNull();
      expect(result!.projectId).toBe("new-project");
      expect(result!.status).toBe("receiving_events");
      expect(result!.lastRunId).toBe("run_abc");
      expect(result!.runCount).toBe(1);
    });

    it("updates existing integration to receiving_events", async () => {
      const created = await fileIntegrationStore.createIntegration(makeInput());
      expect(created.status).toBe("waiting_for_first_event");

      const updated = await fileIntegrationStore.recordEventSeen("blog-agent", { runId: "run_xyz" });
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("receiving_events");
      expect(updated!.lastEventAt).toBeDefined();
      expect(updated!.lastRunId).toBe("run_xyz");
    });

    it("increments runCount for new runId", async () => {
      const created = await fileIntegrationStore.createIntegration(makeInput());
      expect(created.runCount).toBe(0);

      await fileIntegrationStore.recordEventSeen("blog-agent", { runId: "run_1" });
      const after1 = await fileIntegrationStore.getIntegrationByProjectId("blog-agent");
      expect(after1!.runCount).toBe(1);

      // Same runId — should NOT increment again
      await fileIntegrationStore.recordEventSeen("blog-agent", { runId: "run_1" });
      const after2 = await fileIntegrationStore.getIntegrationByProjectId("blog-agent");
      expect(after2!.runCount).toBe(1);

      // New runId — should increment
      await fileIntegrationStore.recordEventSeen("blog-agent", { runId: "run_2" });
      const after3 = await fileIntegrationStore.getIntegrationByProjectId("blog-agent");
      expect(after3!.runCount).toBe(2);
    });

    it("updates lastRunStatus", async () => {
      await fileIntegrationStore.createIntegration(makeInput());
      await fileIntegrationStore.recordEventSeen("blog-agent", { runId: "run_1", runStatus: "completed" });
      const fetched = await fileIntegrationStore.getIntegrationByProjectId("blog-agent");
      expect(fetched!.lastRunStatus).toBe("completed");
    });

    it("updates the index entry", async () => {
      await fileIntegrationStore.createIntegration(makeInput());
      await fileIntegrationStore.recordEventSeen("blog-agent", { runId: "run_x" });
      const list = await fileIntegrationStore.listIntegrations({ status: "receiving_events" });
      expect(list).toHaveLength(1);
    });
  });

  describe("scoped ingest keys", () => {
    it("generates a raw key once and persists only its hash + preview", async () => {
      const created = await fileIntegrationStore.createIntegration(makeInput());
      const result = await fileIntegrationStore.generateIngestKey(created.integrationId);

      expect(result).not.toBeNull();
      expect(result!.rawKey).toMatch(/^ree_live_/);
      expect(result!.integration.ingestKeyHash).toBeTruthy();
      expect(result!.integration.ingestKeyPreview).toContain("ree_live_...");
      // The raw key itself must never appear in the persisted record.
      expect(JSON.stringify(result!.integration)).not.toContain(result!.rawKey);
    });

    it("finds the owning integration by the raw key's hash", async () => {
      const created = await fileIntegrationStore.createIntegration(makeInput());
      const { rawKey } = (await fileIntegrationStore.generateIngestKey(created.integrationId))!;

      const { hashIngestKey } = await import("@/lib/integrations/ingestKey");
      const found = await fileIntegrationStore.findByIngestKeyHash(hashIngestKey(rawKey));
      expect(found?.integrationId).toBe(created.integrationId);
    });

    it("returns null for an unrecognized key hash", async () => {
      const { hashIngestKey } = await import("@/lib/integrations/ingestKey");
      const found = await fileIntegrationStore.findByIngestKeyHash(hashIngestKey("not-a-real-key"));
      expect(found).toBeNull();
    });

    it("rotating a key invalidates the previous one", async () => {
      const created = await fileIntegrationStore.createIntegration(makeInput());
      const first = (await fileIntegrationStore.generateIngestKey(created.integrationId))!;
      const second = (await fileIntegrationStore.generateIngestKey(created.integrationId))!;

      expect(first.rawKey).not.toBe(second.rawKey);

      const { hashIngestKey } = await import("@/lib/integrations/ingestKey");
      const foundByOld = await fileIntegrationStore.findByIngestKeyHash(hashIngestKey(first.rawKey));
      const foundByNew = await fileIntegrationStore.findByIngestKeyHash(hashIngestKey(second.rawKey));

      expect(foundByOld).toBeNull();
      expect(foundByNew?.integrationId).toBe(created.integrationId);
    });

    it("revoking a key clears the hash and preview", async () => {
      const created = await fileIntegrationStore.createIntegration(makeInput());
      const { rawKey } = (await fileIntegrationStore.generateIngestKey(created.integrationId))!;

      const revoked = await fileIntegrationStore.revokeIngestKey(created.integrationId);
      expect(revoked?.ingestKeyHash).toBeUndefined();
      expect(revoked?.ingestKeyPreview).toBeUndefined();

      const { hashIngestKey } = await import("@/lib/integrations/ingestKey");
      const found = await fileIntegrationStore.findByIngestKeyHash(hashIngestKey(rawKey));
      expect(found).toBeNull();
    });

    it("returns null when generating a key for a nonexistent integration", async () => {
      const result = await fileIntegrationStore.generateIngestKey("integ_does_not_exist");
      expect(result).toBeNull();
    });
  });
});
