/**
 * Deterministic Evaluator Adapter.
 *
 * Implements code-based, deterministic assertions across agent artifacts.
 *
 * Principles:
 * - Deterministic graders first: prefer deterministic assertions whenever testable.
 * - Missing evidence detection: if evidence required is missing, returns MISSING_EVIDENCE
 *   rather than fabricating a failed result.
 * - Structured assertions: validated before execution.
 * - Evaluator error != agent failure.
 */

import type { EvaluatorAdapter, EvalInput } from "./contracts";
import type { EvalResult, EvalFamily } from "../../contracts/evals";
import type { EvalTargetScope } from "../../contracts/evalDefinitions";
import { hashPayload } from "../../capture/hashing";

export class DeterministicEvaluatorAdapter implements EvaluatorAdapter {
  readonly evaluator_id = "agentpulse_deterministic_evaluator";
  readonly evaluator_version = "1.0.0";
  readonly grader_type = "deterministic" as const;
  readonly deterministic = true;
  readonly requires_model = false;
  readonly requires_human = false;

  readonly supported_families: EvalFamily[] = [
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
    "model_benchmark",
  ];

  readonly supported_target_scopes: EvalTargetScope[] = [
    "RUN",
    "STEP",
    "MODEL_CALL",
    "TOOL_CALL",
    "RETRIEVAL",
    "CONTEXT",
    "MEMORY",
    "ARTIFACT",
    "COMPARISON",
  ];

  async evaluate(input: EvalInput): Promise<EvalResult> {
    const startTime = Date.now();
    const { artifact, definition } = input;
    const config = definition.grader_config ?? {};
    const assertionType = String(config["type"] ?? "").toUpperCase();

    const resultTemplate = {
      eval_id: `eval_${definition.eval_definition_id}_${artifact.identity.run_id}_${Date.now()}`,
      eval_definition_id: definition.eval_definition_id,
      eval_definition_version: definition.version,
      eval_type: definition.family,
      evaluator_id: this.evaluator_id,
      evaluator_version: this.evaluator_version,
      target_run_id: artifact.identity.run_id,
      target_step_id: input.target_step_id,
      target_node_id: input.target_node_id,
      name: definition.name,
      severity: definition.severity,
      grader_type: this.grader_type,
      grader_config_hash: hashPayload(config),
      timestamp: new Date().toISOString(),
      evidence_references: [] as string[],
      findings: [] as string[],
    };

    // Pre-flight: Check evidence requirements
    const evidenceCheck = this.checkEvidenceRequirements(artifact, definition.evidence_requirements);
    if (!evidenceCheck.satisfied) {
      return {
        ...resultTemplate,
        passed: false,
        score: 0,
        grader_status: "MISSING_EVIDENCE",
        findings: [
          `Missing required evidence: ${evidenceCheck.missing.join(", ")}`,
        ],
        recommendation: "Ensure runtime captures the required evidence before running this evaluation.",
        execution_duration_ms: Date.now() - startTime,
      };
    }

    try {
      switch (assertionType) {
        case "SCHEMA_VALIDITY":
          return this.evalSchemaValidity(input, resultTemplate, startTime);

        case "EXACT_MATCH":
          return this.evalExactMatch(input, resultTemplate, startTime);

        case "CONTAINS":
          return this.evalContains(input, resultTemplate, startTime, false);

        case "NOT_CONTAINS":
          return this.evalContains(input, resultTemplate, startTime, true);

        case "REGEX_ASSERTION":
          return this.evalRegex(input, resultTemplate, startTime);

        case "TOOL_SELECTED":
          return this.evalToolSelected(input, resultTemplate, startTime);

        case "TOOL_NOT_SELECTED":
          return this.evalToolNotSelected(input, resultTemplate, startTime);

        case "TOOL_ARGUMENT_ASSERTION":
          return this.evalToolArgument(input, resultTemplate, startTime);

        case "TOOL_ORDER_ASSERTION":
          return this.evalToolOrder(input, resultTemplate, startTime);

        case "BOUNDARY_COUNT":
          return this.evalBoundaryCount(input, resultTemplate, startTime);

        case "BOUNDARY_SEQUENCE":
          return this.evalBoundarySequence(input, resultTemplate, startTime);

        case "STATE_ASSERTION":
          return this.evalStateAssertion(input, resultTemplate, startTime);

        case "ARTIFACT_EXISTS":
          return this.evalArtifactExists(input, resultTemplate, startTime);

        case "APPROVAL_COMPLIANCE":
          return this.evalApprovalCompliance(input, resultTemplate, startTime);

        case "SECURITY_VIOLATION_COUNT":
          return this.evalSecurityViolations(input, resultTemplate, startTime);

        case "SIDE_EFFECT_COMPLIANCE":
          return this.evalSideEffectCompliance(input, resultTemplate, startTime);

        case "COST_BUDGET":
          return this.evalCostBudget(input, resultTemplate, startTime);

        case "LATENCY_BUDGET":
          return this.evalLatencyBudget(input, resultTemplate, startTime);

        case "TOKEN_BUDGET":
          return this.evalTokenBudget(input, resultTemplate, startTime);

        case "CONTEXT_ITEM_PRESENT":
          return this.evalContextItemPresent(input, resultTemplate, startTime, true);

        case "CONTEXT_ITEM_ABSENT":
          return this.evalContextItemPresent(input, resultTemplate, startTime, false);

        case "MEMORY_ITEM_PRESENT":
          return this.evalMemoryItemPresent(input, resultTemplate, startTime, true);

        case "MEMORY_ITEM_ABSENT":
          return this.evalMemoryItemPresent(input, resultTemplate, startTime, false);

        case "OUTCOME_STATUS":
          return this.evalOutcomeStatus(input, resultTemplate, startTime);

        default:
          return {
            ...resultTemplate,
            passed: false,
            score: 0,
            grader_status: "EVALUATOR_ERROR",
            findings: [`Unknown structured assertion type: ${assertionType}`],
            execution_duration_ms: Date.now() - startTime,
          };
      }
    } catch (err: any) {
      return {
        ...resultTemplate,
        passed: false,
        score: 0,
        grader_status: "EVALUATOR_ERROR",
        findings: [`Evaluator execution error: ${err.message ?? String(err)}`],
        execution_duration_ms: Date.now() - startTime,
      };
    }
  }

