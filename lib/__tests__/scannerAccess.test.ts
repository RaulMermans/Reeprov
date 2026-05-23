/**
 * Scanner access trust boundary tests.
 *
 * These tests verify the client-side key helpers without a browser environment.
 * Browser-dependent tests (form submit → API validation → unlock) require an
 * integration test harness and are covered by the /api/repos route tests instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearInternalKey,
  getInternalKey,
  isInternalUnlocked,
  mergeAuthHeaders,
  setInternalKey,
} from "../auth/internalKey";

const store: Record<string, string> = {};
const mockSessionStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

describe("scanner access — browser environment", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("sessionStorage", mockSessionStorage);
    mockSessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scanner is locked when no key is stored", () => {
    expect(isInternalUnlocked()).toBe(false);
    expect(getInternalKey()).toBeNull();
  });

  it("storing a key unlocks the scanner", () => {
    setInternalKey("valid-test-key");
    expect(isInternalUnlocked()).toBe(true);
    expect(getInternalKey()).toBe("valid-test-key");
  });

  it("clearing the key locks the scanner again", () => {
    setInternalKey("valid-test-key");
    clearInternalKey();
    expect(isInternalUnlocked()).toBe(false);
    expect(getInternalKey()).toBeNull();
  });

  it("mergeAuthHeaders includes x-agentpulse-key after unlock", () => {
    setInternalKey("my-key");
    const headers = mergeAuthHeaders();
    expect(headers["x-agentpulse-key"]).toBe("my-key");
  });

  it("mergeAuthHeaders omits x-agentpulse-key when locked", () => {
    const headers = mergeAuthHeaders();
    expect("x-agentpulse-key" in headers).toBe(false);
  });

  it("mergeAuthHeaders preserves extra headers when locked", () => {
    const headers = mergeAuthHeaders({ Accept: "application/json" });
    expect(headers).toEqual({ Accept: "application/json" });
    expect("x-agentpulse-key" in headers).toBe(false);
  });

  it("mergeAuthHeaders merges extra headers when unlocked", () => {
    setInternalKey("my-key");
    const headers = mergeAuthHeaders({ "Content-Type": "application/json" });
    expect(headers["x-agentpulse-key"]).toBe("my-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("setInternalKey overwrites a previously stored key", () => {
    setInternalKey("first-key");
    setInternalKey("second-key");
    expect(getInternalKey()).toBe("second-key");
  });
});

describe("scanner access — non-browser environment (server-side)", () => {
  it("getInternalKey returns null without window", () => {
    expect(getInternalKey()).toBeNull();
  });

  it("setInternalKey is a no-op without window and does not throw", () => {
    expect(() => setInternalKey("test")).not.toThrow();
  });

  it("clearInternalKey is a no-op without window and does not throw", () => {
    expect(() => clearInternalKey()).not.toThrow();
  });

  it("isInternalUnlocked returns false without window", () => {
    expect(isInternalUnlocked()).toBe(false);
  });

  it("mergeAuthHeaders returns only extra headers without a key", () => {
    const headers = mergeAuthHeaders({ Accept: "application/json" });
    expect(headers).toEqual({ Accept: "application/json" });
  });
});
