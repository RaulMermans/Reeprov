import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { InMemoryContentStore, FileContentStore } from "../contentStore";

describe("Content-Addressed Blob Storage & Deduplication", () => {
  describe("InMemoryContentStore", () => {
    let store: InMemoryContentStore;

    beforeEach(() => {
      store = new InMemoryContentStore();
    });

    it("stores a new blob and computes its deterministic content hash", async () => {
      const content = JSON.stringify({ message: "Hello AgentPulse" });
      const result = await store.put(content);

      expect(result.isNew).toBe(true);
      expect(result.hash.startsWith("sha256:")).toBe(true);
      expect(result.contentRef).toBe(`blob:${result.hash}`);
      expect(result.sizeBytes).toBe(Buffer.byteLength(content, "utf8"));
    });

    it("deduplicates identical content across multiple steps", async () => {
      const largeContext = "Repeated system prompt context instructions".repeat(100);

      const res1 = await store.put(largeContext);
      const res2 = await store.put(largeContext);
      const res3 = await store.put(largeContext);

      expect(res1.isNew).toBe(true);
      expect(res2.isNew).toBe(false);
      expect(res3.isNew).toBe(false);
      expect(res1.hash).toBe(res2.hash);
      expect(res2.hash).toBe(res3.hash);

      const stats = await store.getStats();
      expect(stats.blobCount).toBe(1);
      expect(stats.dedupeSavingsBytes).toBe(res1.sizeBytes * 2);
    });

    it("retrieves content by hash or blob URI reference", async () => {
      const content = "Unique retrieved documentation chunk";
      const { hash, contentRef } = await store.put(content);

      expect(await store.get(hash)).toBe(content);
      expect(await store.get(contentRef)).toBe(content);
      expect(await store.get("sha256:nonexistent")).toBeNull();
    });

    it("correctly reports presence with has()", async () => {
      const { hash } = await store.put("sample content");
      expect(await store.has(hash)).toBe(true);
      expect(await store.has("sha256:0000000000000000000000000000000000000000000000000000000000000000")).toBe(false);
    });
  });

  describe("FileContentStore", () => {
    const testDir = join(process.cwd(), ".agentpulse-test-blobs");
    let store: FileContentStore;

    beforeEach(() => {
      store = new FileContentStore(testDir);
    });

    afterEach(async () => {
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it("persists blobs to disk and reloads them", async () => {
      const content = JSON.stringify({ persist: "on_disk" });
      const { hash, contentRef, isNew } = await store.put(content);

      expect(isNew).toBe(true);
      expect(await store.has(hash)).toBe(true);
      expect(await store.get(contentRef)).toBe(content);
    });
  });
});
