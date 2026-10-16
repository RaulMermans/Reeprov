/**
 * Content-Addressed Deduplicated Blob Store.
 *
 * Persists large payloads, prompt templates, retrieved documents, and responses
 * addressed by their deterministic SHA-256 content hash.
 *
 * Invariant: Identical content appearing across N execution steps is stored once.
 */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getReeprovEnv } from "@/lib/config/env";
import { getReeprovHome } from "@/lib/storage/dataPath";
import { computeSha256 } from "./hashing";
import type { ContentBlob, ContentStore, ContentStorePutResult, ContentStoreStats } from "./types";

// ── In-Memory Content Store ─────────────────────────────────────────────────

export class InMemoryContentStore implements ContentStore {
  private readonly blobs = new Map<string, ContentBlob>();
  private dedupeSavingsBytes = 0;

  async put(content: string, mimeType = "application/json"): Promise<ContentStorePutResult> {
    const sizeBytes = Buffer.byteLength(content, "utf8");
    const hash = computeSha256(content);
    const contentRef = `blob:${hash}`;

    if (this.blobs.has(hash)) {
      this.dedupeSavingsBytes += sizeBytes;
      return { hash, sizeBytes, isNew: false, contentRef };
    }

    const blob: ContentBlob = {
      hash,
      content,
      sizeBytes,
      mimeType,
      createdAt: new Date().toISOString(),
    };
    this.blobs.set(hash, blob);

    return { hash, sizeBytes, isNew: true, contentRef };
  }

  async get(hashOrRef: string): Promise<string | null> {
    const hash = hashOrRef.startsWith("blob:") ? hashOrRef.slice(5) : hashOrRef;
    const blob = this.blobs.get(hash);
    return blob ? blob.content : null;
  }

  async has(hashOrRef: string): Promise<boolean> {
    const hash = hashOrRef.startsWith("blob:") ? hashOrRef.slice(5) : hashOrRef;
    return this.blobs.has(hash);
  }

  async getStats(): Promise<ContentStoreStats> {
    let totalBytes = 0;
    for (const b of this.blobs.values()) {
      totalBytes += b.sizeBytes;
    }
    return {
      blobCount: this.blobs.size,
      totalBytes,
      dedupeSavingsBytes: this.dedupeSavingsBytes,
    };
  }

  clear(): void {
    this.blobs.clear();
    this.dedupeSavingsBytes = 0;
  }
}

// ── File-Backed Content Store ───────────────────────────────────────────────

export class FileContentStore implements ContentStore {
  private readonly baseDir: string;
  private dedupeSavingsBytes = 0;
  private memoryCache = new Map<string, ContentBlob>();

  constructor(baseDir?: string) {
    const root =
      baseDir ??
      getReeprovEnv("REEPROV_STORE_DIR") ??
      getReeprovEnv("REEPROV_HOME") ??
      getReeprovHome();
    this.baseDir = join(root, "blobs");
  }

  private safePath(hash: string): string {
    const sanitized = hash.replace(/[^a-z0-9_-]/gi, "_");
    return join(this.baseDir, `${sanitized}.json`);
  }

  private async ensureDir(): Promise<void> {
    try {
      await access(this.baseDir);
    } catch {
      await mkdir(this.baseDir, { recursive: true });
    }
  }

  async put(content: string, mimeType = "application/json"): Promise<ContentStorePutResult> {
    const sizeBytes = Buffer.byteLength(content, "utf8");
    const hash = computeSha256(content);
    const contentRef = `blob:${hash}`;

    if (this.memoryCache.has(hash)) {
      this.dedupeSavingsBytes += sizeBytes;
      return { hash, sizeBytes, isNew: false, contentRef };
    }

    await this.ensureDir();
    const filePath = this.safePath(hash);

    try {
      await access(filePath);
      // Exists on disk
      this.dedupeSavingsBytes += sizeBytes;
      return { hash, sizeBytes, isNew: false, contentRef };
    } catch {
      // New blob
      const blob: ContentBlob = {
        hash,
        content,
        sizeBytes,
        mimeType,
        createdAt: new Date().toISOString(),
      };
      await writeFile(filePath, JSON.stringify(blob, null, 2), "utf8");
      this.memoryCache.set(hash, blob);
      return { hash, sizeBytes, isNew: true, contentRef };
    }
  }

  async get(hashOrRef: string): Promise<string | null> {
    const hash = hashOrRef.startsWith("blob:") ? hashOrRef.slice(5) : hashOrRef;
    if (this.memoryCache.has(hash)) {
      return this.memoryCache.get(hash)!.content;
    }

    try {
      const filePath = this.safePath(hash);
      const raw = await readFile(filePath, "utf8");
      const blob = JSON.parse(raw) as ContentBlob;
      this.memoryCache.set(hash, blob);
      return blob.content;
    } catch {
      return null;
    }
  }

  async has(hashOrRef: string): Promise<boolean> {
    const hash = hashOrRef.startsWith("blob:") ? hashOrRef.slice(5) : hashOrRef;
    if (this.memoryCache.has(hash)) return true;
    try {
      await access(this.safePath(hash));
      return true;
    } catch {
      return false;
    }
  }

  async getStats(): Promise<ContentStoreStats> {
    let totalBytes = 0;
    for (const b of this.memoryCache.values()) {
      totalBytes += b.sizeBytes;
    }
    return {
      blobCount: this.memoryCache.size,
      totalBytes,
      dedupeSavingsBytes: this.dedupeSavingsBytes,
    };
  }
}

// ── Default Singleton ───────────────────────────────────────────────────────

let _contentStore: ContentStore | null = null;

export function getContentStore(): ContentStore {
  if (!_contentStore) {
    if (process.env.NODE_ENV === "test" && !process.env.FORCE_FILE_STORE) {
      _contentStore = new InMemoryContentStore();
    } else {
      _contentStore = new FileContentStore();
    }
  }
  return _contentStore;
}

export function setContentStore(store: ContentStore): void {
  _contentStore = store;
}

export function _resetContentStore(): void {
  _contentStore = null;
}
