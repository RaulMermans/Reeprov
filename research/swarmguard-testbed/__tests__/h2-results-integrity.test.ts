import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KARMA_POLICE_MONITOR_ID,
  KARMA_POLICE_MONITOR_VERSION,
} from "../src/karmaPolice";
import {
  PER_AGENT_MONITOR_ID,
  PER_AGENT_MONITOR_VERSION,
  POOLED_EVENT_MONITOR_ID,
  POOLED_EVENT_MONITOR_VERSION,
} from "../src/baselines";

const FROZEN_DETECTOR_SHA = "5a4bcb59afa37e110b641b35db99c9a6b453137a";
const SEALED_PACK_SHA256 = "5f380067a7e8b67985579f90b7c47d2ebfd03e269bed8dd39f3ad96b678a1132";
const PINNED_MAF_SHA = "82f03c81aba5c5e4b1b36589027470bc5d094422";

const REPO_ROOT = process.cwd();
const H2_DIR = join(REPO_ROOT, "research/swarmguard-testbed/results/h2");
const EXT_DIR = join(H2_DIR, "external-validation");
const DOCS_DIR = join(REPO_ROOT, "docs/research");

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function assertCleanPublicText(content: string, label: string): void {
  expect(content, `${label} leaked developer filesystem path`).not.toMatch(
    /\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+/
  );
  expect(content, `${label} leaked private oracle structure`).not.toMatch(
    /"oracle_labels"|"actual_modification"/
  );
}

