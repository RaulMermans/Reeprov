import { afterEach, describe, expect, it } from "vitest";
import { GET } from "../route";

const originalAccessKey = process.env.AGENTPULSE_ACCESS_KEY;
const originalGithubToken = process.env.GITHUB_TOKEN;

afterEach(() => {
  process.env.AGENTPULSE_ACCESS_KEY = originalAccessKey;
  process.env.GITHUB_TOKEN = originalGithubToken;
});

describe("/api/repos", () => {
  it("returns 401 when access key header is missing", async () => {
    process.env.AGENTPULSE_ACCESS_KEY = "expected-key";

    const response = await GET(
      new Request("http://localhost/api/repos"),
    );

    expect(response.status).toBe(401);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("returns 401 when access key is wrong", async () => {
    process.env.AGENTPULSE_ACCESS_KEY = "expected-key";

    const response = await GET(
      new Request("http://localhost/api/repos", {
        headers: { "x-agentpulse-key": "wrong-key" },
      }),
    );

    expect(response.status).toBe(401);
  });

  it("returns 200 with mock repos when GITHUB_TOKEN is not configured", async () => {
    process.env.AGENTPULSE_ACCESS_KEY = "test-key";
    delete process.env.GITHUB_TOKEN;

    const response = await GET(
      new Request("http://localhost/api/repos", {
        headers: { "x-agentpulse-key": "test-key" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { mode: string; repos: unknown[] };
    expect(body.mode).toBe("mock");
    expect(Array.isArray(body.repos)).toBe(true);
    expect(body.repos.length).toBeGreaterThan(0);
  });

  it("valid key returns repos array", async () => {
    process.env.AGENTPULSE_ACCESS_KEY = "test-key";
    delete process.env.GITHUB_TOKEN;

    const response = await GET(
      new Request("http://localhost/api/repos", {
        headers: { "x-agentpulse-key": "test-key" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { repos: Array<{ owner: string; name: string; fullName: string }> };
    const first = body.repos[0];
    expect(typeof first.owner).toBe("string");
    expect(typeof first.name).toBe("string");
    expect(typeof first.fullName).toBe("string");
  });
});
