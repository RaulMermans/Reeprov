import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  agentConfigurationSnapshotSchema,
  buildAgentConfigurationSnapshot,
  computeConfigurationHashes,
  diffConfiguration,
  normalizeConfigurationSets,
  sanitizeConfigurationInput,
  type AgentConfigurationSnapshot,
} from "../configuration";
import {
  planEvidenceSchema,
  verificationEventSchema,
  testResultSchema,
  reviewResultSchema,
  approvalEvidenceSchema,
  securityEventSchema,
  runOutcomeSchema,
  computeEvidenceCompleteness,
  correlateActionTrail,
  validateVerificationSequence,
  type PlanEvidence,
  type VerificationEvent,
  type RunOutcome,
} from "../evidence";
import { runArtifactSchema, type RunArtifact } from "../runArtifact";
import { CaptureSession } from "../../capture/sdk";
import { saveCanonicalRun, getCanonicalRun } from "../../capture/persistence";
import { ForkRuntime } from "../../fork/runtime";
import { runCli } from "../../../../scripts/pulse-cli";

describe("Sprint 5: AgentPulse Evidence & Agent Configuration Plane Suite", () => {
  let sampleConfig: AgentConfigurationSnapshot;

  beforeEach(() => {
    sampleConfig = buildAgentConfigurationSnapshot({
      run_id: "run_test_cfg_001",
      agent: { id: "support-agent", name: "Support Agent", version: "3" },
      model: {
        provider: "anthropic",
        model_id: "claude-X",
        resolved_revision: "claude-X-20241022",
        parameters: { temperature: 0.2, max_tokens: 4096 },
      },
      prompts: [
        { id: "support", version: "7", content_hash: "sha256:prompt_v7_hash" },
        { id: "fallback", version: "1", content_hash: "sha256:prompt_fallback_hash" },
      ],
      skills: [
        { id: "refund-policy", version: "2", source: "policy_repo" },
        { id: "account-lookup", version: "1" },
      ],
      tools: [
        { id: "search_policy", version: "1", permission_class: "read_only" },
        { id: "get_customer_account", version: "2", permission_class: "sensitive_data" },
      ],
      permissions: {
        policy_id: "production",
        policy_version: "4",
        granted_capabilities: ["read_policy", "read_customer_data"],
      },
      runtime: {
        framework: "native",
        language_runtime: "node",
        git_sha: "commit_abc123",
      },
    });
  });

  // ── 1. AgentConfigurationSnapshot validation ──────────────────────────────
  it("Requirement 1: validates AgentConfigurationSnapshot structure and schema", () => {
    expect(sampleConfig.snapshot_id).toBeDefined();
    expect(sampleConfig.run_id).toBe("run_test_cfg_001");
    expect(sampleConfig.agent.id).toBe("support-agent");
    expect(sampleConfig.agent.version).toBe("3");
    expect(sampleConfig.model.model_id).toBe("claude-X");
    expect(sampleConfig.config_hash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const parsed = agentConfigurationSnapshotSchema.parse(sampleConfig);
    expect(parsed.config_hash).toBe(sampleConfig.config_hash);

    // Malformed config without version fails
    expect(() => {
      agentConfigurationSnapshotSchema.parse({
        ...sampleConfig,
        agent: { id: "agent_without_version" },
      });
    }).toThrow();
  });

  // ── 2. Stable config hash ─────────────────────────────────────────────────
  it("Requirement 2: produces deterministic stable config hash for identical configurations", () => {
    const configA = buildAgentConfigurationSnapshot({
      run_id: "run_a",
      agent: { id: "agent_1", version: "1.0" },
      model: { provider: "openai", model_id: "gpt-4o", parameters: { temp: 0 } },
      prompts: [{ id: "p1", version: "1" }],
      tools: [{ id: "t1", version: "1" }],
    });

    const configB = buildAgentConfigurationSnapshot({
      run_id: "run_b", // Different run ID
      agent: { id: "agent_1", version: "1.0" },
      model: { provider: "openai", model_id: "gpt-4o", parameters: { temp: 0 } },
      prompts: [{ id: "p1", version: "1" }],
      tools: [{ id: "t1", version: "1" }],
    });

    // Semantic configuration is identical -> config_hash must be identical!
    expect(configA.config_hash).toBe(configB.config_hash);
    expect(configA.agent_hash).toBe(configB.agent_hash);
    expect(configA.model_hash).toBe(configB.model_hash);
  });

  // ── 3. Unordered tool set hashes consistently ─────────────────────────────
  it("Requirement 3: produces identical tool_set_hash regardless of tool array order", () => {
    const tools1 = [
      { id: "tool_alpha", version: "1" },
      { id: "tool_beta", version: "2" },
      { id: "tool_gamma", version: "1" },
    ];
    const tools2 = [
      { id: "tool_gamma", version: "1" },
      { id: "tool_alpha", version: "1" },
      { id: "tool_beta", version: "2" },
    ];

    const config1 = buildAgentConfigurationSnapshot({
      run_id: "run_1",
      agent: { id: "agent_1", version: "1" },
      model: { provider: "anthropic", model_id: "claude-X" },
      tools: tools1,
    });

    const config2 = buildAgentConfigurationSnapshot({
      run_id: "run_2",
      agent: { id: "agent_1", version: "1" },
      model: { provider: "anthropic", model_id: "claude-X" },
      tools: tools2,
    });

    expect(config1.tool_set_hash).toBe(config2.tool_set_hash);
    expect(config1.config_hash).toBe(config2.config_hash);
  });

  // ── 4. Unordered skill set hashes consistently ─────────────────────────────
  it("Requirement 4: produces identical skill_set_hash regardless of skill array order", () => {
    const skills1 = [
      { id: "skill_a", version: "1" },
      { id: "skill_b", version: "3" },
    ];
    const skills2 = [
      { id: "skill_b", version: "3" },
      { id: "skill_a", version: "1" },
    ];

    const config1 = buildAgentConfigurationSnapshot({
      run_id: "run_1",
      agent: { id: "agent_1", version: "1" },
      model: { provider: "anthropic", model_id: "claude-X" },
      skills: skills1,
    });

    const config2 = buildAgentConfigurationSnapshot({
      run_id: "run_2",
      agent: { id: "agent_1", version: "1" },
      model: { provider: "anthropic", model_id: "claude-X" },
      skills: skills2,
    });

    expect(config1.skill_set_hash).toBe(config2.skill_set_hash);
    expect(config1.config_hash).toBe(config2.config_hash);
  });

  // ── 5. Secret redaction from configuration ────────────────────────────────
  it("Requirement 5: scrubs API keys and secret tokens from configuration inputs", () => {
    const rawInput = {
      run_id: "run_secret_test",
      agent: { id: "agent_1", version: "1" },
      model: {
        provider: "openai",
        model_id: "gpt-4o",
        parameters: {
          apiKey: "sk-ant-api03-abcdef1234567890abcdef1234567890",
          authHeader: "Bearer sk-12345678901234567890",
          dbUrl: "postgres://user:super_secret_password@db.internal:5432/db",
          safeParam: "allowed_value",
        },
      },
    };

    const snapshot = buildAgentConfigurationSnapshot(rawInput);
    const params = snapshot.model.parameters;

    expect(JSON.stringify(params)).not.toContain("super_secret_password");
    expect(JSON.stringify(params)).not.toContain("abcdef1234567890");
    expect(params["safeParam"]).toBe("allowed_value");
  });

  // ── 6. Structured PlanEvidence ────────────────────────────────────────────
  it("Requirement 6: captures structured PlanEvidence with goal and status items", () => {
    const plan: PlanEvidence = {
      plan_id: "plan_001",
      run_id: "run_001",
      goal: "Resolve billing inquiry",
      producer: "orchestrator@1.0",
      created_at: new Date().toISOString(),
      status: "IN_PROGRESS",
      items: [
        { id: "step_1", description: "Fetch account balance", status: "COMPLETED", dependencies: [], evidence_refs: [] },
        { id: "step_2", description: "Issue credit adjustment", status: "PLANNED", dependencies: ["step_1"], evidence_refs: [] },
      ],
    };

    const validated = planEvidenceSchema.parse(plan);
    expect(validated.plan_id).toBe("plan_001");
    expect(validated.items).toHaveLength(2);
    expect(validated.items[1].dependencies).toEqual(["step_1"]);
  });

  // ── 7. No hidden reasoning field allowed ──────────────────────────────────
  it("Requirement 7: strictly rejects private chain-of-thought or hidden reasoning fields in PlanEvidence", () => {
    const planWithReasoning = {
      plan_id: "plan_002",
      run_id: "run_002",
      goal: "Test reasoning rejection",
      producer: "agent",
      created_at: new Date().toISOString(),
      status: "PLANNED",
      items: [],
      reasoning: "Secret internal chain-of-thought that must not be captured",
    };

    expect(() => {
      planEvidenceSchema.parse(planWithReasoning);
    }).toThrow(/Forbidden private reasoning field/i);

    const planWithThought = {
      plan_id: "plan_003",
      run_id: "run_003",
      goal: "Test thought rejection",
      producer: "agent",
      created_at: new Date().toISOString(),
      status: "PLANNED",
      items: [],
      chain_of_thought: "Hidden thoughts",
    };

    expect(() => {
      planEvidenceSchema.parse(planWithThought);
    }).toThrow(/Forbidden private reasoning field/i);
  });

  // ── 8. VerificationEvent validation ───────────────────────────────────────
  it("Requirement 8: validates append-only VerificationEvent contract", () => {
    const event: VerificationEvent = {
      event_id: "vevt_001",
      run_id: "run_001",
      sequence_index: 0,
      event_type: "test.started",
      target_type: "test",
      target_id: "test_suite_1",
      status: "STARTED",
      actor: "test_runner",
      evidence_refs: [],
      artifact_refs: [],
    };

    const validated = verificationEventSchema.parse(event);
    expect(validated.event_id).toBe("vevt_001");
    expect(validated.sequence_index).toBe(0);
  });

  // ── 9. Append-only sequence validation ────────────────────────────────────
  it("Requirement 9: enforces monotonic sequence index and detects duplicate or out-of-order events", () => {
    const events: VerificationEvent[] = [
      {
        event_id: "evt_0",
        run_id: "r1",
        sequence_index: 0,
        event_type: "test.started",
        target_type: "test",
        status: "STARTED",
        actor: "runner",
        evidence_refs: [],
        artifact_refs: [],
      },
      {
        event_id: "evt_1",
        run_id: "r1",
        sequence_index: 1,
        event_type: "test.passed",
        target_type: "test",
        status: "PASSED",
        actor: "runner",
        evidence_refs: [],
        artifact_refs: [],
      },
    ];

    expect(validateVerificationSequence(events).valid).toBe(true);

    // Duplicate event ID
    const duplicateEvents: VerificationEvent[] = [
      events[0]!,
      { ...events[1]!, event_id: "evt_0" },
    ];
    const dupRes = validateVerificationSequence(duplicateEvents);
    expect(dupRes.valid).toBe(false);
    expect(dupRes.errors[0]).toMatch(/Duplicate verification event_id/);

    // Out-of-order sequence index
    const outOfOrderEvents: VerificationEvent[] = [
      events[0]!,
      { ...events[1]!, sequence_index: 5 },
    ];
    const orderRes = validateVerificationSequence(outOfOrderEvents);
    expect(orderRes.valid).toBe(false);
    expect(orderRes.errors[0]).toMatch(/Out-of-order sequence index/);
  });

  // ── 10. TestResult lifecycle ──────────────────────────────────────────────
  it("Requirement 10: tracks full TestResult lifecycle via CaptureSession verification helper", async () => {
    const session = new CaptureSession({
      projectId: "proj_evidence",
      workflowId: "wf_test",
      summary: "TestResult lifecycle",
    });

    const testHandle = session.verification.startTest("regression_suite", "test_refund_bounds");
    const testResult = testHandle.pass({ durationMs: 45, artifactRefs: ["uri://artifacts/test_report.xml"] });

    expect(testResult.status).toBe("PASSED");
    expect(testResult.suite).toBe("regression_suite");
    expect(testResult.duration_ms).toBe(45);

    const artifact = await session.finishRun();
    expect(artifact.evidence?.test_results).toHaveLength(1);
    expect(artifact.evidence?.test_results[0].name).toBe("test_refund_bounds");
    expect(artifact.evidence?.verification_events).toHaveLength(2); // test.started, test.passed
    expect(artifact.evidence?.verification_events[0].event_type).toBe("test.started");
    expect(artifact.evidence?.verification_events[1].event_type).toBe("test.passed");
  });

  // ── 11. ReviewResult lifecycle ────────────────────────────────────────────
  it("Requirement 11: captures ReviewResult and ReviewFindings via review helper", async () => {
    const session = new CaptureSession({
      projectId: "proj_evidence",
      workflowId: "wf_review",
      summary: "Review lifecycle",
    });

    const reviewHandle = session.verification.startReview("SECURITY", "sec_auditor_bot");
    const reviewResult = reviewHandle.pass({
      findings: [
        { severity: "info", category: "sanitization", message: "PII scrubbed successfully" },
      ],
    });

    expect(reviewResult.status).toBe("PASSED");
    expect(reviewResult.findings).toHaveLength(1);

    const artifact = await session.finishRun();
    expect(artifact.evidence?.review_results).toHaveLength(1);
    expect(artifact.evidence?.verification_events[1].event_type).toBe("review.passed");
  });

  // ── 12. Approval request/grant correlation ─────────────────────────────────
  it("Requirement 12: correlates approval requests and grants to privileged actions", () => {
    const approval = approvalEvidenceSchema.parse({
      approval_id: "app_100",
      action_id: "act_db_migration",
      requested_by: "agent_operator",
      required_permission_class: "destructive",
      requested_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
      resolved_by: "lead_dev",
      decision: "GRANTED",
      evidence_refs: ["change_spec_v2"],
    });

    expect(approval.decision).toBe("GRANTED");
    expect(approval.action_id).toBe("act_db_migration");
  });

  // ── 13. Permission denial event ───────────────────────────────────────────
  it("Requirement 13: records permission denial telemetry accurately", () => {
    const secEvent = securityEventSchema.parse({
      event_id: "sec_deny_01",
      run_id: "run_001",
      action_id: "act_delete_customer",
      tool_id: "db_delete",
      event_type: "permission.denied",
      decision: "DENY",
      reason_code: "INSUFFICIENT_PRIVILEGE",
      timestamp: new Date().toISOString(),
    });

    expect(secEvent.decision).toBe("DENY");
    expect(secEvent.reason_code).toBe("INSUFFICIENT_PRIVILEGE");
  });

  // ── 14. Policy violation event ────────────────────────────────────────────
  it("Requirement 14: records policy violation event", () => {
    const secEvent = securityEventSchema.parse({
      event_id: "sec_viol_01",
      run_id: "run_001",
      action_id: "act_exfiltrate",
      event_type: "policy.violation",
      decision: "BLOCKED",
      reason_code: "RATE_LIMIT_EXCEEDED",
      timestamp: new Date().toISOString(),
    });

    expect(secEvent.event_type).toBe("policy.violation");
    expect(secEvent.decision).toBe("BLOCKED");
  });

  // ── 15. Sensitive tool telemetry ──────────────────────────────────────────
  it("Requirement 15: records sensitive tool access telemetry", () => {
    const secEvent = securityEventSchema.parse({
      event_id: "sec_sens_01",
      run_id: "run_001",
      action_id: "act_read_pii",
      tool_id: "customer_pii_vault",
      permission_class: "sensitive_data",
      event_type: "sensitive_tool.accessed",
      decision: "ALLOW",
      timestamp: new Date().toISOString(),
    });

    expect(secEvent.permission_class).toBe("sensitive_data");
    expect(secEvent.decision).toBe("ALLOW");
  });

  // ── 16. Side-effect block telemetry ───────────────────────────────────────
  it("Requirement 16: records side_effect.blocked telemetry", () => {
    const secEvent = securityEventSchema.parse({
      event_id: "sec_blk_01",
      run_id: "run_001",
      action_id: "act_send_email",
      tool_id: "sendgrid_send",
      event_type: "side_effect.blocked",
      decision: "BLOCKED",
      reason_code: "OFFLINE_REPLAY_ACTIVE",
      timestamp: new Date().toISOString(),
    });

    expect(secEvent.event_type).toBe("side_effect.blocked");
    expect(secEvent.decision).toBe("BLOCKED");
  });

  // ── 17. Action ID correlation ─────────────────────────────────────────────
  it("Requirement 17: correlates complete action lifecycle using action_id", () => {
    const evidence = {
      security_events: [
        {
          event_id: "sec_1",
          run_id: "r1",
          action_id: "act_99",
          tool_id: "deploy_service",
          event_type: "action.requested",
          decision: "REQUIRE_APPROVAL" as const,
          timestamp: "2026-10-11T10:00:00Z",
        },
        {
          event_id: "sec_2",
          run_id: "r1",
          action_id: "act_99",
          tool_id: "deploy_service",
          event_type: "permission.checked",
          decision: "REQUIRE_APPROVAL" as const,
          policy_id: "deploy_gate_v1",
          timestamp: "2026-10-11T10:00:01Z",
        },
      ],
      approval_events: [
        {
          approval_id: "app_99",
          action_id: "act_99",
          requested_by: "agent",
          required_permission_class: "destructive",
          requested_at: "2026-10-11T10:00:02Z",
          resolved_at: "2026-10-11T10:00:10Z",
          resolved_by: "release_manager",
          decision: "GRANTED" as const,
          evidence_refs: [],
        },
      ],
      verification_events: [
        {
          event_id: "v_99",
          run_id: "r1",
          sequence_index: 0,
          event_type: "verification.passed" as const,
          target_type: "action",
          target_id: "act_99",
          status: "PASSED" as const,
          actor: "verifier",
          evidence_refs: [],
          artifact_refs: [],
          completed_at: "2026-10-11T10:00:20Z",
        },
      ],
      test_results: [],
      review_results: [],
    };

    const trails = correlateActionTrail(evidence);
    const trail = trails.get("act_99");

    expect(trail).toBeDefined();
    expect(trail?.action_requested).toBeDefined();
    expect(trail?.permission_checked).toBeDefined();
    expect(trail?.approval_decision?.decision).toBe("GRANTED");
    expect(trail?.verification?.status).toBe("PASSED");
    expect(trail?.timeline).toHaveLength(4);
  });

  // ── 18. Artifact evidence linkage ─────────────────────────────────────────
  it("Requirement 18: links test and review evidence to artifact references", async () => {
    const session = new CaptureSession({
      projectId: "proj_art",
      workflowId: "wf_art",
      summary: "Artifact linkage test",
    });

    session.recordTestResult({
      test_id: "t_art_1",
      suite: "e2e",
      name: "verify_output_doc",
      status: "PASSED",
      artifact_refs: ["uri://storage/out_doc.pdf"],
    });

    const artifact = await session.finishRun();
    expect(artifact.evidence?.test_results[0].artifact_refs).toContain("uri://storage/out_doc.pdf");
  });

  // ── 19. RunOutcome success ────────────────────────────────────────────────
  it("Requirement 19: records explicit SUCCESS RunOutcome", () => {
    const outcome: RunOutcome = {
      status: "SUCCESS",
      summary: "Agent completed ticket resolution with all verifications passing",
      verification_status: "PASS",
      tests_status: "PASS",
      review_status: "PASS",
      completed_at: new Date().toISOString(),
    };

    const validated = runOutcomeSchema.parse(outcome);
    expect(validated.status).toBe("SUCCESS");
    expect(validated.verification_status).toBe("PASS");
  });

  // ── 20. RunOutcome failure despite completed runtime ──────────────────────
  it("Requirement 20: records explicit RunOutcome FAILURE even if execution status is completed", async () => {
    const session = new CaptureSession({
      projectId: "proj_outcome",
      workflowId: "wf_outcome",
      summary: "Technical completion with test failure",
    });

    // Technical execution succeeds (no runtime exception)
    await session.step("execute_agent", "node", async () => {
      return { output: "done" };
    });

    // But evidence tests failed
    session.recordTestResult({
      test_id: "t_crit",
      suite: "safety",
      name: "jailbreak_check",
      status: "FAILED",
      failure_message: "Prompt injection detected in generated output",
    });

    session.setOutcome({
      status: "FAILURE",
      reason_code: "EVIDENCE_TEST_FAILED",
      summary: "Execution finished but safety test failed",
      verification_status: "FAIL",
      tests_status: "FAIL",
      completed_at: new Date().toISOString(),
    });

    const artifact = await session.finishRun({ status: "completed" });

    // Technical execution status is completed, but outcome is explicitly FAILURE
    expect(artifact.execution.status).toBe("completed");
    expect(artifact.evidence?.final_outcome?.status).toBe("FAILURE");
    expect(artifact.evidence?.final_outcome?.verification_status).toBe("FAIL");
  });

  // ── 21. Evidence completeness ─────────────────────────────────────────────
  it("Requirement 21: calculates accurate evidence completeness score and coverage breakdown", () => {
    const artifact: RunArtifact = {
      schema_version: "1.0.0-alpha",
      identity: {
        run_id: "run_comp_1",
        project_id: "p1",
        workflow_id: "w1",
        created_at: new Date().toISOString(),
      },
      execution: {
        status: "completed",
        started_at: new Date().toISOString(),
        summary: "test",
      },
      environment: {},
      trajectory: [],
      boundaries: [],
      external_calls: [],
      state: [],
      checkpoints: [],
      context: [],
      memory: { operations: [], references: [] },
      tools: [{ tool_call_id: "t1", tool_name: "tool_1", arguments: {}, status: "completed", started_at: "" }],
      retrieval: [],
      models: [],
      artifacts: [{ artifact_id: "a1", name: "report", type: "pdf", created_at: "" }],
      evals: [],
      lineage: { mutations: [] },
      provenance: { capture_method: "sdk_trace", redaction_verified: true },
      safety: { approval_status: "not_required", approval_records: [], redaction_summary: { total_redactions: 0, secrets_detected: 0, fields_redacted: [] } },
      observability: { model_calls_count: 0, tool_calls_count: 1, evals_passed: 0, evals_failed: 0, trace_event_count: 0, context_snapshot_count: 0, memory_operations_count: 0, retrieval_operations_count: 0 },
      replay: { overall_replayability: "UNKNOWN", unsupported_boundaries_count: 0, side_effect_gated_count: 0, deterministic: false, sandboxed_available: false, missing_recordings: [], notes: [] },
      configuration_snapshot: sampleConfig,
      evidence: {
        plan: {
          plan_id: "p1",
          run_id: "run_comp_1",
          goal: "goal",
          producer: "prod",
          created_at: "",
          status: "COMPLETED",
          items: [],
        },
        verification_events: [],
        test_results: [
          { test_id: "t1", run_id: "run_comp_1", suite: "s", name: "n", status: "PASSED", artifact_refs: [] },
        ],
        review_results: [],
        approval_events: [],
        security_events: [],
        final_outcome: {
          status: "SUCCESS",
          verification_status: "PASS",
          completed_at: "",
        },
      },
    };

    const completeness = computeEvidenceCompleteness(artifact);
    expect(completeness.coverage.configuration).toBe("PRESENT");
    expect(completeness.coverage.plan).toBe("PRESENT");
    expect(completeness.coverage.tools).toBe("PRESENT");
    expect(completeness.coverage.tests).toBe("PRESENT");
    expect(completeness.coverage.artifacts).toBe("PRESENT");
    expect(completeness.coverage.outcome).toBe("PRESENT");
    expect(completeness.coverage.review).toBe("NOT_CAPTURED");
    expect(completeness.score).toBeGreaterThan(60);
  });

  // ── 22. Required evidence policy ──────────────────────────────────────────
  it("Requirement 22: evaluates completeness against declared project evidence policy", () => {
    const sparseArtifact: RunArtifact = {
      schema_version: "1.0.0-alpha",
      identity: {
        run_id: "run_sparse",
        project_id: "p1",
        workflow_id: "w1",
        created_at: new Date().toISOString(),
      },
      execution: { status: "completed", started_at: "", summary: "" },
      environment: {},
      trajectory: [],
      boundaries: [],
      external_calls: [],
      state: [],
      checkpoints: [],
      context: [],
      memory: { operations: [], references: [] },
      tools: [],
      retrieval: [],
      models: [],
      artifacts: [],
      evals: [],
      lineage: { mutations: [] },
      provenance: { capture_method: "sdk_trace", redaction_verified: true },
      safety: { approval_status: "not_required", approval_records: [], redaction_summary: { total_redactions: 0, secrets_detected: 0, fields_redacted: [] } },
      observability: { model_calls_count: 0, tool_calls_count: 0, evals_passed: 0, evals_failed: 0, trace_event_count: 0, context_snapshot_count: 0, memory_operations_count: 0, retrieval_operations_count: 0 },
      replay: { overall_replayability: "UNKNOWN", unsupported_boundaries_count: 0, side_effect_gated_count: 0, deterministic: false, sandboxed_available: false, missing_recordings: [], notes: [] },
    };

    const strictPolicy = {
      configuration: "required" as const,
      tests: "required" as const,
      review: "optional" as const,
    };

    const evaluation = computeEvidenceCompleteness(sparseArtifact, strictPolicy);
    expect(evaluation.passed_policy).toBe(false);
    expect(evaluation.missing_required).toContain("configuration");
    expect(evaluation.missing_required).toContain("tests");
    expect(evaluation.coverage.configuration).toBe("MISSING_REQUIRED");
    expect(evaluation.coverage.tests).toBe("MISSING_REQUIRED");
  });

  // ── 23 & 24. Fork configuration inheritance & mutation delta ──────────────
  it("Requirements 23 & 24: forked runs inherit baseline configuration and reflect explicit prompt mutations", async () => {
    const parentSession = new CaptureSession({
      projectId: "proj_fork_cfg",
      workflowId: "wf_support",
      summary: "Parent run for fork test",
    });

    parentSession.setConfiguration({
      agent: { id: "support-agent", version: "3" },
      model: { provider: "anthropic", model_id: "claude-X" },
      prompts: [{ id: "support", version: "7", content_hash: "hash_p7" }],
      skills: [{ id: "refund-policy", version: "2" }],
      tools: [{ id: "search_policy", version: "1" }],
    });

    let checkpointId = "";
    await parentSession.step("step_0", "node", async (stepId) => {
      const { checkpoint } = parentSession.checkpoint({ status: "triaged" }, { stepId });
      checkpointId = checkpoint.checkpoint_id;
    });

    const parentArtifact = await parentSession.finishRun();
    expect(parentArtifact.configuration_snapshot).toBeDefined();
    const parentConfigHash = parentArtifact.configuration_snapshot!.config_hash;

    // Now execute fork from checkpoint with mutated prompt
    const forkRuntime = new ForkRuntime(parentArtifact, checkpointId, {
      mutations: [
        {
          mutation_id: "mut_prompt_8",
          mutation_type: "prompt",
          target_identifier: "support",
          description: "Update support prompt from v7 to v8",
          mutated_value: { version: "8", content_hash: "hash_p8" },
        },
      ],
      persist: false,
      executeLogic: async () => ({ status: "completed" }),
    });

    const forkResult = await forkRuntime.fork();
    expect(forkResult.status).toBe("COMPLETED");

    const childArtifact = forkResult.child_artifact!;
    expect(childArtifact).toBeDefined();
    expect(childArtifact.configuration_snapshot).toBeDefined();

    const childConfig = childArtifact.configuration_snapshot!;

    // 1. Child prompt reflects mutated version
    const mutatedPrompt = childConfig.prompts.find((p) => p.id === "support");
    expect(mutatedPrompt?.version).toBe("8");

    // 2. Child other items are inherited from parent baseline
    expect(childConfig.agent.id).toBe("support-agent");
    expect(childConfig.model.model_id).toBe("claude-X");
    expect(childConfig.skills.find((s) => s.id === "refund-policy")?.version).toBe("2");

    // 3. Child config_hash changed due to prompt mutation
    expect(childConfig.config_hash).not.toBe(parentConfigHash);

    // 4. Parent configuration remains immutable!
    expect(parentArtifact.configuration_snapshot!.prompts.find((p) => p.id === "support")?.version).toBe("7");
    expect(parentArtifact.configuration_snapshot!.config_hash).toBe(parentConfigHash);
  });

  // ── 25. Configuration diff ────────────────────────────────────────────────
  it("Requirement 25: diffConfiguration precisely isolates prompt version change", () => {
    const parentConfig = sampleConfig;
    const childConfig = buildAgentConfigurationSnapshot({
      ...parentConfig,
      run_id: "run_fork_child",
      prompts: [
        { id: "support", version: "8", content_hash: "hash_v8" }, // 7 -> 8
        parentConfig.prompts[1]!,
      ],
    });

    const diff = diffConfiguration(parentConfig, childConfig);
    expect(diff.identical).toBe(false);
    expect(diff.changed_prompts).toBe(true);
    expect(diff.changed_agent).toBe(false);
    expect(diff.changed_model).toBe(false);
    expect(diff.changed_skills).toBe(false);
    expect(diff.changed_tools).toBe(false);

    expect(diff.summary.some((s) => s.includes("support (7 → 8)"))).toBe(true);
    expect(diff.differences.prompts?.modified[0].id).toBe("support");
  });

  // ── 26. File persistence ──────────────────────────────────────────────────
  it("Requirement 26: persists and retrieves canonical run with full configuration and evidence", async () => {
    const session = new CaptureSession({
      projectId: "proj_persist",
      workflowId: "wf_persist",
      summary: "Persistence test",
    });

    session.setConfiguration({
      agent: { id: "test-agent", version: "1" },
      model: { provider: "openai", model_id: "gpt-4o" },
    });

    session.recordPlan({
      plan_id: "plan_p1",
      goal: "Persist plan test",
      producer: "test",
      created_at: new Date().toISOString(),
      status: "COMPLETED",
      items: [],
    });

    session.recordTestResult({
      test_id: "t_p1",
      suite: "unit",
      name: "test_save",
      status: "PASSED",
    });

    session.setOutcome({
      status: "SUCCESS",
      verification_status: "PASS",
      completed_at: new Date().toISOString(),
    });

    const artifact = await session.finishRun();
    const loaded = await getCanonicalRun(artifact.identity.run_id);

    expect(loaded).toBeDefined();
    expect(loaded?.configuration_snapshot?.config_hash).toBe(artifact.configuration_snapshot?.config_hash);
    expect(loaded?.evidence?.plan?.goal).toBe("Persist plan test");
    expect(loaded?.evidence?.test_results[0].test_id).toBe("t_p1");
    expect(loaded?.evidence?.final_outcome?.status).toBe("SUCCESS");
  });

  // ── 27. Backward-compatible legacy run ─────────────────────────────────────
  it("Requirement 27: seamlessly handles runs lacking configuration or evidence without error", () => {
    const legacyArtifactData = {
      schema_version: "1.0.0-alpha",
      identity: {
        run_id: "run_legacy_test_01",
        project_id: "p1",
        workflow_id: "w1",
        created_at: new Date().toISOString(),
      },
      execution: { status: "completed", started_at: "", summary: "legacy" },
      environment: {},
      trajectory: [],
      boundaries: [],
      external_calls: [],
      state: [],
      checkpoints: [],
      context: [],
      memory: { operations: [], references: [] },
      tools: [],
      retrieval: [],
      models: [],
      artifacts: [],
      evals: [],
      lineage: { mutations: [] },
      provenance: { capture_method: "sdk_trace", redaction_verified: true },
      safety: { approval_status: "not_required", approval_records: [], redaction_summary: { total_redactions: 0, secrets_detected: 0, fields_redacted: [] } },
      observability: { model_calls_count: 0, tool_calls_count: 0, evals_passed: 0, evals_failed: 0, trace_event_count: 0, context_snapshot_count: 0, memory_operations_count: 0, retrieval_operations_count: 0 },
      replay: { overall_replayability: "UNKNOWN", unsupported_boundaries_count: 0, side_effect_gated_count: 0, deterministic: false, sandboxed_available: false, missing_recordings: [], notes: [] },
      // Note: NO configuration_snapshot, NO evidence
    };

    const parsed = runArtifactSchema.parse(legacyArtifactData);
    expect(parsed.configuration_snapshot).toBeUndefined();
    expect(parsed.evidence).toBeUndefined();

    const completeness = computeEvidenceCompleteness(parsed);
    expect(completeness.coverage.configuration).toBe("NOT_CAPTURED");
  });

  // ── 28. CLI evidence command ──────────────────────────────────────────────
  it("Requirement 28: executes pulse evidence CLI command and outputs structured summary", async () => {
    const session = new CaptureSession({
      projectId: "proj_cli",
      workflowId: "wf_cli",
      summary: "CLI Evidence test",
    });

    session.setConfiguration({
      agent: { id: "cli-agent", version: "1" },
      model: { provider: "anthropic", model_id: "claude-X" },
    });

    session.recordTestResult({
      test_id: "t_cli",
      suite: "smoke",
      name: "cli_test",
      status: "PASSED",
    });

    session.setOutcome({
      status: "SUCCESS",
      verification_status: "PASS",
      completed_at: new Date().toISOString(),
    });

    const artifact = await session.finishRun();

    // Call CLI evidence with --json
    const code = await runCli(["evidence", artifact.identity.run_id, "--json"]);
    expect(code).toBe(0);
  });

  // ── 29. CLI config command ────────────────────────────────────────────────
  it("Requirement 29: executes pulse config CLI command", async () => {
    const session = new CaptureSession({
      projectId: "proj_cli_cfg",
      workflowId: "wf_cli_cfg",
      summary: "CLI Config test",
    });

    session.setConfiguration({
      agent: { id: "cfg-agent", version: "2" },
      model: { provider: "openai", model_id: "gpt-4o" },
    });

    const artifact = await session.finishRun();

    const code = await runCli(["config", artifact.identity.run_id, "--json"]);
    expect(code).toBe(0);
  });

  // ── 30. CLI config-diff command ───────────────────────────────────────────
  it("Requirement 30: executes pulse config-diff CLI command comparing two runs", async () => {
    const sessionA = new CaptureSession({
      projectId: "proj_diff",
      workflowId: "wf_diff",
      summary: "Run A",
    });
    sessionA.setConfiguration({
      agent: { id: "agent_diff", version: "1" },
      model: { provider: "openai", model_id: "gpt-4o" },
      prompts: [{ id: "prompt_a", version: "1" }],
    });
    const artifactA = await sessionA.finishRun();

    const sessionB = new CaptureSession({
      projectId: "proj_diff",
      workflowId: "wf_diff",
      summary: "Run B",
    });
    sessionB.setConfiguration({
      agent: { id: "agent_diff", version: "1" },
      model: { provider: "openai", model_id: "gpt-4o" },
      prompts: [{ id: "prompt_a", version: "2" }],
    });
    const artifactB = await sessionB.finishRun();

    // Exits 1 because they are different (which is expected for diff tool!)
    const code = await runCli(["config-diff", artifactA.identity.run_id, artifactB.identity.run_id, "--json"]);
    expect(code).toBe(1);
  });

  // ── 31. Canonical Fixture I: Reference Proof ────────────────────────────────
  it("Requirement 31: creates and validates canonical fixture-i-reference-proof.json representing the reference agent run", async () => {
    const session = new CaptureSession({
      runId: "run_proof_reference_001",
      projectId: "customer-support-agent",
      workflowId: "refund-pipeline",
      summary: "Handle refund request within policy and verify complete evidence",
    });

    session.setConfiguration({
      agent: {
        id: "support-agent",
        name: "Customer Support Agent",
        version: "3",
        implementation_ref: "agents/support.ts",
      },
      model: {
        provider: "anthropic",
        model_id: "claude-X",
        resolved_revision: "claude-3-5-sonnet-20241022",
        parameters: { temperature: 0.2, max_tokens: 2048 },
      },
      prompts: [
        {
          id: "support",
          version: "7",
          content_hash: "sha256:4f83b190c10b77fa8f6e0b769dc721e2e92c2e0e5a6ef6cb3d6fb3a2f7c0a5a1",
        },
      ],
      skills: [
        {
          id: "refund-policy",
          version: "2",
          source: "skills/refund-policy.md",
          content_hash: "sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        },
      ],
      tools: [
        {
          id: "search_policy",
          version: "1",
          schema_version: "1.0",
          permission_class: "READ",
        },
        {
          id: "get_customer_account",
          version: "2",
          schema_version: "2.0",
          permission_class: "READ",
        },
      ],
      permissions: {
        policy_id: "pol_support_standard",
        policy_version: "1.2",
        granted_capabilities: ["read:policy", "read:account", "request:refund"],
        denied_capabilities: ["execute:unauthorized_payout"],
      },
      workflow: {
        workflow_id: "refund-pipeline",
        workflow_version: "1.0",
      },
      runtime: {
        framework: "agent-runtime",
        framework_version: "2.4.0",
        language: "node",
        environment: "production@4",
        git_sha: "9f8a3c4b12e0",
        build_id: "build_84719",
      },
    });

    session.recordPlan({
      plan_id: "plan_proof_reference_001",
      goal: "Handle refund request within policy",
      producer: "support-agent",
      status: "COMPLETED",
      items: [
        { id: "item_1", description: "retrieve customer account", status: "COMPLETED", dependencies: [], evidence_refs: ["step_1"] },
        { id: "item_2", description: "verify refund policy constraints", status: "COMPLETED", dependencies: ["item_1"], evidence_refs: ["step_2"] },
        { id: "item_3", description: "execute authorized refund", status: "COMPLETED", dependencies: ["item_2"], evidence_refs: ["step_3"] },
      ],
    });

    // Step 1: Account retrieval
    await session.step("step_1", "retrieval", async (stepId) => {
      session.recordSecurityEvent({
        event_id: "sec_001",
        step_id: stepId,
        action_id: "act_lookup_001",
        agent_id: "support-agent",
        tool_id: "get_customer_account",
        permission_class: "READ",
        event_type: "action.requested",
        decision: "UNKNOWN",
      });
      session.recordSecurityEvent({
        event_id: "sec_002",
        step_id: stepId,
        action_id: "act_lookup_001",
        agent_id: "support-agent",
        tool_id: "get_customer_account",
        permission_class: "READ",
        event_type: "permission.checked",
        decision: "ALLOW",
      });
      session.recordSecurityEvent({
        event_id: "sec_003",
        step_id: stepId,
        action_id: "act_lookup_001",
        agent_id: "support-agent",
        tool_id: "get_customer_account",
        permission_class: "READ",
        event_type: "permission.granted",
        decision: "ALLOW",
      });
    });

    // Step 2: Policy verification & review
    await session.step("step_2", "eval", async (stepId) => {
      const testTracker = session.verification.startTest(
        "policy_compliance",
        "assert_refund_within_limit",
        { stepId }
      );
      testTracker.pass({ durationMs: 14 });

      const revTracker = session.verification.startReview(
        "POLICY",
        "compliance_guard",
        { stepId }
      );
      revTracker.pass([]);
    });

    // Step 3: Privileged refund action with approval
    await session.step("step_3", "tool_call", async (stepId) => {
      const actionId = "act_refund_001";
      session.recordSecurityEvent({
        event_id: "sec_004",
        step_id: stepId,
        action_id: actionId,
        agent_id: "support-agent",
        tool_id: "execute_refund",
        permission_class: "PRIVILEGED_FINANCIAL",
        event_type: "action.requested",
        decision: "REQUIRE_APPROVAL",
      });
      session.recordSecurityEvent({
        event_id: "sec_005",
        step_id: stepId,
        action_id: actionId,
        agent_id: "support-agent",
        tool_id: "execute_refund",
        permission_class: "PRIVILEGED_FINANCIAL",
        event_type: "permission.checked",
        decision: "REQUIRE_APPROVAL",
      });

      session.recordApproval({
        approval_id: "appr_refund_001",
        action_id: actionId,
        requested_by: "support-agent",
        required_permission_class: "PRIVILEGED_FINANCIAL",
        decision: "GRANTED",
        resolved_by: "supervisor_role",
      });

      session.recordSecurityEvent({
        event_id: "sec_006",
        step_id: stepId,
        action_id: actionId,
        agent_id: "support-agent",
        tool_id: "execute_refund",
        permission_class: "PRIVILEGED_FINANCIAL",
        event_type: "permission.granted",
        decision: "ALLOW",
        approval_id: "appr_refund_001",
      });
    });

    session.setOutcome({
      status: "SUCCESS",
      summary: "Refund processed successfully within authorized limits",
      verification_status: "PASS",
      tests_status: "PASS",
      review_status: "PASS",
      security_status: "PASS",
    });

    const artifact = await session.finishRun();
    expect(artifact.identity.run_id).toBe("run_proof_reference_001");
    expect(artifact.configuration_snapshot).toBeDefined();
    expect(artifact.evidence).toBeDefined();

    // Verify all aspects of Section 34
    const config = artifact.configuration_snapshot!;
    expect(config.agent.id).toBe("support-agent");
    expect(config.agent.version).toBe("3");
    expect(config.model.model_id).toBe("claude-X");
    expect(config.prompts.find((p) => p.id === "support")?.version).toBe("7");
    expect(config.skills.find((s) => s.id === "refund-policy")?.version).toBe("2");
    expect(config.tools.find((t) => t.id === "search_policy")?.version).toBe("1");
    expect(config.tools.find((t) => t.id === "get_customer_account")?.version).toBe("2");
    expect(config.runtime.environment).toBe("production@4");
    expect(config.runtime.framework).toBe("agent-runtime");

    const evidence = artifact.evidence!;
    expect(evidence.plan?.goal).toBe("Handle refund request within policy");
    expect(evidence.plan?.items).toHaveLength(3);
    expect(evidence.verification_events.length).toBeGreaterThanOrEqual(4);
    expect(evidence.security_events.length).toBeGreaterThanOrEqual(6);
    expect(evidence.approval_events).toHaveLength(1);
    expect(evidence.final_outcome?.status).toBe("SUCCESS");
    expect(evidence.final_outcome?.verification_status).toBe("PASS");
    expect(evidence.final_outcome?.tests_status).toBe("PASS");
    expect(evidence.final_outcome?.review_status).toBe("PASS");

    // Write fixture file
    const fixturePath = path.resolve(
      process.cwd(),
      "tests/fixtures/canonical/fixture-i-reference-proof.json"
    );
    fs.writeFileSync(fixturePath, JSON.stringify(artifact, null, 2), "utf8");

    // Verify written file can be read and parsed by runArtifactSchema
    const reloaded = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    const parsed = runArtifactSchema.parse(reloaded);
    expect(parsed.identity.run_id).toBe("run_proof_reference_001");
  });
});
