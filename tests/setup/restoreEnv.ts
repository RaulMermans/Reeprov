/**
 * The suite runs with `isolate: false`, so test files share one process.
 * Snapshot process.env before each file and restore it afterwards so an
 * environment change in one file can never alter another file's results.
 */
import { afterAll, beforeAll } from "vitest";

let snapshot: Record<string, string | undefined> = {};

beforeAll(() => {
  snapshot = { ...process.env };
});

afterAll(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) delete process.env[key];
  }
  Object.assign(process.env, snapshot);
});
