import { describe, it, expect } from "vitest";
import {
  canonicalJsonStringify,
  computeSha256,
  computeSha512,
  hashPayload,
  verifyPayloadHash,
} from "../hashing";

describe("Deterministic Content Hashing & JSON Canonicalization", () => {
  it("sorts object keys lexicographically regardless of original insertion order", () => {
    const objA = { b: 2, a: 1, c: { z: 10, y: 9 } };
    const objB = { a: 1, c: { y: 9, z: 10 }, b: 2 };

    const strA = canonicalJsonStringify(objA);
    const strB = canonicalJsonStringify(objB);

    expect(strA).toBe(strB);
    expect(strA).toBe('{"a":1,"b":2,"c":{"y":9,"z":10}}');
  });

  it("produces identical hashes for semantically equivalent payloads", () => {
    const payload1 = {
      model: "gpt-4o",
      temperature: 0.7,
      tools: ["search", "calc"],
      nested: { foo: "bar", baz: [1, 2, 3] },
    };
    const payload2 = {
      nested: { baz: [1, 2, 3], foo: "bar" },
      tools: ["search", "calc"],
      temperature: 0.7,
      model: "gpt-4o",
    };

    const hash1 = hashPayload(payload1);
    const hash2 = hashPayload(payload2);

    expect(hash1).toBe(hash2);
    expect(hash1.startsWith("sha256:")).toBe(true);
  });

  it("handles primitives, dates, null, NaN, and undefined consistently", () => {
    const now = new Date("2026-10-10T09:00:00.000Z");
    const data = {
      date: now,
      nil: null,
      missing: undefined,
      notANumber: NaN,
      negZero: -0,
      bool: true,
    };

    const str = canonicalJsonStringify(data);
    expect(str).toContain('"date":"2026-10-10T09:00:00.000Z"');
    expect(str).toContain('"nil":null');
    expect(str).toContain('"notANumber":null');
    expect(str).toContain('"negZero":0');
    expect(str).toContain('"bool":true');
    expect(str).not.toContain('"missing"');
  });

  it("handles circular references safely without infinite recursion", () => {
    const circular: Record<string, unknown> = { name: "cycle" };
    circular["self"] = circular;

    const str = canonicalJsonStringify(circular);
    expect(str).toBe('{"name":"cycle","self":"[Circular]"}');
  });

  it("verifies expected hash matching and detects hash mismatches", () => {
    const payload = { query: "What is AgentPulse?" };
    const hash = hashPayload(payload);

    expect(verifyPayloadHash(hash, payload)).toBe(true);
    expect(verifyPayloadHash(hash, { query: "What is LangChain?" })).toBe(false);
    expect(verifyPayloadHash("", payload)).toBe(false);
  });

  it("supports SHA-512 algorithm when specified", () => {
    const payload = { sample: "data" };
    const hash512 = hashPayload(payload, "sha512");
    expect(hash512.startsWith("sha512:")).toBe(true);
    expect(verifyPayloadHash(hash512, payload)).toBe(true);
  });
});
