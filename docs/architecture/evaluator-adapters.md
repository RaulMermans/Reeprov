# Evaluator Adapters Architecture

> **Canonical Role:** Plug-and-play evaluation graders for deterministic assertions, model-based judging, and human review.

---

## 1. Adapter Contract

All evaluators in Reeprov implement the `EvaluatorAdapter` interface:

```typescript
export interface EvaluatorAdapter {
  evaluator_id: string;
  evaluator_version: string;
  grader_type: "deterministic" | "model_based" | "human";
  supported_families: EvalFamily[];
  supported_target_scopes: EvalTargetScope[];
  isDeterministic(): boolean;
  requiresModel(): boolean;
  requiresHuman(): boolean;

  evaluate(input: EvalInput): Promise<EvalResult>;
}
```

Every result records the exact `evaluator_id` and `evaluator_version` that produced it.

---

## 2. Deterministic Grader First (`DeterministicEvaluatorAdapter`)

Reeprov prioritizes deterministic graders whenever an assertion is objectively verifiable. This avoids non-deterministic model variance, eliminates unnecessary LLM API costs, and executes in sub-millisecond durations.

Supported structured assertions:

| Assertion Type | Target Scope | Description |
|---|---|---|
| `OUTCOME_STATUS` | `RUN` | Verifies final outcome status equals expected (`SUCCESS`, `FAILED`, etc.) |
| `SCHEMA_VALIDITY` | `RUN` / `STEP` | Validates final outcome payload against required object keys or JSON schema |
| `EXACT_MATCH` | Any | Verifies field value exactly matches expected payload |
| `CONTAINS` / `NOT_CONTAINS` | Any | Verifies substring presence or absence in target text field |
| `REGEX_ASSERTION` | Any | Validates text field against regular expression pattern |
| `TOOL_SELECTED` | `TOOL_CALL` | Asserts that a specific tool was invoked |
| `TOOL_NOT_SELECTED` | `TOOL_CALL` | Asserts that a disallowed/dangerous tool was not invoked |
| `TOOL_ARGUMENT_ASSERTION`| `TOOL_CALL` | Validates specific input argument value for an invoked tool |
| `TOOL_ORDER_ASSERTION` | `TOOL_CALL` | Enforces exact relative invocation ordering between tools |
| `BOUNDARY_COUNT` | `RUN` / `STEP` | Validates min/max execution boundary counts |
| `BOUNDARY_SEQUENCE` | `RUN` | Enforces ordered sequence of execution boundary types |
| `STATE_ASSERTION` | `STEP` | Asserts state variables or values at a given snapshot |
| `ARTIFACT_EXISTS` | `ARTIFACT` | Asserts existence of linked artifact ID or URI |
| `APPROVAL_COMPLIANCE` | `RUN` | Asserts human approval gates were respected (no pending or rejected gates bypassed) |
| `SECURITY_VIOLATION_COUNT`| `RUN` | Asserts security violations count does not exceed threshold (typically 0) |
| `SIDE_EFFECT_COMPLIANCE`| `RUN` | Enforces side effect class restrictions (e.g. only `read_only`) |
| `COST_BUDGET` | `RUN` | Asserts total run cost does not exceed configured USD budget |
| `LATENCY_BUDGET` | `RUN` | Asserts run duration does not exceed configured millisecond SLA |
| `TOKEN_BUDGET` | `RUN` / `CONTEXT`| Asserts token consumption stays within token threshold |
| `CONTEXT_ITEM_PRESENT` | `CONTEXT` | Asserts specified context item is included in snapshot |
| `CONTEXT_ITEM_ABSENT` | `CONTEXT` | Asserts specified context item is excluded from snapshot |
| `MEMORY_ITEM_PRESENT` | `MEMORY` | Asserts specified memory operation was performed |
| `MEMORY_ITEM_ABSENT` | `MEMORY` | Asserts specified memory ID was not accessed |

---

## 3. Model-Based Grader (`ModelJudgeEvaluatorAdapter`)

Used for subjective semantic criteria (e.g., response style, tone adherence, faithfulness, answer completeness):

- **Structured Rubric:** Explicit grading criteria and scoring scale ($0.0 - 1.0$).
- **Strict Output Schema:** Must return `{ score: number, passed: boolean, reasoning: string, evidence_references: string[] }`.
- **Grader Provenance:** Tracks model provider, model ID, prompt hash, temperature, latency, and token cost.
- **Grader Latency & Cost Tracking:** Separate from candidate execution metrics.
- **Non-Overriding Invariant:** Model judges must never override deterministic safety or approval failures.

### Error Handling & Infrastructure Isolation

If the model judge provider fails, times out, or returns invalid JSON:
- Recorded as `grader_status: "EVALUATOR_ERROR"`.
- Never converted to an agent failure unless explicitly required by policy.

---

## 4. Human Grader (`HumanEvaluatorAdapter`)

Provides a minimal, structured surface to record manual human reviews:
- `reviewer_id`: Identity of the evaluator.
- `rubric_id`: Reference to rubric guidelines.
- `decision`: `APPROVE`, `REJECT`, or `NEEDS_CHANGES`.
- `score`: Human confidence or rating score.
- `notes`: Justification and observations.