describe("KARMA POLICE H2 — Detector Freeze & Evidence Package Integrity", () => {
  it("preserves an exact zero-diff freeze on karmaPolice and baselines since frozen SHA", () => {
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

  it("verifies manifest, monitor versions, and committed prediction SHA-256 hashes", async () => {
    const manifestRaw = await readFile(join(H2_DIR, "manifest.json"), "utf8");
    const monitorsRaw = await readFile(join(H2_DIR, "monitors.json"), "utf8");
    assertCleanPublicText(manifestRaw, "manifest.json");
    assertCleanPublicText(monitorsRaw, "monitors.json");

    const manifest = JSON.parse(manifestRaw) as {
      sealed_pack_version: string;
      sealed_pack_sha256: string;
      frozen_detector_commit_sha: string;
      evaluator_protocol: string;
      evaluation_regime: string;
      cases: Array<{
        case_id: string;
        domain_id: string;
        execution_mode: string;
        committed_predictions_sha256: string;
      }>;
    };
    expect(manifest.sealed_pack_version).toBe("h2.post_freeze.sealed.v1");
    expect(manifest.sealed_pack_sha256).toBe(SEALED_PACK_SHA256);
    expect(manifest.frozen_detector_commit_sha).toBe(FROZEN_DETECTOR_SHA);
    expect(manifest.evaluator_protocol).toBe("reeprov.swarmguard_testbed.evaluation.v2");
    expect(manifest.evaluation_regime).toBe("post_freeze_evaluator_controlled");
    expect(manifest.cases).toHaveLength(16);

    const monitors = JSON.parse(monitorsRaw) as {
      frozen_detector_commit_sha: string;
      monitors: Array<{
        monitor_id: string;
        monitor_version: string;
        uses_llm_judge: boolean;
      }>;
    };
    expect(monitors.frozen_detector_commit_sha).toBe(FROZEN_DETECTOR_SHA);
    expect(monitors.monitors).toEqual([
      expect.objectContaining({
        monitor_id: PER_AGENT_MONITOR_ID,
        monitor_version: PER_AGENT_MONITOR_VERSION,
        uses_llm_judge: false,
      }),
      expect.objectContaining({
        monitor_id: POOLED_EVENT_MONITOR_ID,
        monitor_version: POOLED_EVENT_MONITOR_VERSION,
        uses_llm_judge: false,
      }),
      expect.objectContaining({
        monitor_id: KARMA_POLICE_MONITOR_ID,
        monitor_version: KARMA_POLICE_MONITOR_VERSION,
        uses_llm_judge: false,
      }),
    ]);

    const predictionFiles = (await readdir(join(H2_DIR, "predictions"))).sort();
    const evaluationFiles = (await readdir(join(H2_DIR, "evaluations"))).sort();
    expect(predictionFiles).toHaveLength(16);
    expect(evaluationFiles).toHaveLength(16);

    for (const entry of manifest.cases) {
      expect(entry.execution_mode).toBe("offline_fixture");
      const predPath = join(H2_DIR, "predictions", `${entry.case_id}.predictions.json`);
      const evalPath = join(H2_DIR, "evaluations", `${entry.case_id}.evaluation.json`);
      const predRaw = await readFile(predPath, "utf8");
      const evalRaw = await readFile(evalPath, "utf8");
      assertCleanPublicText(predRaw, predPath);
      assertCleanPublicText(evalRaw, evalPath);
      expect(sha256(predRaw)).toBe(entry.committed_predictions_sha256);
    }
  });

  it("verifies evaluation.v2 metrics, confusion-matrix conservation, and separate provenance reporting", async () => {
    const summaryRaw = await readFile(join(H2_DIR, "metrics-summary.json"), "utf8");
    const confusionRaw = await readFile(join(H2_DIR, "confusion-matrices.json"), "utf8");
    const examplesRaw = await readFile(join(H2_DIR, "examples.json"), "utf8");
    const benchRefRaw = await readFile(join(H2_DIR, "published-benchmark-reference.json"), "utf8");

    for (const [label, raw] of [
      ["metrics-summary.json", summaryRaw],
      ["confusion-matrices.json", confusionRaw],
      ["examples.json", examplesRaw],
      ["published-benchmark-reference.json", benchRefRaw],
    ] as const) {
      assertCleanPublicText(raw, label);
    }

    const summary = JSON.parse(summaryRaw) as {
      blind_claim: boolean;
      sealed_pack_sha256: string;
      case_count: number;
      aggregates: Record<
        string,
        {
          classification: {
            accuracy: { numerator: number; denominator: number };
            contradiction_precision: { numerator: number; denominator: number };
            contradiction_recall: { numerator: number; denominator: number };
            prediction_coverage: { numerator: number; denominator: number };
            confusion: { counts: Record<string, number> };
          };
          causal: { responsible_agent_accuracy: { value: number | null } };
        }
      >;
      provenance_anomaly_summary: { total_anomalies_across_pack: number };
      execution_and_cost: {
        episode_execution_mode: string;
        provider_http_completed: boolean;
        monitor_cost_usd: number;
      };
    };

    expect(summary.blind_claim).toBe(false);
    expect(summary.sealed_pack_sha256).toBe(SEALED_PACK_SHA256);
    expect(summary.case_count).toBe(16);
    expect(summary.execution_and_cost.episode_execution_mode).toBe("offline_fixture");
    expect(summary.execution_and_cost.provider_http_completed).toBe(false);
    expect(summary.execution_and_cost.monitor_cost_usd).toBe(0);
    expect(summary.provenance_anomaly_summary.total_anomalies_across_pack).toBe(14);

    for (const monitorId of [
      PER_AGENT_MONITOR_ID,
      POOLED_EVENT_MONITOR_ID,
      KARMA_POLICE_MONITOR_ID,
    ]) {
      const agg = summary.aggregates[monitorId];
      expect(agg).toBeDefined();
      const counts = agg!.classification.confusion.counts;
      const totalClaims = Object.values(counts).reduce((acc, n) => acc + n, 0);
      expect(totalClaims).toBe(88);
      expect(agg!.classification.prediction_coverage).toMatchObject({
        numerator: 85,
        denominator: 88,
      });
      expect(agg!.causal.responsible_agent_accuracy.value).toBeNull();
    }

    const kp = summary.aggregates[KARMA_POLICE_MONITOR_ID]!;
    expect(kp.classification.accuracy).toMatchObject({ numerator: 68, denominator: 88 });
    expect(kp.classification.contradiction_recall).toMatchObject({ numerator: 16, denominator: 20 });
    expect(kp.classification.contradiction_precision).toMatchObject({
      numerator: 16,
      denominator: 22,
    });
    expect(kp.classification.confusion.counts["contradicted->supported"]).toBe(0);
    expect(kp.classification.confusion.counts["unverified->supported"]).toBe(0);
  });

  it("verifies external Microsoft Agent Framework provenance, hashes, and honest offline labeling", async () => {
    const provRaw = await readFile(join(EXT_DIR, "provenance.json"), "utf8");
    assertCleanPublicText(provRaw, "external-validation/provenance.json");

    const prov = JSON.parse(provRaw) as {
      frozen_detector_commit_sha: string;
      upstream: {
        pinned_commit_sha: string;
        executed_upstream_workflow: { upstream_code_modified: boolean };
      };
      execution_mode_classification: {
        execution_mode: string;
        provider_http_completed: boolean;
        is_live_llm: boolean;
      };
      adapter_scope: { custom_evaluator_written: boolean };
      episodes: Array<{
        episode_id: string;
        execution_mode: string;
        provider_http_completed: boolean;
        canonical_artifact_sha256: string;
        committed_predictions_sha256: string;
        evaluation_sha256: string;
      }>;
    };

    expect(prov.frozen_detector_commit_sha).toBe(FROZEN_DETECTOR_SHA);
    expect(prov.upstream.pinned_commit_sha).toBe(PINNED_MAF_SHA);
    expect(prov.upstream.executed_upstream_workflow.upstream_code_modified).toBe(false);
    expect(prov.execution_mode_classification).toMatchObject({
      execution_mode: "offline",
      provider_http_completed: false,
      is_live_llm: false,
    });
    expect(prov.adapter_scope.custom_evaluator_written).toBe(false);
    expect(prov.episodes).toHaveLength(2);

    for (const ep of prov.episodes) {
      expect(ep.execution_mode).toBe("offline");
      expect(ep.provider_http_completed).toBe(false);

      const artRaw = await readFile(join(EXT_DIR, `${ep.episode_id}.run-artifact.json`), "utf8");
      const predRaw = await readFile(join(EXT_DIR, `${ep.episode_id}.predictions.json`), "utf8");
      const evalRaw = await readFile(join(EXT_DIR, `${ep.episode_id}.evaluation.json`), "utf8");
      assertCleanPublicText(artRaw, `${ep.episode_id}.run-artifact.json`);
      assertCleanPublicText(predRaw, `${ep.episode_id}.predictions.json`);
      assertCleanPublicText(evalRaw, `${ep.episode_id}.evaluation.json`);

      expect(sha256(artRaw)).toBe(ep.canonical_artifact_sha256);
      expect(sha256(predRaw)).toBe(ep.committed_predictions_sha256);
      expect(sha256(evalRaw)).toBe(ep.evaluation_sha256);
    }
  });

  it("verifies presence and path hygiene of H2 research documentation", async () => {
    const docPaths = [
      join(DOCS_DIR, "karma-police-h2-protocol.md"),
      join(DOCS_DIR, "karma-police-h2-results.md"),
      join(DOCS_DIR, "karma-police-h2-failure-analysis.md"),
      join(H2_DIR, "REPRODUCE.md"),
    ];

    for (const path of docPaths) {
      const info = await stat(path);
      expect(info.isFile()).toBe(true);
      const text = await readFile(path, "utf8");
      expect(text.length).toBeGreaterThan(500);
      assertCleanPublicText(text, path);
    }
  });
});
