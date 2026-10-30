import type { ExperimentBudget, ExecutionError } from "./contracts";

export interface BudgetUsage {
  cost_usd: number;
  tokens: number;
  model_calls: number;
  started_at_ms: number;
}

export class RunBudget {
  readonly usage: BudgetUsage = {
    cost_usd: 0,
    tokens: 0,
    model_calls: 0,
    started_at_ms: Date.now(),
  };

  constructor(private readonly limits: ExperimentBudget) {}

  remainingMs(): number {
    return Math.max(0, this.limits.run_timeout_ms - (Date.now() - this.usage.started_at_ms));
  }

  check(kind: "model_call" | "agent_start" = "model_call"): ExecutionError | undefined {
    const elapsed = Date.now() - this.usage.started_at_ms;
    if (elapsed >= this.limits.run_timeout_ms) {
      return {
        code: "timeout",
        message: `Run timeout exceeded (${elapsed}ms >= ${this.limits.run_timeout_ms}ms).`,
        retryable: false,
      };
    }
    if (this.usage.cost_usd >= this.limits.max_cost_usd) {
      return {
        code: "budget_exceeded",
        message: `Cost budget exceeded ($${this.usage.cost_usd.toFixed(4)} >= $${this.limits.max_cost_usd}).`,
        retryable: false,
      };
    }
    if (this.usage.tokens >= this.limits.max_tokens) {
      return {
        code: "budget_exceeded",
        message: `Token budget exceeded (${this.usage.tokens} >= ${this.limits.max_tokens}).`,
        retryable: false,
      };
    }
    if (kind === "model_call" && this.usage.model_calls >= this.limits.max_model_calls) {
      return {
        code: "budget_exceeded",
        message: `Model-call budget exceeded (${this.usage.model_calls} >= ${this.limits.max_model_calls}).`,
        retryable: false,
      };
    }
    return undefined;
  }

  recordCall(input: { costUsd?: number; tokens?: number }): void {
    this.usage.model_calls += 1;
    this.usage.cost_usd += input.costUsd ?? 0;
    this.usage.tokens += input.tokens ?? 0;
  }

  snapshot(): BudgetUsage & { limits: ExperimentBudget } {
    return { ...this.usage, limits: this.limits };
  }
}

export const DEFAULT_MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  "gpt-4o": { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
  "claude-3-5-haiku-latest": { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
  "claude-3-5-haiku-20241022": { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = DEFAULT_MODEL_PRICING[model] ?? DEFAULT_MODEL_PRICING["gpt-4o-mini"]!;
  return Number((inputTokens * pricing.input + outputTokens * pricing.output).toFixed(8));
}
