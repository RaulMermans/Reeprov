import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BENCHMARK_CASE_COUNT,
  BENCHMARK_CASES,
  DEVELOPMENT_CASE_COUNT,
  HELD_OUT_CASE_COUNT,
  casesAreSubstantivelyDistinct,
  listBenchmarkCases,
  oracleManifest,
  publicManifest,
  sha256Json,
} from "../src/benchmark";
import { runAndEvaluate } from "../src/experiment";
import { useTestStore } from "./helpers";

describe("P3 benchmark catalog", () => {
  it("has 24 distinct cases with an 8/16 partition", () => {
    expect(BENCHMARK_CASES).toHaveLength(BENCHMARK_CASE_COUNT);
    expect(listBenchmarkCases("development")).toHaveLength(DEVELOPMENT_CASE_COUNT);
    expect(listBenchmarkCases("held_out")).toHaveLength(HELD_OUT_CASE_COUNT);
    expect(casesAreSubstantivelyDistinct()).toEqual([]);
    const ids = new Set(BENCHMARK_CASES.map((item) => item.case_id));
    expect(ids.size).toBe(24);
    expect(BENCHMARK_CASES.some((item) => item.injection.enabled === false)).toBe(true);
    expect(BENCHMARK_CASES.some((item) => item.oracle.some((label) => label.label === "supported"))).toBe(
      true
    );
    expect(BENCHMARK_CASES.some((item) => item.oracle.some((label) => label.label === "contradicted"))).toBe(
      true
    );
    expect(
      BENCHMARK_CASES.some((item) => item.oracle.some((label) => label.label === "insufficient_evidence"))
    ).toBe(true);
  });

  it("freezes public and oracle manifests with integrity hashes", () => {
    const pub = publicManifest();
    expect(pub.case_count).toBe(24);
    expect(pub.integrity_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(pub.integrity_hash).toBe(sha256Json({ ...pub, integrity_hash: undefined }));
    expect(JSON.stringify(pub)).not.toContain("incorrect_assertion");
    expect(JSON.stringify(pub)).not.toContain("incorrect assertion");
    expect(JSON.stringify(pub)).not.toContain("oracle");
    expect(JSON.stringify(pub)).not.toContain("skipped_validation");
    const held = oracleManifest("held_out");
    expect(held.cases).toHaveLength(16);
    expect(held.integrity_hash).toMatch(/^[a-f0-9]{64}$/);
  });

});

describe("P3 benchmark execution", () => {
  const store = useTestStore("p3-bench");

  it("runs a development case through baselines and independent scoring", async () => {
    const executed = await runAndEvaluate({
      caseId: "se-d01",
      outputDir: store.outputDir(),
      persist: true,
      runId: "run_bench_se_d01",
    });
    expect(executed.result.ground_truth.experimental_validity).toBe("valid");
    expect(executed.predictions).toHaveLength(2);
    expect(executed.evaluations).toHaveLength(2);
    expect(executed.result.ground_truth.oracle_labels.length).toBeGreaterThan(0);
    expect(executed.result.persisted?.summary.detector_dir).toContain("/detector/");
  });
});

describe("P3 held-out oracles stay out of detector and baseline source", () => {
  it("does not import held-out oracle files from detector or baseline modules", async () => {
    const files = [
      "research/swarmguard-testbed/src/detector.ts",
      "research/swarmguard-testbed/src/baselines/perAgent.ts",
      "research/swarmguard-testbed/src/baselines/pooledEvent.ts",
      "research/swarmguard-testbed/src/baselines/schema.ts",
    ];
    for (const file of files) {
      const source = await readFile(join(process.cwd(), file), "utf8");
      expect(source).not.toContain("oracles.heldout");
      expect(source).not.toContain("held_out");
    }
  });
});
