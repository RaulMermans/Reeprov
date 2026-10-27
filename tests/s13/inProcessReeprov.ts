/**
 * In-process Reeprov for hermetic SDK tests: `fetch` is routed straight to
 * the Next.js route handlers. No sockets, no network. Faults can be
 * injected to simulate lost acknowledgements and transient server errors.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST as startRun } from "@/app/api/runs/start/route";
import { POST as completeRun } from "@/app/api/runs/complete/route";
import { POST as failRun } from "@/app/api/runs/fail/route";
import { POST as postEvents } from "@/app/api/traces/events/route";
import { POST as postBoundaries } from "@/app/api/traces/boundaries/route";
import { GET as getCheckpoints, POST as postCheckpoint } from "@/app/api/runs/[runId]/checkpoints/route";

export const INGEST_KEY = "s13-synthetic-ingest-key";

type Handler = (request: Request, ctx: { params: Promise<{ runId: string }> }) => Promise<Response>;

const routes: Array<{ method: string; pattern: RegExp; handler: Handler }> = [
  { method: "POST", pattern: /^\/api\/runs\/start$/, handler: (r) => startRun(r) },
  { method: "POST", pattern: /^\/api\/runs\/complete$/, handler: (r) => completeRun(r) },
  { method: "POST", pattern: /^\/api\/runs\/fail$/, handler: (r) => failRun(r) },
  { method: "POST", pattern: /^\/api\/traces\/events$/, handler: (r) => postEvents(r) },
  { method: "POST", pattern: /^\/api\/traces\/boundaries$/, handler: (r) => postBoundaries(r) },
  { method: "POST", pattern: /^\/api\/runs\/([^/]+)\/checkpoints$/, handler: postCheckpoint as Handler },
  { method: "GET", pattern: /^\/api\/runs\/([^/]+)\/checkpoints$/, handler: getCheckpoints as Handler },
];

export interface Faults {
  /** Process the request, then throw a network error instead of returning the response (lost ack). */
  dropResponse?: (path: string, body: unknown) => boolean;
  /** Return 503 without processing. */
  unavailable?: (path: string) => boolean;
}

export interface InProcessReeprov {
  storeDir: string;
  calls: Array<{ path: string; status: number | "dropped" | "unavailable" }>;
  faults: Faults;
  restore(): Promise<void>;
}

const ENV_KEYS = ["REEPROV_STORE_DIR", "REEPROV_HOME", "REEPROV_INGEST_KEY", "AGENTPULSE_STORE_DIR", "AGENTPULSE_INGEST_KEY", "DATABASE_URL"];

export async function startInProcessReeprov(): Promise<InProcessReeprov> {
  const storeDir = await mkdtemp(join(tmpdir(), "reeprov-s13-"));
  const prior = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env["REEPROV_STORE_DIR"] = storeDir;
  process.env["REEPROV_HOME"] = storeDir;
  process.env["REEPROV_INGEST_KEY"] = INGEST_KEY;

  const originalFetch = globalThis.fetch;
  const state: InProcessReeprov = {
    storeDir,
    calls: [],
    faults: {},
    async restore() {
      globalThis.fetch = originalFetch;
      for (const [k, v] of Object.entries(prior)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await rm(storeDir, { recursive: true, force: true });
    },
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const route = routes.find((r) => r.method === method && r.pattern.test(url.pathname));
    if (!route) throw new TypeError(`in-process Reeprov: no route for ${method} ${url.pathname}`);
    if (state.faults.unavailable?.(url.pathname)) {
      state.calls.push({ path: url.pathname, status: "unavailable" });
      return new Response(JSON.stringify({ message: "unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
    }
    const runId = decodeURIComponent(url.pathname.match(route.pattern)?.[1] ?? "");
    const response = await route.handler(new Request(url, init), { params: Promise.resolve({ runId }) });
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (state.faults.dropResponse?.(url.pathname, body)) {
      state.calls.push({ path: url.pathname, status: "dropped" });
      throw new TypeError("fetch failed (simulated lost acknowledgement)");
    }
    state.calls.push({ path: url.pathname, status: response.status });
    return response;
  }) as typeof fetch;

  return state;
}
