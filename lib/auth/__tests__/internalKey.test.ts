import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearInternalKey,
  getInternalKey,
  isInternalUnlocked,
  mergeAuthHeaders,
  setInternalKey,
} from "../internalKey";

const store: Record<string, string> = {};
const mockSessionStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("sessionStorage", mockSessionStorage);
  mockSessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getInternalKey", () => {
  it("returns null when no key stored", () => {
    expect(getInternalKey()).toBeNull();
  });

  it("returns stored key", () => {
    mockSessionStorage.setItem("agentpulse_access_key", "test-abc");
    expect(getInternalKey()).toBe("test-abc");
  });
});

describe("setInternalKey", () => {
  it("stores the key in sessionStorage", () => {
    setInternalKey("my-secret-key");
    expect(mockSessionStorage.getItem("agentpulse_access_key")).toBe("my-secret-key");
  });
});

describe("clearInternalKey", () => {
  it("removes the key from sessionStorage", () => {
    mockSessionStorage.setItem("agentpulse_access_key", "to-remove");
    clearInternalKey();
    expect(mockSessionStorage.getItem("agentpulse_access_key")).toBeNull();
  });
});

describe("isInternalUnlocked", () => {
  it("returns false when no key stored", () => {
    expect(isInternalUnlocked()).toBe(false);
  });

  it("returns true when a key is stored", () => {
    mockSessionStorage.setItem("agentpulse_access_key", "some-key");
    expect(isInternalUnlocked()).toBe(true);
  });
});

describe("mergeAuthHeaders", () => {
  it("returns empty object when no key stored", () => {
    expect(mergeAuthHeaders()).toEqual({});
  });

  it("includes x-agentpulse-key when key is stored", () => {
    mockSessionStorage.setItem("agentpulse_access_key", "my-key");
    expect(mergeAuthHeaders()).toEqual({ "x-agentpulse-key": "my-key" });
  });

  it("merges extra headers with auth header", () => {
    mockSessionStorage.setItem("agentpulse_access_key", "my-key");
    const headers = mergeAuthHeaders({ "Content-Type": "application/json" });
    expect(headers).toEqual({
      "x-agentpulse-key": "my-key",
      "Content-Type": "application/json",
    });
  });

  it("passes extra headers through even without a key", () => {
    const headers = mergeAuthHeaders({ Accept: "application/json" });
    expect(headers).toEqual({ Accept: "application/json" });
  });
});