  private checkEvidenceRequirements(
    artifact: EvalInput["artifact"],
    reqs: string[]
  ): { satisfied: boolean; missing: string[] } {
    const missing: string[] = [];
    for (const req of reqs) {
      switch (req.toLowerCase()) {
        case "tool_call":
        case "tools":
          if (!artifact.tools || artifact.tools.length === 0) missing.push(req);
          break;
        case "context":
        case "context_snapshot":
          if (!artifact.context || artifact.context.length === 0) missing.push(req);
          break;
        case "memory":
          if (!artifact.memory) missing.push(req);
          break;
        case "final_outcome":
          if (!artifact.evidence?.final_outcome) missing.push(req);
          break;
        case "boundaries":
          if (!artifact.boundaries || artifact.boundaries.length === 0) missing.push(req);
          break;
      }
    }
    return { satisfied: missing.length === 0, missing };
  }

  private evalSchemaValidity(
    input: EvalInput,
    base: any,
    startTime: number
  ): EvalResult {
    const config = input.definition.grader_config;
    const requiredKeys = (config["required_keys"] as string[]) ?? [];
    const outcome =
      input.artifact.evidence?.final_outcome?.payload ??
      input.artifact.evidence?.final_outcome ??
      (input.artifact as any).final_outcome;

    if (!outcome || typeof outcome !== "object") {
      return {
        ...base,
        passed: false,
        score: 0,
        grader_status: "FAILED",
        findings: ["Final outcome payload is missing or not a valid object"],
        execution_duration_ms: Date.now() - startTime,
      };
    }

    const payloadObj = outcome as Record<string, unknown>;
    const missingKeys = requiredKeys.filter((k) => !(k in payloadObj));
    const passed = missingKeys.length === 0;

    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      grader_status: passed ? "PASSED" : "FAILED",
      findings: passed
        ? ["Schema validation passed: all required keys present"]
        : [`Missing required keys: ${missingKeys.join(", ")}`],
      execution_duration_ms: Date.now() - startTime,
    };
  }

  private evalExactMatch(
    input: EvalInput,
    base: any,
    startTime: number
  ): EvalResult {
    const config = input.definition.grader_config;
    const expected = config["expected"];
    const actual = this.resolveField(input.artifact, config["field"] as string);

    const passed = JSON.stringify(actual) === JSON.stringify(expected);
    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      grader_status: passed ? "PASSED" : "FAILED",
      findings: passed
        ? ["Exact match succeeded"]
        : [`Value mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`],
      execution_duration_ms: Date.now() - startTime,
    };
  }

  private evalContains(
    input: EvalInput,
    base: any,
    startTime: number,
    negate: boolean
  ): EvalResult {
    const config = input.definition.grader_config;
    const substring = String(config["substring"] ?? "");
    const actualVal = String(this.resolveField(input.artifact, config["field"] as string) ?? "");

    const contains = actualVal.includes(substring);
    const passed = negate ? !contains : contains;

    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      grader_status: passed ? "PASSED" : "FAILED",
      findings: passed
        ? [negate ? `Substring "${substring}" correctly absent` : `Substring "${substring}" found`]
        : [negate ? `Disallowed substring "${substring}" was present` : `Expected substring "${substring}" not found in output`],
      execution_duration_ms: Date.now() - startTime,
    };
  }

  private evalRegex(
    input: EvalInput,
    base: any,
    startTime: number
  ): EvalResult {
    const config = input.definition.grader_config;
    const patternStr = String(config["pattern"] ?? "");
    const regex = new RegExp(patternStr, config["flags"] ? String(config["flags"]) : undefined);
    const actualVal = String(this.resolveField(input.artifact, config["field"] as string) ?? "");

    const passed = regex.test(actualVal);
    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      grader_status: passed ? "PASSED" : "FAILED",
      findings: passed
        ? [`Pattern /${patternStr}/ matched`]
        : [`Pattern /${patternStr}/ did not match target content`],
      execution_duration_ms: Date.now() - startTime,
    };
  }

  private evalToolSelected(
    input: EvalInput,
    base: any,
    startTime: number
  ): EvalResult {
    const config = input.definition.grader_config;
    const toolName = String(config["tool_name"] ?? config["tool_id"] ?? "");
    const expected = config["expected"] !== false;

    const matchedTools = input.artifact.tools.filter((t) => t.tool_name === toolName);
    const toolFound = matchedTools.length > 0;
    const passed = toolFound === expected;

    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      grader_status: passed ? "PASSED" : "FAILED",
      evidence_references: matchedTools.map((t) => t.tool_call_id),
      findings: passed
        ? [expected ? `Tool "${toolName}" was invoked ${matchedTools.length} time(s)` : `Tool "${toolName}" was correctly not invoked`]
        : [expected ? `Expected tool "${toolName}" was not invoked` : `Disallowed tool "${toolName}" was invoked`],
      execution_duration_ms: Date.now() - startTime,
    };
  }

  private evalToolNotSelected(
    input: EvalInput,
    base: any,
    startTime: number
  ): EvalResult {
    const config = { ...input.definition.grader_config, expected: false };
    return this.evalToolSelected({ ...input, definition: { ...input.definition, grader_config: config } }, base, startTime);
  }

  private evalToolArgument(
    input: EvalInput,
    base: any,
    startTime: number
  ): EvalResult {
    const config = input.definition.grader_config;
    const toolName = String(config["tool_name"] ?? config["tool_id"] ?? "");
    const argKey = String(config["argument_key"] ?? "");
    const expectedValue = config["expected_value"];

    const tool = input.artifact.tools.find((t) => t.tool_name === toolName);
    if (!tool) {
      return {
        ...base,
        passed: false,
        score: 0,
        grader_status: "MISSING_EVIDENCE",
        findings: [`Tool "${toolName}" was not invoked in this run; cannot verify arguments`],
        execution_duration_ms: Date.now() - startTime,
      };
    }

    let payload: unknown = tool.input;
    if (typeof payload === "string") {
      try { payload = JSON.parse(payload); } catch {}
    }
    if (!payload && typeof tool.input_summary === "string") {
      try { payload = JSON.parse(tool.input_summary); } catch {}
    }
    if (!payload && typeof tool.input_summary === "object" && tool.input_summary !== null) {
      payload = tool.input_summary;
    }
    let actualValue: unknown = undefined;
    if (typeof payload === "object" && payload !== null) {
      actualValue = (payload as Record<string, unknown>)[argKey];
    }

    let passed = false;
    if (config["predicate"] === "exists") {
      passed = actualValue !== undefined;
    } else if (expectedValue !== undefined) {
      passed = JSON.stringify(actualValue) === JSON.stringify(expectedValue);
    } else {
      passed = actualValue !== undefined;
    }

    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      grader_status: passed ? "PASSED" : "FAILED",
      evidence_references: [tool.tool_call_id],
      findings: passed
        ? [`Tool "${toolName}" argument "${argKey}" matched expected assertion`]
        : [`Tool "${toolName}" argument "${argKey}" mismatch: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`],
      execution_duration_ms: Date.now() - startTime,
    };
  }

  private evalToolOrder(
    input: EvalInput,
    base: any,
    startTime: number
  ): EvalResult {
    const config = input.definition.grader_config;
    const expectedSeq = (config["expected_sequence"] as string[]) ?? [];
    const actualTools = input.artifact.tools.map((t) => t.tool_name);

    let seqIdx = 0;
    for (const tool of actualTools) {
      if (tool === expectedSeq[seqIdx]) {
        seqIdx++;
        if (seqIdx === expectedSeq.length) break;
      }
    }

    const passed = seqIdx === expectedSeq.length;
    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      grader_status: passed ? "PASSED" : "FAILED",
      findings: passed
        ? [`Tool sequence satisfied: ${expectedSeq.join(" → ")}`]
        : [`Tool sequence violated: expected ${expectedSeq.join(" → ")}, observed ${actualTools.join(" → ")}`],
      execution_duration_ms: Date.now() - startTime,
    };
  }

  private evalBoundaryCount(
    input: EvalInput,
    base: any,
    startTime: number
  ): EvalResult {
    const config = input.definition.grader_config;
    const boundaries = input.artifact.boundaries ?? [];
    const count = boundaries.length;

    let passed = true;
    const reasons: string[] = [];
    if (typeof config["min"] === "number" && count < config["min"]) {
      passed = false;
      reasons.push(`Boundary count ${count} < minimum ${config["min"]}`);
    }
    if (typeof config["max"] === "number" && count > config["max"]) {
      passed = false;
      reasons.push(`Boundary count ${count} > maximum ${config["max"]}`);
    }
    if (typeof config["exact"] === "number" && count !== config["exact"]) {
      passed = false;
      reasons.push(`Boundary count ${count} != exact ${config["exact"]}`);
    }

    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      grader_status: passed ? "PASSED" : "FAILED",
      findings: passed ? [`Boundary count (${count}) satisfied bounds`] : reasons,
      execution_duration_ms: Date.now() - startTime,
    };
  }

  private evalBoundarySequence(
    input: EvalInput,
    base: any,
    startTime: number
  ): EvalResult {
    const config = input.definition.grader_config;
    const expected = (config["expected_sequence"] as string[]) ?? [];
    const actual = (input.artifact.boundaries ?? []).map((b) => b.name);

    let matchIdx = 0;
    for (const bName of actual) {
      if (bName === expected[matchIdx]) {
        matchIdx++;
        if (matchIdx === expected.length) break;
      }
    }

    const passed = matchIdx === expected.length;
    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      grader_status: passed ? "PASSED" : "FAILED",
      findings: passed
        ? [`Boundary sequence satisfied`]
        : [`Boundary sequence failed: expected ${expected.join(" → ")}, got ${actual.join(" → ")}`],
      execution_duration_ms: Date.now() - startTime,
    };
  }

  private evalStateAssertion(
    input: EvalInput,
    base: any,
    startTime: number
  ): EvalResult {
    const config = input.definition.grader_config;
    const key = String(config["key"] ?? "");
    const expectedVal = config["expected_value"];

    const lastSnapshot = input.artifact.state[input.artifact.state.length - 1];
    const lastStep = input.artifact.trajectory[input.artifact.trajectory.length - 1];
    const stateVal = (lastSnapshot?.state_data as Record<string, unknown> | undefined)?.[key] ?? (lastStep as any)?.state_after?.variables?.[key];

    const passed = JSON.stringify(stateVal) === JSON.stringify(expectedVal);
    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      grader_status: passed ? "PASSED" : "FAILED",
      findings: passed
        ? [`State variable "${key}" matched`]
        : [`State variable "${key}" mismatch: expected ${JSON.stringify(expectedVal)}, got ${JSON.stringify(stateVal)}`],
      execution_duration_ms: Date.now() - startTime,
    };
  }

  private evalArtifactExists(
    input: EvalInput,
    base: any,
    startTime: number
  ): EvalResult {
    const config = input.definition.grader_config;
    const artifactType = config["artifact_type"] ? String(config["artifact_type"]) : undefined;
    const minCount = Number(config["min_count"] ?? 1);

    const matches = input.artifact.artifacts.filter((a) => !artifactType || a.type === artifactType);
    const passed = matches.length >= minCount;

    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      grader_status: passed ? "PASSED" : "FAILED",
      findings: passed
        ? [`Found ${matches.length} artifact(s) matching criteria`]
        : [`Insufficient artifacts: required at least ${minCount}, found ${matches.length}`],
      execution_duration_ms: Date.now() - startTime,
    };
  }

  private evalApprovalCompliance(
    input: EvalInput,
    base: any,
    startTime: number
  ): EvalResult {
    const config = input.definition.grader_config;
    const expectedStatus = config["expected_status"] ? String(config["expected_status"]) : undefined;
    const actualStatus = input.artifact.safety.approval_status;

    let passed = true;
    if (expectedStatus && actualStatus !== expectedStatus) {
      passed = false;
    } else if (actualStatus === "rejected" || actualStatus === "pending") {
      passed = false;
    }

    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      grader_status: passed ? "PASSED" : "FAILED",
      findings: passed
        ? [`Approval compliance confirmed: status is "${actualStatus}"`]
        : [`Approval compliance violated: status is "${actualStatus}"`],
      execution_duration_ms: Date.now() - startTime,
    };
  }

  private evalSecurityViolations(
    input: EvalInput,
    base: any,
    startTime: number
  ): EvalResult {
    const config = input.definition.grader_config;
    const maxViolations = Number(config["max_violations"] ?? 0);
    const violations =
      input.artifact.evidence?.security_events?.filter(
        (e) => e.decision === "DENY" || e.decision === "BLOCKED"
      ).length ??
      (input.artifact.safety as any).security_violations?.length ??
      0;

    const passed = violations <= maxViolations;
    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      grader_status: passed ? "PASSED" : "FAILED",
      findings: passed
        ? [`Security violation count (${violations}) within limit of ${maxViolations}`]
        : [`Security violation count (${violations}) exceeded allowed maximum of ${maxViolations}`],
      execution_duration_ms: Date.now() - startTime,
    };
  }

  private evalSideEffectCompliance(
    input: EvalInput,
    base: any,
    startTime: number
  ): EvalResult {
    const config = input.definition.grader_config;
    const disallowed = (config["disallowed_side_effects"] as string[]) ?? ["destructive", "external_side_effect"];
    const recorded = input.artifact.boundaries.filter((b) => disallowed.includes(b.side_effect_class));

    const passed = recorded.length === 0;
    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      grader_status: passed ? "PASSED" : "FAILED",
      evidence_references: recorded.map((b) => b.boundary_id),
      findings: passed
        ? ["Zero disallowed side effects recorded"]
        : [`Disallowed side effects recorded: ${recorded.map((b) => `${b.name} (${b.side_effect_class})`).join(", ")}`],
      execution_duration_ms: Date.now() - startTime,
    };
  }

  private evalCostBudget(
    input: EvalInput,
    base: any,
    startTime: number
  ): EvalResult {
    const config = input.definition.grader_config;
    const maxCost = Number(config["max_usd"] ?? 1.0);
    const actualCost = input.artifact.observability.total_cost_usd ?? 0;

    const passed = actualCost <= maxCost;
    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      metric: "cost_usd",
      threshold: maxCost,
      grader_status: passed ? "PASSED" : "FAILED",
      findings: passed
        ? [`Cost $${actualCost.toFixed(4)} within budget limit of $${maxCost.toFixed(4)}`]
        : [`Cost $${actualCost.toFixed(4)} exceeded budget limit of $${maxCost.toFixed(4)}`],
      execution_duration_ms: Date.now() - startTime,
    };
  }

  private evalLatencyBudget(
    input: EvalInput,
    base: any,
    startTime: number
  ): EvalResult {
    const config = input.definition.grader_config;
    const maxLatencyMs = Number(config["max_duration_ms"] ?? 60_000);
    const actualLatencyMs = input.artifact.observability.total_duration_ms ?? 0;

    const passed = actualLatencyMs <= maxLatencyMs;
    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      metric: "duration_ms",
      threshold: maxLatencyMs,
      grader_status: passed ? "PASSED" : "FAILED",
      findings: passed
        ? [`Latency ${actualLatencyMs}ms within budget limit of ${maxLatencyMs}ms`]
        : [`Latency ${actualLatencyMs}ms exceeded budget limit of ${maxLatencyMs}ms`],
      execution_duration_ms: Date.now() - startTime,
    };
  }

  private evalTokenBudget(
    input: EvalInput,
    base: any,
    startTime: number
  ): EvalResult {
    const config = input.definition.grader_config;
    const maxTokens = Number(config["max_tokens"] ?? 10_000);
    const tokens = input.artifact.context[0]?.total_token_measurement?.value ?? 0;

    const passed = tokens <= maxTokens;
    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      metric: "tokens",
      threshold: maxTokens,
      grader_status: passed ? "PASSED" : "FAILED",
      findings: passed
        ? [`Token count (${tokens}) within budget of ${maxTokens}`]
        : [`Token count (${tokens}) exceeded budget of ${maxTokens}`],
      execution_duration_ms: Date.now() - startTime,
    };
  }

  private evalContextItemPresent(
    input: EvalInput,
    base: any,
    startTime: number,
    shouldBePresent: boolean
  ): EvalResult {
    const config = input.definition.grader_config;
    const itemId = config["item_id"] ? String(config["item_id"]) : undefined;
    const itemType = config["item_type"] ? String(config["item_type"]) : undefined;

    const allItems = input.artifact.context.flatMap((c) => c.items);
    const matched = allItems.filter((i) => {
      if (itemId && i.item_id !== itemId) return false;
      if (itemType && (i as any).item_type !== itemType && i.source_type !== itemType) return false;
      return true;
    });

    const isPresent = matched.length > 0;
    const passed = shouldBePresent ? isPresent : !isPresent;

    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      grader_status: passed ? "PASSED" : "FAILED",
      findings: passed
        ? [shouldBePresent ? `Context item matched criteria` : `Context item correctly absent`]
        : [shouldBePresent ? `Required context item not found in context snapshots` : `Context item was unexpectedly present in context snapshots`],
      execution_duration_ms: Date.now() - startTime,
    };
  }

  private evalMemoryItemPresent(
    input: EvalInput,
    base: any,
    startTime: number,
    shouldBePresent: boolean
  ): EvalResult {
    const config = input.definition.grader_config;
    const memoryId = config["memory_id"] ? String(config["memory_id"]) : undefined;

    const ops = input.artifact.memory?.operations ?? [];
    const matched = ops.filter((o) => !memoryId || o.memory_id === memoryId);

    const isPresent = matched.length > 0;
    const passed = shouldBePresent ? isPresent : !isPresent;

    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      grader_status: passed ? "PASSED" : "FAILED",
      findings: passed
        ? [shouldBePresent ? `Memory item matched criteria` : `Memory item correctly absent`]
        : [shouldBePresent ? `Required memory item not found in memory operations` : `Memory item was unexpectedly present in memory operations`],
      execution_duration_ms: Date.now() - startTime,
    };
  }

  private evalOutcomeStatus(
    input: EvalInput,
    base: any,
    startTime: number
  ): EvalResult {
    const config = input.definition.grader_config;
    const expected = String(config["expected_status"] ?? "SUCCESS").toUpperCase();
    const actual = String(
      input.artifact.evidence?.final_outcome?.status ??
      input.artifact.execution?.status ??
      (input.artifact as any).status ??
      "UNKNOWN"
    ).toUpperCase();

    const passed = actual === expected;
    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      grader_status: passed ? "PASSED" : "FAILED",
      findings: passed
        ? [`Outcome status matched: ${actual}`]
        : [`Outcome status mismatch: expected ${expected}, got ${actual}`],
      execution_duration_ms: Date.now() - startTime,
    };
  }

  private resolveField(artifact: EvalInput["artifact"], fieldPath?: string): unknown {
    if (!fieldPath) {
      return (
        artifact.evidence?.final_outcome?.payload ??
        artifact.evidence?.final_outcome?.summary ??
        artifact.identity.run_id
      );
    }
    const parts = fieldPath.split(".");
    let curr: any = artifact;
    for (const part of parts) {
      if (curr === undefined || curr === null) return undefined;
      curr = curr[part];
    }
    return curr;
  }
}
