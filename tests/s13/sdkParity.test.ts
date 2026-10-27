import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hashPayload, canonicalJsonStringify } from "@/lib/core/capture/hashing";
import { readFileSync } from "node:fs";
import { canonicalJson, canonicalSha256 } from "@/packages/client-typescript/src/hash";
import { SDK_VERSION } from "@/packages/client-typescript/src/client";

const SAMPLES: unknown[] = [
  { b: 1.0, a: [null, true, "é", 0.1, 1e21, -0], z: { y: 2, x: "line\n" } },
  { incident_id: "INC-2041", config: { triage_policy: { version: "v1", sev1_error_rate: 0.05, consider_customer_impact: false } } },
  { nested: [{ k: "\u0001", emoji: "😀" }, [], {}], n: -12.5, big: 123456789012, tiny: 1e-7 },
];

const python = spawnSync("python3", ["--version"]).status === 0;

describe("SDK canonical hash parity", () => {
  it("TypeScript SDK serializes and hashes exactly like the server", async () => {
    for (const value of SAMPLES) {
      expect(canonicalJson(value)).toBe(canonicalJsonStringify(value));
      expect(await canonicalSha256(value)).toBe(hashPayload(value));
    }
  });

  it.skipIf(!python)("Python SDK hashes exactly like the server", () => {
    const script = "import json,sys; from reeprov_client.canonical import canonical_sha256 as h; print(json.dumps([h(v) for v in json.loads(sys.stdin.read())]))";
    const out = spawnSync("python3", ["-I", "-c", `import sys; sys.path.insert(0, ${JSON.stringify(join(process.cwd(), "packages/client-python/src"))}); ${script}`], {
      input: JSON.stringify(SAMPLES),
      encoding: "utf8",
    });
    expect(out.status, out.stderr).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual(SAMPLES.map((v) => hashPayload(v)));
  });
});

describe("SDK reported version", () => {
  it("matches the package manifests (it is sent to the server as run provenance)", () => {
    expect(SDK_VERSION).toBe(JSON.parse(readFileSync("packages/client-typescript/package.json", "utf8")).version);
    const py = readFileSync("packages/client-python/src/reeprov_client/client.py", "utf8").match(/SDK_VERSION = "([^"]+)"/)?.[1];
    expect(py).toBe(readFileSync("packages/client-python/pyproject.toml", "utf8").match(/^version = "([^"]+)"/m)?.[1]);
  });
});
