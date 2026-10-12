import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runArtifactSchema, type RunArtifact } from "../../contracts/runArtifact";
import {
  analyzeRunMemory,
  buildMemoryLifecycles,
  analyzeMemoryInjections,
} from "../memoryAnalyzer";
import {
  memoryIntelligenceReportSchema,
  type MemoryIntelligenceReport,
} from "../../contracts/memoryIntelligence";
import {
  saveMemoryIntelligenceReport,
  loadMemoryIntelligenceReport,
  listMemoryIntelligenceReports,
} from "../persistence";

function loadFixture(filename: string): RunArtifact {
  const filePath = join(process.cwd(), "tests/fixtures/canonical", filename);
  const raw = JSON.parse(readFileSync(filePath, "utf-8"));
  return runArtifactSchema.parse(raw);
}

describe("Sprint 7: Memory Intelligence Engine", () => {
  const testStoreDir = join(process.cwd(), ".agentpulse-test-mem-intel");

  beforeEach(() => {
    process.env["AGENTPULSE_STORE_DIR"] = testStoreDir;
  });

  afterEach(() => {
    delete process.env["AGENTPULSE_STORE_DIR"];
    if (existsSync(testStoreDir)) {
      rmSync(testStoreDir, { recursive: true, force: true });
    }
  });

  describe("1. Memory Lifecycle Graph Reconstruction", () => {
    it("reconstructs lifecycle graph for Fixture D (memory operations)", () => {
      const run = loadFixture("fixture-d-memory-operations.json");
      const report = analyzeRunMemory(run);

      expect(report.run_id).toBe(run.identity.run_id);
      expect(report.lifecycles).toBeDefined();

      // Check lifecycles array contains the tracked memory
      const lc = report.lifecycles.find((l) => l.memory_id === "mem_user_pref_tz");
      expect(lc).toBeDefined();
      expect(lc?.memory_id).toBe("mem_user_pref_tz");
      expect(lc?.nodes.length).toBeGreaterThan(0);

      // Verify node types
      const opTypes = lc?.nodes.map((n) => n.operation_type);
      expect(opTypes).toContain("retrieval");
    });

    it("tracks multi-version evolution (write -> update -> supersede)", () => {
      const run = loadFixture("fixture-d-memory-operations.json");
      // Add update and supersede operations to simulate version evolution
      run.memory!.operations.push(
        {
          operation_id: "mem_op_update_v2",
          step_id: "step_chat_turn",
          operation_type: "update",
          memory_id: "mem_user_pref_tz",
          memory_type: "episodic",
          provider: "mem0",
          version: "v2.0",
          supersedes_memory_id: "mem_user_pref_tz@v1.0",
          timestamps: {
            created_at: "2026-10-11T12:00:00Z",
            operation_at: "2026-10-11T12:05:00Z",
          },
          outcome: "success",
        },
        {
          operation_id: "mem_op_supersede_v3",
          step_id: "step_mem_persist",
          operation_type: "supersede",
          memory_id: "mem_user_pref_tz",
          memory_type: "episodic",
          provider: "mem0",
          version: "v3.0",
          supersedes_memory_id: "mem_user_pref_tz@v2.0",
          timestamps: {
            created_at: "2026-10-11T12:00:00Z",
            operation_at: "2026-10-11T12:10:00Z",
          },
          outcome: "success",
        }
      );

      const report = analyzeRunMemory(run);
      const lc = report.lifecycles.find((l) => l.memory_id === "mem_user_pref_tz");

      expect(lc).toBeDefined();
      expect(lc?.versions_seen).toContain("v2.0");
      expect(lc?.versions_seen).toContain("v3.0");
      expect(report.operations_summary.updates_count).toBe(1);
      expect(report.operations_summary.supersedes_count).toBe(1);
    });
  });

  describe("2. Retrieval to Context Injection Tracking", () => {
    it("links retrieved memory directly to context snapshot and item", () => {
      const run = loadFixture("fixture-k-memory-ablation-baseline.json");
      const report = analyzeRunMemory(run);

      expect(report.injections).toHaveLength(1);
      const inj = report.injections[0];
      expect(inj.memory_id).toBe("mem_concise_01");
      expect(inj.context_snapshot_id).toBe("ctx_snap_mem_01");
      expect(inj.context_item_id).toBe("ctx_item_memory_concise");
      expect(inj.injected_tokens).toBe(80);
      expect(inj.is_stale_at_injection).toBe(false);

      expect(report.retrieval_summary.memories_retrieved_count).toBe(1);
      expect(report.retrieval_summary.memories_injected_count).toBe(1);
      expect(report.retrieval_summary.admission_rate).toBe(1.0);
    });
  });

  describe("3. Stale & Superseded Memory Injection Detection", () => {
    it("flags when an older version was injected when a newer version existed", () => {
      const run = loadFixture("fixture-k-memory-ablation-baseline.json");

      // Register that v2.0 exists in memory references
      run.memory!.references.push({
        memory_id: "mem_concise_01",
        category: "procedural",
        version: "v2.0",
        summary: "Updated customer preference: prefers concise answers with bullet points",
      });

      // The injected operation was v1.0
      const report = analyzeRunMemory(run);

      // Verify diagnostic signal generated
      const staleSignal = report.diagnostics.find(
        (d) => d.code === "MEMORY_OLD_VERSION_INJECTED" || d.code === "SUPERSEDED_MEMORY_INJECTED"
      );
      expect(staleSignal).toBeDefined();
      expect(staleSignal?.severity).toBe("WARNING");
      expect(staleSignal?.bounded_finding).toContain("v1.0");
    });
  });

  describe("4. Duplicate Memory Detection & Write Failures", () => {
    it("flags DUPLICATE_MEMORY when same content/query retrieved repeatedly", () => {
      const run = loadFixture("fixture-k-memory-ablation-baseline.json");

      // Add a duplicate retrieval operation
      run.memory!.operations.push({
        ...run.memory!.operations[0],
        operation_id: "mem_op_duplicate_retrieval",
      });

      const report = analyzeRunMemory(run);
      const dupSignal = report.diagnostics.find((d) => d.code === "MEMORY_EXACT_DUPLICATE");
      expect(dupSignal).toBeDefined();
      expect(dupSignal?.bounded_finding).toContain("retrieved 2 times");
    });

    it("tracks write failure operations accurately", () => {
      const run = loadFixture("fixture-k-memory-ablation-baseline.json");

      run.memory!.operations.push({
        operation_id: "mem_op_failed_write",
        step_id: "step_mem_init",
        operation_type: "committed_write",
        memory_id: "mem_temp_write",
        memory_type: "procedural",
        provider: "mem0",
        timestamps: {
          created_at: "2026-10-11T13:00:00Z",
          operation_at: "2026-10-11T13:00:01Z",
        },
        outcome: "failed",
      });

      const report = analyzeRunMemory(run);
      expect(report.operations_summary.write_failures_count).toBe(1);

      const failSignal = report.diagnostics.find((d) => d.code === "MEMORY_WRITE_FAILED");
      expect(failSignal).toBeDefined();
      expect(failSignal?.severity).toBe("CRITICAL");
    });
  });

  describe("5. Bounded Impact Evidence & Causality Levels", () => {
    it("emits strictly bounded CORRELATED evidence for unablated runs", () => {
      const run = loadFixture("fixture-k-memory-ablation-baseline.json");
      const report = analyzeRunMemory(run);

      expect(report.impact_evidence.length).toBeGreaterThan(0);
      for (const ev of report.impact_evidence) {
        // Must never claim CAUSALLY_SUPPORTED or proof before controlled ablation
        expect(["OBSERVED", "CORRELATED"]).toContain(ev.evidence_level);
        expect(ev.notes).toContain("Controlled counterfactual ablation required");
      }
    });
  });

  describe("6. Ablation Candidate Generation & Contract Integrity", () => {
    it("generates structured ablation candidates with memory_exclusion mutation", () => {
      const run = loadFixture("fixture-k-memory-ablation-baseline.json");
      const report = analyzeRunMemory(run);

      expect(report.ablation_candidates.length).toBeGreaterThan(0);
      const cand = report.ablation_candidates[0];

      expect(cand.candidate_id).toMatch(/^ablate_mem_/);
      expect(cand.memory_id).toBe("mem_concise_01");
      expect(cand.suggested_mutation.mutation_type).toBe("memory_exclusion");
      expect(cand.suggested_mutation.target_identifier).toBe("mem_concise_01");
      expect(cand.suggested_mutation.description).toContain("Exclude memory mem_concise_01");
    });

    it("validates full MemoryIntelligenceReport against Zod schema", () => {
      const run = loadFixture("fixture-k-memory-ablation-baseline.json");
      const report = analyzeRunMemory(run);

      const parsed = memoryIntelligenceReportSchema.parse(report);
      expect(parsed.report_id).toMatch(/^mem_rpt_/);
      expect(parsed.run_id).toBe(run.identity.run_id);
      expect(parsed.schema_version).toBe("1.0.0-alpha");
    });

    it("guarantees input RunArtifact immutability", () => {
      const run = loadFixture("fixture-k-memory-ablation-baseline.json");
      const opsBefore = run.memory?.operations.length;

      analyzeRunMemory(run);

      expect(run.memory?.operations.length).toBe(opsBefore);
    });
  });

  describe("7. Persistence & Querying", () => {
    it("saves and loads MemoryIntelligenceReport from filesystem", async () => {
      const run = loadFixture("fixture-k-memory-ablation-baseline.json");
      const report = analyzeRunMemory(run);

      await saveMemoryIntelligenceReport(report);

      const loadedByReportId = await loadMemoryIntelligenceReport(report.report_id);
      expect(loadedByReportId).not.toBeNull();
      expect(loadedByReportId?.report_id).toBe(report.report_id);
      expect(loadedByReportId?.run_id).toBe(report.run_id);
      expect(loadedByReportId?.injections).toHaveLength(1);

      const loadedByRunId = await loadMemoryIntelligenceReport(report.run_id);
      expect(loadedByRunId).not.toBeNull();
      expect(loadedByRunId?.report_id).toBe(report.report_id);

      const list = await listMemoryIntelligenceReports();
      expect(list.some((r) => r.report_id === report.report_id)).toBe(true);
    });
  });
});
