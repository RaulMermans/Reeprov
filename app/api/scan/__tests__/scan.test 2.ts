import { afterEach, describe, expect, it } from "vitest";
import { POST } from "../route";

const originalAccessKey = process.env.AGENTPULSE_ACCESS_KEY;

afterEach(() => {
  process.env.AGENTPULSE_ACCESS_KEY = originalAccessKey;
});

describe("/api/scan", () => {
  it("returns 401 when access key is missing", async () => {
    process.env.AGENTPULSE_ACCESS_KEY = "expected-key";
    const response = await POST(
      new Request("http://localhost/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mock: true }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 401 when access key is wrong", async () => {
    process.env.AGENTPULSE_ACCESS_KEY = "expected-key";
    const response = await POST(
      new Request("http://localhost/api/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agentpulse-key": "wrong-key",
        },
        body: JSON.stringify({ mock: true }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 200 with valid access key and mock=true", async () => {
    process.env.AGENTPULSE_ACCESS_KEY = "test-key";
    const response = await POST(
      new Request("http://localhost/api/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agentpulse-key": "test-key",
        },
        body: JSON.stringify({ mock: true }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { repoName?: string };
    expect(typeof body.repoName).toBe("string");
  });

  it("returns 200 with empty body when no GitHub token is configured (falls back to mock)", async () => {
    process.env.AGENTPULSE_ACCESS_KEY = "test-key";
    const savedToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      const response = await POST(
        new Request("http://localhost/api/scan", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-agentpulse-key": "test-key",
          },
          body: JSON.stringify({}),
        }),
      );
      expect(response.status).toBe(200);
    } finally {
      if (savedToken !== undefined) process.env.GITHUB_TOKEN = savedToken;
    }
  });
});
