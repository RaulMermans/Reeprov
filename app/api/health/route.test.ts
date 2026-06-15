import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  it("returns ok:true with environment, version, and time, without requiring a key", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; environment: string; version: string; time: string };
    expect(body.ok).toBe(true);
    expect(["production", "preview", "development"]).toContain(body.environment);
    expect(typeof body.version).toBe("string");
    expect(new Date(body.time).toString()).not.toBe("Invalid Date");
  });
});
