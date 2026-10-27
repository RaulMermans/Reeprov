import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as unlock } from "@/app/api/auth/unlock/route";
import { GET as session } from "@/app/api/auth/session/route";
import { authorizeRequest } from "../accessControl";

const KEY = "synthetic-local-access-key";
const local = (path: string, init: RequestInit = {}) =>
  new Request(`http://127.0.0.1:3000${path}`, { ...init, headers: { host: "127.0.0.1:3000", ...(init.headers ?? {}) } });

describe("PERSONAL_LOCAL with a configured access key", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const k of ["REEPROV_MODE", "AGENTPULSE_MODE", "AGENTPULSE_ACCESS_KEY"]) delete process.env[k];
    process.env["REEPROV_ACCESS_KEY"] = KEY;
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it("requires auth, rejects a wrong key, and issues a session that authorizes dashboard APIs", async () => {
    expect(await (await session(local("/api/auth/session"))).json()).toMatchObject({ mode: "personal_local", requiresAuth: true, authenticated: false });

    const wrong = await unlock(local("/api/auth/unlock", { method: "POST", body: JSON.stringify({ accessKey: "nope" }), headers: { "content-type": "application/json" } }));
    expect(wrong.status).toBe(401);

    const ok = await unlock(local("/api/auth/unlock", { method: "POST", body: JSON.stringify({ accessKey: KEY }), headers: { "content-type": "application/json" } }));
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toMatch(/=/);

    const authed = local("/api/runs", { headers: { cookie: cookie! } });
    await expect(authorizeRequest(authed, { capability: "DASHBOARD_READ" })).resolves.toMatchObject({ authorized: true });
    expect(await (await session(local("/api/auth/session", { headers: { cookie: cookie! } }))).json()).toMatchObject({ authenticated: true, requiresAuth: false });
  });
});
