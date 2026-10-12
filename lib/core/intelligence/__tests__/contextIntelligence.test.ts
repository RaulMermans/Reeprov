import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runArtifactSchema, type RunArtifact } from "../../contracts/runArtifact";
import {
  analyzeContextRun,
  classifyItemProvenance,
  computeContextChurn,
  analyzeRetrievalAdmission,
} from "../contextAnalyzer";
import {
  contextIntelligenceReportSchema,
  type ContextIntelligenceReport,
} from "../../contracts/contextIntelligence";
import {
  saveContextIntelligenceReport,
  loadContextIntelligenceReport,
  listContextIntelligenceReports,
} from "../persistence";

function loadFixture(filename: string): RunArtifact {
  const filePath = join(process.cwd(), "tests/fixtures/canonical", filename);
  const raw = JSON.parse(readFileSync(filePath, "utf-8"));
  return runArtifactSchema.parse(raw);
}

describe("Sprint 7: Context Intelligence Engine", () => {
  const testStoreDir = join(process.cwd(), ".agentpulse-test-ctx-intel");

  beforeEach(() => {
    process.env["AGENTPULSE_STORE_DIR"] = testStoreDir;
  });

  afterEach(() => {
    delete process.env["AGENTPULSE_STORE_DIR"];
    if (existsSync(testStoreDir)) {
      rmSync(testStoreDir, { recursive: true, force: true });
    }
  });

  describe("1. Decision-Scoped Composition Analysis", () => {
    it("analyzes context composition for Fixture J (context ablation baseline)", () => {
      const run = loadFixture("fixture-j-context-ablation-baseline.json");
      const report = analyzeContextRun(run);

      expect(report.run_id).toBe(run.identity.run_id);
      expect(report.snapshots).toHaveLength(1);

      const snapAnalysis = report.snapshots[0];
      expect(snapAnalysis.snapshot_id).toBe("ctx_decision_01");
      expect(snapAnalysis.step_id).toBe("step_decision_01");

      const comp = snapAnalysis.composition;
      expect(comp.total_tokens).toBe(1750);
      expect(comp.item_count).toBe(5);

      // Verify source type breakdown
      const bySource = Object.fromEntries(comp.by_source_type.map((s) => [s.source_type, s.tokens]));
      expect(bySource["system_policy"]).toBe(250);
      expect(bySource["user_input"]).toBe(150);
      expect(bySource["retrieved_document"]).toBe(950); // 450 + 500
      expect(bySource["tool_definition"]).toBe(400);

      // Verify token share percentages sum to 100%
      const totalShare = comp.by_source_type.reduce((s, p) => s + p.percentage, 0);
      expect(Math.round(totalShare)).toBe(100);

      // Verify availability
      expect(comp.captured_tokens).toBe(1750);
      expect(comp.hash_only_tokens).toBe(0);
      expect(comp.unavailable_tokens).toBe(0);
    });

    it("evaluates token measurement quality accurately", () => {
      const run = loadFixture("fixture-j-context-ablation-baseline.json");
      const report = analyzeContextRun(run);
      const quality = report.snapshots[0].measurement_quality;

      expect(quality.tokenizer_counted_tokens).toBe(1250);
      expect(quality.estimated_tokens).toBe(500);
      expect(quality.exact_measured_percentage).toBeCloseTo((1250 / 1750) * 100, 1);
      expect(quality.estimated_percentage).toBeCloseTo((500 / 1750) * 100, 1);
    });

    it("evaluates mixed token measurement methods correctly", () => {
      const run = loadFixture("fixture-c-retrieval-context.json");
      const report = analyzeContextRun(run);
      const quality = report.snapshots[0].measurement_quality;

      expect(quality.exact_measured_percentage + quality.estimated_percentage).toBeGreaterThan(0);
    });
  });

  describe("2. Provenance Completeness Classification", () => {
    it("classifies complete provenance for documents with system, id, chunk, and score", () => {
      const run = loadFixture("fixture-j-context-ablation-baseline.json");
      const item = run.context[0].items.find((i) => i.item_id === "ctx_item_refund_policy")!;

      const coverage = classifyItemProvenance(item);
      expect(coverage.classification).toBe("COMPLETE");
      expect(coverage.declared_fields).toContain("source_system");
      expect(coverage.declared_fields).toContain("document_or_chunk_id");
      expect(coverage.missing_fields).toHaveLength(0);
    });

    it("classifies unknown source or partial provenance when fields are missing", () => {
      const coverage = classifyItemProvenance({
        item_id: "sparse_item",
        source_type: "retrieved_document",
        position: 0,
        content_captured: true,
        content: "Some doc snippet",
        content_hash: "sha256:abc",
        availability: "CAPTURED",
      });

      expect(coverage.classification).toBe("UNKNOWN_SOURCE");
      expect(coverage.missing_fields).toContain("source_system");
    });
  });

  describe("3. Deterministic Exact Duplicate Detection", () => {
    it("detects exact duplicate context item within the same snapshot", () => {
      const run = loadFixture("fixture-j-context-ablation-baseline.json");
      // Add a duplicate item to the snapshot with the exact same content hash
      const originalItem = run.context[0].items[0];
      run.context[0].items.push({
        ...originalItem,
        item_id: "ctx_item_duplicate_policy",
        position: run.context[0].items.length,
      });

      const report = analyzeContextRun(run);
      const snap = report.snapshots[0];

      expect(report.run_summary.exact_duplicates_count).toBe(1);

      const dupSignal = snap.signals.find((s) => s.code === "EXACT_DUPLICATE_CONTENT");
      expect(dupSignal).toBeDefined();
      expect(dupSignal?.severity).toBe("WARNING");
      expect(dupSignal?.token_impact).toBe(originalItem.token_estimate ?? 250);
      expect(dupSignal?.bounded_finding).toContain("identical content hash");

      // Verify ablation candidate generated for the duplicate
      const candidate = snap.ablation_candidates.find((c) => c.signal_code === "EXACT_DUPLICATE_CONTENT");
      expect(candidate).toBeDefined();
      expect(candidate?.suggested_mutation.mutation_type).toBe("context_exclusion");
    });
  });

  describe("4. Context Churn Analysis", () => {
    it("computes churn transition between consecutive snapshots", () => {
      const snapA = {
        snapshot_id: "snap_01",
        step_id: "step_01",
        timestamp: "2026-10-11T10:00:00Z",
        items: [
          {
            item_id: "i1",
            source_type: "system_policy" as const,
            position: 0,
            token_estimate: 200,
            content_captured: true,
            content: "Policy A",
            content_hash: "hash_policy",
            availability: "CAPTURED" as const,
          },
          {
            item_id: "i2",
            source_type: "user_input" as const,
            position: 1,
            token_estimate: 100,
            content_captured: true,
            content: "Question 1",
            content_hash: "hash_q1",
            availability: "CAPTURED" as const,
          },
        ],
      };

      const snapB = {
        snapshot_id: "snap_02",
        step_id: "step_02",
        timestamp: "2026-10-11T10:01:00Z",
        items: [
          {
            item_id: "i1",
            source_type: "system_policy" as const,
            position: 0,
            token_estimate: 200,
            content_captured: true,
            content: "Policy A",
            content_hash: "hash_policy",
            availability: "CAPTURED" as const,
          },
          {
            item_id: "i3",
            source_type: "retrieved_document" as const,
            position: 1,
            token_estimate: 400,
            content_captured: true,
            content: "Doc B",
            content_hash: "hash_doc_b",
            availability: "CAPTURED" as const,
          },
        ],
      };

      const churn = computeContextChurn([snapA, snapB]);
      expect(churn).toHaveLength(1);

      const trans = churn[0];
      expect(trans.from_snapshot_id).toBe("snap_01");
      expect(trans.to_snapshot_id).toBe("snap_02");
      expect(trans.tokens_retained).toBe(200);
      expect(trans.tokens_removed).toBe(100); // Question 1 removed
      expect(trans.tokens_added).toBe(400); // Doc B added
      expect(trans.context_churn_rate).toBeCloseTo(500 / 600, 2);
    });
  });

  describe("5. Retrieval Admission Tracking", () => {
    it("tracks admission rate and admitted vs omitted search results", () => {
      const run = loadFixture("fixture-j-context-ablation-baseline.json");
      const admissions = analyzeRetrievalAdmission(run.retrieval, run.context);

      expect(admissions).toHaveLength(1);
      const adm = admissions[0];
      expect(adm.operation_id).toBe("ret_op_policy_01");
      expect(adm.candidates_count).toBe(2);
      expect(adm.injected_count).toBe(2);
      expect(adm.admission_rate).toBe(1.0);

      // Verify item mapping
      expect(adm.items.every((i) => i.status === "RETRIEVED_AND_INJECTED")).toBe(true);
    });

    it("flags non-admitted retrieval candidate with RETRIEVED_NOT_ADMITTED signal", () => {
      const run = loadFixture("fixture-j-context-ablation-baseline.json");
      // Add a third result to the retrieval operation that was NOT injected
      run.retrieval[0].results.push({
        document_id: "doc_unadmitted_99",
        chunk_id: "chunk_unadmitted_99",
        content_hash: "sha256:unadmitted_hash",
        score: 0.42,
        rank: 3,
        content: "Shipping policy footnote not injected into prompt",
        metadata: { source: "kb" },
      });

      const report = analyzeContextRun(run);
      const retSignal = report.signals.find((s) => s.code === "RETRIEVED_NOT_ADMITTED");
      expect(retSignal).toBeDefined();
      expect(retSignal?.evidence?.document_id).toBe("doc_unadmitted_99");
      expect(retSignal?.bounded_finding).toContain("filtered before model context injection");
    });
  });

  describe("6. Tool Exposure Intelligence", () => {
    it("measures exposed tool definitions vs downstream tools used", () => {
      const run = loadFixture("fixture-j-context-ablation-baseline.json");
      const report = analyzeContextRun(run);

      const exposure = report.snapshots[0].tool_exposure;
      expect(exposure.tools_exposed_count).toBe(1);
      expect(exposure.tool_definition_tokens).toBe(400);
      expect(exposure.tools_used_count).toBe(1);
      expect(exposure.unused_exposed_tools).toHaveLength(0);
      expect(exposure.tool_token_share_percentage).toBeCloseTo((400 / 1750) * 100, 1);
    });

    it("flags TOOL_DEFINITION_BLOAT when many tools exposed but few used", () => {
      const run = loadFixture("fixture-j-context-ablation-baseline.json");
      // Add 12 unused tools occupying large share
      for (let i = 1; i <= 12; i++) {
        run.context[0].items.push({
          item_id: `ctx_tool_unused_${i}`,
          source_type: "tool_definition",
          source_reference: `tool://unused_${i}`,
          position: 10 + i,
          token_estimate: 200,
          content_captured: true,
          content: `function unused_${i}() {}`,
          content_hash: `sha256:unused_${i}`,
          availability: "CAPTURED",
        });
      }

      const report = analyzeContextRun(run);
      const bloatSignal = report.signals.find((s) => s.code === "TOOL_DEFINITION_BLOAT");
      expect(bloatSignal).toBeDefined();
      expect(bloatSignal?.severity).toBe("WARNING");
      expect(bloatSignal?.bounded_finding).toContain("unused tool schemas exposed");
    });
  });

  describe("7. Ablation Candidate Generation & Contract Integrity", () => {
    it("generates structured ablation candidates for retrieved items", () => {
      const run = loadFixture("fixture-j-context-ablation-baseline.json");
      const report = analyzeContextRun(run);

      // Low retrieval score or high token share generates ablation candidate
      expect(report.ablation_candidates).toBeDefined();
      expect(Array.isArray(report.ablation_candidates)).toBe(true);

      // Each candidate must adhere to the contract
      for (const cand of report.ablation_candidates) {
        expect(cand.candidate_id).toMatch(/^ablate_/);
        expect(cand.snapshot_id).toBeDefined();
        expect(cand.suggested_mutation.mutation_type).toBe("context_exclusion");
        expect(cand.suggested_mutation.target_identifier).toBe(cand.item_id);
      }
    });

    it("validates full ContextIntelligenceReport against Zod schema", () => {
      const run = loadFixture("fixture-j-context-ablation-baseline.json");
      const report = analyzeContextRun(run);

      const parsed = contextIntelligenceReportSchema.parse(report);
      expect(parsed.report_id).toMatch(/^ctx_rpt_/);
      expect(parsed.run_id).toBe(run.identity.run_id);
      expect(parsed.schema_version).toBe("1.0.0-alpha");
    });

    it("guarantees input RunArtifact immutability", () => {
      const run = loadFixture("fixture-j-context-ablation-baseline.json");
      const snapshotCountBefore = run.context.length;
      const itemsCountBefore = run.context[0].items.length;

      analyzeContextRun(run);

      expect(run.context.length).toBe(snapshotCountBefore);
      expect(run.context[0].items.length).toBe(itemsCountBefore);
    });
  });

  describe("8. Persistence & Querying", () => {
    it("saves and loads ContextIntelligenceReport from filesystem", async () => {
      const run = loadFixture("fixture-j-context-ablation-baseline.json");
      const report = analyzeContextRun(run);

      await saveContextIntelligenceReport(report);

      const loadedByReportId = await loadContextIntelligenceReport(report.report_id);
      expect(loadedByReportId).not.toBeNull();
      expect(loadedByReportId?.report_id).toBe(report.report_id);
      expect(loadedByReportId?.run_id).toBe(report.run_id);
      expect(loadedByReportId?.snapshots[0].composition.total_tokens).toBe(1750);

      const loadedByRunId = await loadContextIntelligenceReport(report.run_id);
      expect(loadedByRunId).not.toBeNull();
      expect(loadedByRunId?.report_id).toBe(report.report_id);

      const list = await listContextIntelligenceReports();
      expect(list.some((r) => r.report_id === report.report_id)).toBe(true);
    });
  });
});
