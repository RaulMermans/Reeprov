import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

const originalAccessKey = process.env.AGENTPULSE_ACCESS_KEY;

afterEach(() => {
  process.env.AGENTPULSE_ACCESS_KEY = originalAccessKey;
});

describe("POST /api/auth/validate", () => {
  it("returns 401 when no access key header", async () => {
    process.env.AGENTPULSE_ACCESS_KEY = "expected-key";
    const res = await POST(new Request("http://localhost/api/auth/validate", { method: "POST" }));
    expect(res.status).toBe(401);
    const body = await res.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
  });

  it("returns 401 when wrong key", async () => {
    process.env.AGENTPULSE_ACCESS_KEY = "expected-key";
    const res = await POST(new Request("http://localhost/api/auth/validate", {
      method: "POST",
      headers: { "x-agentpulse-key": "wrong-key" },
    }));
    expect(res.status).toBe(401);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("returns 200 with ok:true and scope:dashboard for valid key", async () => {
    process.env.AGENTPULSE_ACCESS_KEY = "correct-key";
    const res = await POST(new Request("http://localhost/api/auth/validate", {
      method: "POST",
      headers: { "x-agentpulse-key": "correct-key" },
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; scope: string };
    expect(body.ok).toBe(true);
    expect(body.scope).toBe("dashboard");
  });

  it("does not leak the expected key in the response", async () => {
    process.env.AGENTPULSE_ACCESS_KEY = "my-secret-key";
    const res = await POST(new Request("http://localhost/api/auth/validate", {
      method: "POST",
      headers: { "x-agentpulse-key": "wrong-key" },
    }));
    const text = await res.text();
    expect(text).not.toContain("my-secret-key");
  });
});
