/**
 * Task 5 — Ingest key auth tests.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireIngestKey, IngestKeyError } from "@/lib/auth/requireIngestKey";

function makeRequest(key?: string): Request {
  const headers: Record<string, string> = {};
  if (key !== undefined) {
    headers["x-agentpulse-key"] = key;
  }
  return new Request("https://example.com/api/runs/start", { headers });
}

beforeEach(() => {
  delete process.env["AGENTPULSE_INGEST_KEY"];
  delete process.env["AGENTPULSE_ACCESS_KEY"];
});

afterEach(() => {
  delete process.env["AGENTPULSE_INGEST_KEY"];
  delete process.env["AGENTPULSE_ACCESS_KEY"];
});

describe("requireIngestKey — AGENTPULSE_INGEST_KEY set", () => {
  it("accepts a valid ingest key", () => {
    process.env["AGENTPULSE_INGEST_KEY"] = "ingest-secret";
    expect(() => requireIngestKey(makeRequest("ingest-secret"))).not.toThrow();
  });

  it("rejects wrong key", () => {
    process.env["AGENTPULSE_INGEST_KEY"] = "ingest-secret";
    expect(() => requireIngestKey(makeRequest("wrong-key"))).toThrow(IngestKeyError);
  });

  it("rejects missing key header", () => {
    process.env["AGENTPULSE_INGEST_KEY"] = "ingest-secret";
    expect(() => requireIngestKey(makeRequest())).toThrow(IngestKeyError);
  });

  it("does NOT accept AGENTPULSE_ACCESS_KEY when INGEST_KEY is set (keys differ)", () => {
    process.env["AGENTPULSE_INGEST_KEY"] = "ingest-secret";
    process.env["AGENTPULSE_ACCESS_KEY"] = "access-secret";
    expect(() => requireIngestKey(makeRequest("access-secret"))).toThrow(IngestKeyError);
  });
});

describe("requireIngestKey — AGENTPULSE_INGEST_KEY unset (fallback)", () => {
  it("accepts AGENTPULSE_ACCESS_KEY when INGEST_KEY is not set", () => {
    process.env["AGENTPULSE_ACCESS_KEY"] = "access-only";
    expect(() => requireIngestKey(makeRequest("access-only"))).not.toThrow();
  });

  it("rejects when neither key is configured", () => {
    expect(() => requireIngestKey(makeRequest("anything"))).toThrow(IngestKeyError);
  });
});
