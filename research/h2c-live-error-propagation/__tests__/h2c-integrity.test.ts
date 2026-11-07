import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FROZEN_DETECTOR_SHA = "5a4bcb59afa37e110b641b35db99c9a6b453137a";
const PINNED_MAF_SHA = "82f03c81aba5c5e4b1b36589027470bc5d094422";
const REPO_ROOT = process.cwd();

describe("H2-C integrity guards", () => {
  it("does not modify frozen KARMA POLICE or baseline monitors", () => {
    const diff = execFileSync(
      "git",
      [
        "diff",
        FROZEN_DETECTOR_SHA,
        "--",
        "research/swarmguard-testbed/src/karmaPolice",
        "research/swarmguard-testbed/src/baselines",
      ],
      { cwd: REPO_ROOT, encoding: "utf8" }
    );
    expect(diff.trim()).toBe("");
  });

  it("does not rewrite frozen H2 result files", () => {
    const diff = execFileSync("git", ["diff", "HEAD", "--", "research/swarmguard-testbed/results/h2"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(diff.trim()).toBe("");
  });

  it("preregisters the expanded study before scoring", async () => {
    const manifest = JSON.parse(
      await readFile(join(REPO_ROOT, "research/h2c-live-error-propagation/scenarios/manifest.v1.json"), "utf8")
    ) as {
      frozen_before_expanded_study: boolean;
      upstream: { pinned_commit_sha: string; unmodified_upstream_handoff_builder_used: boolean };
      phases: { p0: string[]; p1: string[] };
      scenarios: Array<{ id: string; fault_mechanism: string }>;
    };
    expect(manifest.frozen_before_expanded_study).toBe(true);
    expect(manifest.upstream.pinned_commit_sha).toBe(PINNED_MAF_SHA);
    expect(manifest.upstream.unmodified_upstream_handoff_builder_used).toBe(false);
    expect(manifest.phases.p0).toEqual(["h2c-control-01", "h2c-contradiction-01"]);
    expect(manifest.phases.p1).toHaveLength(8);
    const mechanisms = new Set(manifest.scenarios.map((row) => row.fault_mechanism));
    expect(mechanisms).toEqual(new Set(["none", "factual_contradiction", "evidence_omission", "provenance_integrity"]));
  });

  it("keeps the H2-C evaluator from targeting frozen H2 export paths", async () => {
    const source = await readFile(
      join(REPO_ROOT, "research/h2c-live-error-propagation/scripts/run-h2c-evaluation.ts"),
      "utf8"
    );
    expect(source).toMatch(/Refusing to write H2-C evidence into the frozen H2 results directory/);
  });
});
