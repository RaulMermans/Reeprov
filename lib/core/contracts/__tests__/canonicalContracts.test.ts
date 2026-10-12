import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  runArtifactSchema,
  CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION,
  type RunArtifact,
} from "../runArtifact";
import {
  contextSourceTypeSchema,
  contextItemSchema,
  contextSnapshotSchema,
} from "../context";
import {
  memoryOperationSchema,
  memoryCategorySchema,
  memoryOperationTypeSchema,
} from "../memory";
import {
  evalResultSchema,
  evalFamilySchema,
} from "../evals";
import {
  experimentMutationSchema,
  runLineageSchema,
} from "../lineage";
import {
  replayabilityClassSchema,
  sideEffectClassSchema,
  executionBoundarySchema,
} from "../replay";
import { adaptLegacyRunToRunArtifact } from "../../adapters/legacyRunAdapter";
import type { SavedRun } from "@/lib/runs/runTypes";

function loadFixture<T = unknown>(filename: string): T {
  const filePath = path.join(process.cwd(), "tests/fixtures/canonical", filename);
  const content = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(content) as T;
}

describe("Canonical Execution Contracts & RunArtifact", () => {
  // ── 1. RunArtifact schema validates ───────────────────────────────────────
  describe("Requirement 1: RunArtifact schema validation", () => {
    it("validates Fixture A (simple LLM-only run)", () => {
      const data = loadFixture("fixture-a-simple-llm.json");
      const parsed = runArtifactSchema.parse(data);
      expect(parsed.schema_version).toBe(CANONICAL_RUN_ARTIFACT_SCHEMA_VERSION);
      expect(parsed.identity.run_id).toBe("run_fixture_a_simple_llm_001");
      expect(parsed.models).toHaveLength(1);
      expect(parsed.tools).toHaveLength(0);
    });

    it("validates Fixture B (LLM + tool run)", () => {
      const data = loadFixture("fixture-b-llm-tool.json");
      const parsed = runArtifactSchema.parse(data);
      expect(parsed.tools).toHaveLength(1);
      expect(parsed.tools[0].tool_name).toBe("fetch_stripe_customer");
      expect(parsed.models).toHaveLength(2);
      expect(parsed.boundaries).toHaveLength(3);
    });

    it("validates Fixture C (retrieval + context provenance)", () => {
      const data = loadFixture("fixture-c-retrieval-context.json");
      const parsed = runArtifactSchema.parse(data);
      expect(parsed.retrieval).toHaveLength(1);
      expect(parsed.context).toHaveLength(1);
      expect(parsed.context[0].items).toHaveLength(4);
    });

    it("validates Fixture D (memory operations)", () => {
      const data = loadFixture("fixture-d-memory-operations.json");
      const parsed = runArtifactSchema.parse(data);
      expect(parsed.memory.operations).toHaveLength(2);
      expect(parsed.memory.references).toHaveLength(2);
      expect(parsed.state).toHaveLength(1);
    });

    it("validates Fixture E (eval results)", () => {
      const data = loadFixture("fixture-e-eval-results.json");
      const parsed = runArtifactSchema.parse(data);
      expect(parsed.evals).toHaveLength(3);
      expect(parsed.execution.status).toBe("degraded");
    });

    it("validates Fixture F (fork and lineage)", () => {
      const data = loadFixture("fixture-f-fork-lineage.json");
      const parsed = runArtifactSchema.parse(data);
      expect(parsed.lineage.parent_run_id).toBe("run_fixture_b_llm_tool_002");
      expect(parsed.lineage.mutations).toHaveLength(1);
      expect(parsed.comparison?.outcome_verdict).toBe("improved");
    });

    it("validates Fixture J (context ablation baseline)", () => {
      const data = loadFixture("fixture-j-context-ablation-baseline.json");
      const parsed = runArtifactSchema.parse(data);
      expect(parsed.identity.run_id).toBe("run_ctx_ablation_baseline");
      expect(parsed.context).toHaveLength(1);
      expect(parsed.context[0].items).toHaveLength(5);
    });

    it("validates Fixture K (memory ablation baseline)", () => {
      const data = loadFixture("fixture-k-memory-ablation-baseline.json");
      const parsed = runArtifactSchema.parse(data);
      expect(parsed.identity.run_id).toBe("run_mem_ablation_baseline");
      expect(parsed.memory?.operations).toHaveLength(1);
      expect(parsed.context[0].items).toHaveLength(4);
    });
  });

  // ── 2. Existing run data maps without losing supported information ────────
  describe("Requirement 2: Legacy Run Adaptation", () => {
    it("maps partially captured legacy run into RunArtifact without data loss", () => {
      const legacyData = loadFixture<SavedRun>("fixture-g-legacy-partially-captured.json");
      const canonical = adaptLegacyRunToRunArtifact(legacyData);

      // Verify essential preserved fields
      expect(canonical.identity.run_id).toBe(legacyData.runRecord.run_id);
      expect(canonical.identity.project_id).toBe(legacyData.runRecord.project_id);
      expect(canonical.identity.workflow_id).toBe(legacyData.runRecord.workflow_id);
      expect(canonical.execution.status).toBe(legacyData.runRecord.status);
      expect(canonical.execution.duration_ms).toBe(legacyData.runRecord.total_duration_ms);
      expect(canonical.observability.total_cost_usd).toBe(legacyData.runRecord.total_cost_usd);
      expect(canonical.observability.evals_passed).toBe(legacyData.runRecord.evals_passed);

      // Verify trace events mapped to trajectory
      expect(canonical.trajectory).toHaveLength(legacyData.traceEvents.length);
      expect(canonical.trajectory[1].step_id).toBe(legacyData.traceEvents[1].event_id);
      expect(canonical.trajectory[1].input_summary).toBe(legacyData.traceEvents[1].input_summary);

      // Verify tool calls mapped
      expect(canonical.tools).toHaveLength(legacyData.toolCalls.length);
      expect(canonical.tools[0].tool_name).toBe(legacyData.toolCalls[0].tool_name);
      expect(canonical.tools[0].permission_class).toBe("read_only");

      // Verify model calls extracted
      expect(canonical.models).toHaveLength(1);
      expect(canonical.models[0].model_name).toBe("gpt-4");

      // Verify evals mapped
      expect(canonical.evals).toHaveLength(legacyData.evalResults.length);
      expect(canonical.evals[0].eval_type).toBe("schema_validity");

      // Verify explicit non-fabrication
      expect(canonical.context).toEqual([]);
      expect(canonical.memory.operations).toEqual([]);
      expect(canonical.provenance.capture_method).toBe("legacy_adaptation");
      expect(canonical.replay.overall_replayability).toBe("UNKNOWN");
    });
  });

  // ── 3. Unknown/new fields fail or degrade according to versioning policy ───
  describe("Requirement 3: Versioning & Degradation Policy", () => {
    it("rejects unsupported schema versions", () => {
      const valid = loadFixture<Record<string, unknown>>("fixture-a-simple-llm.json");
      const invalidVersion = { ...valid, schema_version: "2.0.0-incompatible" };
      expect(() => runArtifactSchema.parse(invalidVersion)).toThrow();
    });

    it("rejects unknown execution statuses", () => {
      const valid = loadFixture<Record<string, unknown>>("fixture-a-simple-llm.json");
      const invalidStatus = {
        ...valid,
        execution: { ...(valid.execution as object), status: "sleeping" },
      };
      expect(() => runArtifactSchema.parse(invalidStatus)).toThrow();
    });
  });

  // ── 4. ContextSnapshot distinguishes different context-source types ───────
  describe("Requirement 4: Context Source Types", () => {
    it("distinguishes system policy, instructions, skills, memory, and documents", () => {
      const sources = [
        "system_policy",
        "agent_instructions",
        "active_skill",
        "conversation_history",
        "run_state",
        "retrieved_document",
        "retrieved_memory",
        "tool_definition",
        "artifact_reference",
        "few_shot_example",
        "generated_intermediate_context",
        "user_input",
        "custom",
      ];

      for (const src of sources) {
        expect(contextSourceTypeSchema.parse(src)).toBe(src);
      }
      expect(() => contextSourceTypeSchema.parse("invalid_source_type")).toThrow();
    });

    it("validates a ContextSnapshot with multi-source items", () => {
      const snapshot = contextSnapshotSchema.parse({
        snapshot_id: "snap_test_001",
        timestamp: "2026-10-09T10:00:00Z",
        total_token_estimate: 800,
        items: [
          {
            item_id: "item_sys",
            source_type: "system_policy",
            position: 0,
            token_estimate: 150,
            content_captured: true,
            content: "Safety guidelines",
          },
          {
            item_id: "item_mem",
            source_type: "retrieved_memory",
            position: 1,
            token_estimate: 250,
            content_captured: true,
            content: "User prefers concise replies",
          },
        ],
      });
      expect(snapshot.items[0].source_type).toBe("system_policy");
      expect(snapshot.items[1].source_type).toBe("retrieved_memory");
    });
  });

  // ── 5. ContextItems retain provenance references ──────────────────────────
  describe("Requirement 5: Context Provenance", () => {
    it("retains provenance metadata across document retrieval", () => {
      const item = contextItemSchema.parse({
        item_id: "ctx_doc_chunk",
        source_type: "retrieved_document",
        position: 0,
        content_captured: true,
        content: "API documentation excerpt",
        provenance: {
          source_system: "qdrant",
          document_id: "doc_123",
          chunk_id: "chunk_456",
          uri: "file:///docs/api.md#L10-L30",
          version: "v3",
          retrieval_query: "how to authenticate",
          retrieval_score: 0.95,
        },
      });

      expect(item.provenance?.source_system).toBe("qdrant");
      expect(item.provenance?.document_id).toBe("doc_123");
      expect(item.provenance?.uri).toBe("file:///docs/api.md#L10-L30");
      expect(item.provenance?.retrieval_score).toBe(0.95);
    });
  });

  // ── 6. MemoryOperation distinguishes memory activity from run state ───────
  describe("Requirement 6: Memory vs State Distinction", () => {
    it("validates explicit memory operation types and memory categories", () => {
      expect(memoryCategorySchema.parse("working")).toBe("working");
      expect(memoryCategorySchema.parse("episodic")).toBe("episodic");
      expect(memoryCategorySchema.parse("semantic")).toBe("semantic");
      expect(memoryCategorySchema.parse("procedural")).toBe("procedural");

      const op = memoryOperationSchema.parse({
        operation_id: "mem_op_01",
        operation_type: "consolidation",
        memory_id: "mem_rule_01",
        memory_type: "procedural",
        provider: "mem0",
        timestamps: {
          operation_at: "2026-10-09T12:00:00Z",
        },
        outcome: "success",
      });

      expect(op.operation_type).toBe("consolidation");
      expect(op.memory_type).toBe("procedural");
    });

    it("verifies Fixture D maintains distinct memory operations and state snapshots", () => {
      const data = loadFixture<RunArtifact>("fixture-d-memory-operations.json");
      expect(data.memory.operations.length).toBeGreaterThan(0);
      expect(data.state.length).toBeGreaterThan(0);

      // Memory op targets external memory provider
      expect(data.memory.operations[0].provider).toBe("mem0");
      expect(data.memory.operations[0].memory_type).toBe("episodic");

      // State snapshot tracks internal ephemeral workflow accumulator
      expect(data.state[0].state_scope).toBe("workflow");
      expect(data.state[0].state_data).toHaveProperty("turns_count");
    });
  });

  // ── 7. EvalResult links correctly to runs and optionally steps ────────────
  describe("Requirement 7: Run-Linked Evals", () => {
    it("links EvalResults to target run and step with grader metadata", () => {
      const evalRes = evalResultSchema.parse({
        eval_id: "eval_001",
        eval_type: "tool_selection",
        evaluator_id: "tool_gate_v1",
        evaluator_version: "1.0",
        target_run_id: "run_test_123",
        target_step_id: "step_decision_2",
        name: "Correct Tool Selected",
        score: 1.0,
        passed: true,
        threshold: 1.0,
        grader_type: "deterministic",
        evidence_references: ["step_decision_2", "bnd_tool_call_4"],
        timestamp: "2026-10-09T10:00:00Z",
      });

      expect(evalRes.target_run_id).toBe("run_test_123");
      expect(evalRes.target_step_id).toBe("step_decision_2");
      expect(evalRes.eval_type).toBe("tool_selection");
      expect(evalRes.grader_type).toBe("deterministic");
    });

    it("supports all required canonical eval families", () => {
      const families = [
        "task_success",
        "output_validity",
        "schema_validity",
        "tool_selection",
        "argument_validity",
        "retrieval",
        "context",
        "memory",
        "trajectory",
        "safety",
        "approval_compliance",
        "regression",
        "cost",
        "latency",
      ];
      for (const fam of families) {
        expect(evalFamilySchema.parse(fam)).toBe(fam);
      }
    });
  });

  // ── 8. ExperimentMutation records exactly what changed ────────────────────
  describe("Requirement 8: ExperimentMutation Recording", () => {
    it("captures mutation without executing anything", () => {
      const mutation = experimentMutationSchema.parse({
        mutation_id: "mut_model_swap",
        mutation_type: "model",
        target_identifier: "reasoning_node",
        description: "Swap model from gpt-4o to claude-3-5-sonnet",
        original_value: "gpt-4o",
        mutated_value: "claude-3-5-sonnet",
      });

      expect(mutation.mutation_type).toBe("model");
      expect(mutation.original_value).toBe("gpt-4o");
      expect(mutation.mutated_value).toBe("claude-3-5-sonnet");
    });
  });

  // ── 9. Run lineage supports parent/fork/baseline without cycles ───────────
  describe("Requirement 9: Lineage and Acyclic Graph Validation", () => {
    it("validates run lineage structure", () => {
      const lineage = runLineageSchema.parse({
        parent_run_id: "run_parent_01",
        root_run_id: "run_root_00",
        fork_step_id: "step_3",
        baseline_run_id: "run_baseline_01",
        checkpoint_reference: {
          checkpoint_id: "chk_03",
          step_id: "step_3",
          created_at: "2026-10-09T10:00:00Z",
        },
        mutations: [],
      });

      expect(lineage.parent_run_id).toBe("run_parent_01");
      expect(lineage.fork_step_id).toBe("step_3");
    });

    it("detects and prevents cycles in parent lineages", () => {
      function detectCycle(runs: Array<{ id: string; parentId?: string }>): boolean {
        const parentMap = new Map<string, string>();
        for (const r of runs) {
          if (r.parentId) parentMap.set(r.id, r.parentId);
        }

        for (const startId of runs.map((r) => r.id)) {
          const visited = new Set<string>();
          let curr: string | undefined = startId;
          while (curr) {
            if (visited.has(curr)) return true; // Cycle detected
            visited.add(curr);
            curr = parentMap.get(curr);
          }
        }
        return false;
      }

      const validAcyclic = [
        { id: "run_1" },
        { id: "run_2", parentId: "run_1" },
        { id: "run_3", parentId: "run_2" },
      ];
      expect(detectCycle(validAcyclic)).toBe(false);

      const cyclic = [
        { id: "run_A", parentId: "run_B" },
        { id: "run_B", parentId: "run_C" },
        { id: "run_C", parentId: "run_A" },
      ];
      expect(detectCycle(cyclic)).toBe(true);
    });
  });

  // ── 10. Replayability classification validates ────────────────────────────
  describe("Requirement 10: Replayability Classification", () => {
    it("validates all supported replay capability classes", () => {
      const classes = [
        "REPLAYABLE_RECORDED",
        "REPLAYABLE_DETERMINISTIC",
        "REPLAYABLE_SANDBOXED",
        "LIVE_REQUIRED",
        "SIDE_EFFECT_GATED",
        "NON_REPLAYABLE",
        "UNKNOWN",
      ];
      for (const cls of classes) {
        expect(replayabilityClassSchema.parse(cls)).toBe(cls);
      }
      expect(() => replayabilityClassSchema.parse("AUTO_REPLAY")).toThrow();
    });
  });

  // ── 11. Side-effect metadata validates ────────────────────────────────────
  describe("Requirement 11: Side-Effect Metadata", () => {
    it("validates side-effect permission classes", () => {
      const classes = [
        "read_only",
        "write_draft",
        "external_side_effect",
        "sensitive_data",
        "destructive",
      ];
      for (const cls of classes) {
        expect(sideEffectClassSchema.parse(cls)).toBe(cls);
      }
      expect(() => sideEffectClassSchema.parse("unrestricted")).toThrow();
    });

    it("requires execution boundary to declare side effect and replayability", () => {
      const boundary = executionBoundarySchema.parse({
        boundary_id: "bnd_del_user",
        boundary_type: "database",
        name: "delete_user_record",
        input: { captured: true, summary: "userId: 123", redaction_status: "none" },
        replayability: "SIDE_EFFECT_GATED",
        side_effect_class: "destructive",
        timestamp: "2026-10-09T10:00:00Z",
      });

      expect(boundary.side_effect_class).toBe("destructive");
      expect(boundary.replayability).toBe("SIDE_EFFECT_GATED");
    });
  });

  // ── 12. Sensitive/raw-content absence is represented explicitly ───────────
  describe("Requirement 12: Content Absence & Redaction Representation", () => {
    it("explicitly represents content absence via flags and hashes", () => {
      const item = contextItemSchema.parse({
        item_id: "ctx_unretained",
        source_type: "system_policy",
        position: 0,
        content_captured: false,
        content_hash: "sha256:4a6f7b8c9d0e",
        redaction_status: "fully_redacted",
      });

      expect(item.content_captured).toBe(false);
      expect(item.content).toBeUndefined();
      expect(item.content_hash).toBe("sha256:4a6f7b8c9d0e");
      expect(item.redaction_status).toBe("fully_redacted");
    });
  });

  // ── 15. Serialization/deserialization is deterministic ────────────────────
  describe("Requirement 15: Deterministic Serialization & Roundtripping", () => {
    it("deterministically serializes and parses all fixtures", () => {
      const fixtures = [
        "fixture-a-simple-llm.json",
        "fixture-b-llm-tool.json",
        "fixture-c-retrieval-context.json",
        "fixture-d-memory-operations.json",
        "fixture-e-eval-results.json",
        "fixture-f-fork-lineage.json",
      ];

      for (const fix of fixtures) {
        const raw = loadFixture(fix);
        const parsed = runArtifactSchema.parse(raw);
        const serialized = JSON.stringify(parsed);
        const reParsed = runArtifactSchema.parse(JSON.parse(serialized));
        expect(reParsed).toEqual(parsed);
      }
    });
  });
});
