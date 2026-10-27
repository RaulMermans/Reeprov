/**
 * Per-run write serialization for file-backed stores.
 *
 * Every read-modify-write of a run's files must run inside `withRunLock`.
 * Two layers are combined:
 * - an in-process promise chain per run, so concurrent requests handled by
 *   one Node process never interleave;
 * - an exclusive lock file (`open(..., "wx")`), so separate processes that
 *   share a store directory (multiple Next workers, CLI + Studio) also
 *   serialize.
 *
 * The lock is re-entrant within one async call chain (AsyncLocalStorage), so
 * a locked mutation may call helpers that take the same lock.
 *
 * PostgreSQL deployments additionally use a transaction-scoped advisory lock
 * in `mutateCanonicalRun`; this module only protects the filesystem.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const LOCK_TIMEOUT_MS = 15_000;
const STALE_LOCK_MS = 30_000;

export class RunLockTimeoutError extends Error {
  constructor(public readonly key: string) {
    super(`RUN_LOCK_TIMEOUT: could not acquire write lock for "${key}" within ${LOCK_TIMEOUT_MS} ms.`);
    this.name = "RunLockTimeoutError";
  }
}

const heldKeys = new AsyncLocalStorage<Set<string>>();
const chains = new Map<string, Promise<unknown>>();

function safeKey(key: string): string {
  return key.replace(/[^a-z0-9_.-]/gi, "_");
}

async function acquireFileLock(lockDir: string, key: string): Promise<() => Promise<void>> {
  await mkdir(lockDir, { recursive: true });
  const path = join(lockDir, `${safeKey(key)}.lock`);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let delay = 5;
  for (;;) {
    try {
      const handle = await open(path, "wx");
      await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
      await handle.close();
      return async () => {
        await rm(path, { force: true });
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        const info = await stat(path);
        if (Date.now() - info.mtimeMs > STALE_LOCK_MS) {
          await rm(path, { force: true });
          continue;
        }
      } catch {
        continue; // released between open and stat
      }
      if (Date.now() > deadline) throw new RunLockTimeoutError(key);
      await new Promise((r) => setTimeout(r, delay + Math.random() * delay));
      delay = Math.min(delay * 2, 50);
    }
  }
}

/**
 * Runs `fn` while holding the exclusive write lock for `key`.
 * `lockDir` must be shared by every process writing the same store.
 */
export async function withRunLock<T>(lockDir: string, key: string, fn: () => Promise<T>): Promise<T> {
  const held = heldKeys.getStore();
  if (held?.has(key)) return fn();

  const previous = chains.get(key) ?? Promise.resolve();
  let releaseChain!: () => void;
  const current = new Promise<void>((r) => (releaseChain = r));
  const tail = previous.then(() => current);
  chains.set(key, tail);

  await previous.catch(() => undefined);
  try {
    const releaseFile = await acquireFileLock(lockDir, key);
    try {
      const nextHeld = new Set(held ?? []);
      nextHeld.add(key);
      return await heldKeys.run(nextHeld, fn);
    } finally {
      await releaseFile();
    }
  } finally {
    releaseChain();
    if (chains.get(key) === tail) chains.delete(key);
  }
}

/** Writes a file atomically: readers see the old or new content, never a partial write. */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(tmp, content, "utf8");
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
